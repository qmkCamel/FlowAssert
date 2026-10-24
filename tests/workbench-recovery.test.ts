import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import sharp from 'sharp'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchSuites, junitReport } from '../src/workbench-suites.js'
import { compilePlan } from '../src/workbench-plan.js'
import { emptyProject } from '../src/workbench-project.js'
import { sha256 } from '../src/workbench-store.js'
import { boundedProposal, type RecoveryPlanner, type RecoveryObservation } from '../src/workbench-recovery.js'
const cleanup: (()=>Promise<unknown>)[]=[]
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn()})
const header={name:'Recovery',platform:'ios',appId:'com.example.mobilemirror.mock'}
const yaml=(steps:unknown[],extra:object={})=>`${stringify({...header,...extra})}---\n${stringify(steps)}`
const assertion={assertVisible:{text:'Hello, harness.'}}
function project() {
  const value=emptyProject()
  value.recoveryModels.vision={endpoint:'http://127.0.0.1:9/chat/completions',model:'test',apiKeyEnv:'TEST_KEY'}
  value.recoveryPolicies.navigation={mode:'auto',platform:'ios',appId:header.appId,intent:'Open navigation',modelRef:'vision',navigationOnly:true,allowImageSharing:true,page:{text:'Hello, harness.'},allowedTargets:[{accessibilityId:'action-card'}]}
  return value
}
const recover=(target='old-id')=>({recover:{id:'open',policy:'navigation',step:{tap:{accessibilityId:target}},postcondition:{visible:{text:'1 actions received'}}}})
const propose:RecoveryPlanner=async input=>({decision:'propose',observationId:input.id,action:{kind:'tap',nodeId:input.candidates[0]!.nodeId},reason:'Navigation candidate'})
class NavigationFixture extends MockProvider {
  override async screenSource(): ReturnType<MockProvider['screenSource']> {
    const source=await super.screenSource()
    if(source.kind==='normalized')source.structure.nodes=source.structure.nodes.filter(n=>!n.sensitive)
    return source
  }
}
async function setup(planner:RecoveryPlanner=propose,provider=new NavigationFixture(0)) {
  const root=await mkdtemp(join(tmpdir(),'mirror-recovery-'))
  const mirror=new MirrorService(resolveMirrorConfig({mockStartupDelayMs:0}),'http://127.0.0.1',{providerFactory:()=>provider})
  await mirror.start({provider:'mock'})
  const workbench=new WorkbenchService(mirror,{root,planner})
  cleanup.push(async()=>{await workbench.close();await mirror.dispose();await rm(root,{recursive:true,force:true})})
  return {workbench,mirror,provider,root}
}
async function run(workbench:WorkbenchService,steps:unknown[],config=project()) {
  const started=await workbench.start(yaml(steps),undefined,undefined,{project:config})
  await workbench.wait();return workbench.get(started.id)
}
describe('bounded recovery',()=>{
  it('does not click an existing original locator on an unapproved page', async()=>{
    const planner=vi.fn(propose),{workbench}=await setup(planner),config=project()
    config.recoveryPolicies.navigation!.page={text:'Unapproved page'}
    const result=await run(workbench,[recover('action-card')],config)
    expect(result.verdict).not.toBe('pass'); expect(result.dispatches).toHaveLength(0)
    expect(planner).not.toHaveBeenCalled()
  },20000)
  it('rechecks the page after durable original-navigation intent', async()=>{
    const {mirror}=await setup(),lease=mirror.acquireRun('fresh-page',new AbortController().signal)
    const policy=project().recoveryPolicies.navigation!
    lease.onDispatch=async()=>{policy.page={text:'Unapproved page'}}
    try {
      await expect(lease.navigationTap({accessibilityId:'action-card'},header.appId,policy)).rejects.toThrow('Page scope')
      expect(lease.dispatches.map(d=>d.state)).toEqual(['not-dispatched'])
    } finally {await lease.release()}
  })
  it.each(['original', 'fallback'])('rejects an actual page change after %s intent persistence', async kind=>{
    class ChangingPage extends NavigationFixture {
      changed=false
      override async screenSource():ReturnType<NavigationFixture['screenSource']>{
        const source=await super.screenSource()
        if(this.changed&&source.kind==='normalized')source.structure.nodes.find(n=>n.role==='text')!.text='Other page'
        return source
      }
    }
    const provider=new ChangingPage(0),{mirror}=await setup(propose,provider)
    const lease=mirror.acquireRun('fresh-page',new AbortController().signal),policy=project().recoveryPolicies.navigation!,signal=new AbortController().signal
    lease.onDispatch=async()=>{provider.changed=true}
    try {
      if(kind==='original')await expect(lease.navigationTap({accessibilityId:'action-card'},header.appId,policy)).rejects.toThrow('Page')
      else {
        const observation=await lease.recoveryObserve(policy,signal)
        await expect(lease.recoveryTap(observation,observation.candidates[0]!.nodeId,policy,signal)).rejects.toThrow('Page changed')
      }
      expect(lease.dispatches.map(d=>d.state)).toEqual(['not-dispatched'])
    } finally {await lease.release()}
  })
  it('refuses a pixel-only overlay even when the accessibility tree is unchanged',async()=>{
    class PixelOverlay extends NavigationFixture {
      changed=false
      override async snapshot():ReturnType<NavigationFixture['snapshot']>{
        const frame=await super.snapshot()
        if(!this.changed)return frame
        const {data,info}=await sharp(frame.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true})
        const offset=(100*info.width+100)*info.channels
        data[offset]=data[offset]! ^ 255
        return {...frame,bytes:await sharp(data,{raw:info}).png().toBuffer()}
      }
    }
    const provider=new PixelOverlay(0),{mirror}=await setup(propose,provider)
    const lease=mirror.acquireRun('overlay',new AbortController().signal)
    try {
      const policy=project().recoveryPolicies.navigation!,signal=new AbortController().signal
      const observation=await lease.recoveryObserve(policy,signal)
      provider.changed=true
      expect(await lease.recoveryTap(observation,observation.candidates[0]!.nodeId,policy,signal)).toBe(false)
      expect(lease.dispatches).toHaveLength(0)
    } finally {await lease.release()}
  })
  it('recovers navigation, retains the original failure and independently verifies the postcondition',async()=>{
    const planner=vi.fn(propose),{workbench}=await setup(planner)
    const result=await run(workbench,[assertion,recover()])
    expect(result.verdict,JSON.stringify(result)).toBe('recovered')
    expect(result.steps.find(s=>s.status==='failed')?.recoveredBy).toBe(result.aiRecovery?.attempts[0]?.id)
    expect(planner).toHaveBeenCalledTimes(1)
    expect(result.dispatches?.filter(d=>d.operation==='recovery-tap')).toHaveLength(1)
    expect(result.evidence.some(e=>e.name.startsWith('ai-recovery-')&&e.contentType==='image/png')).toBe(true)
  },20000)
  it('uses no model when the original navigation succeeds',async()=>{
    const planner=vi.fn(propose),{workbench}=await setup(planner)
    const result=await run(workbench,[recover('action-card')])
    expect(result.verdict,result.error).toBe('pass');expect(planner).not.toHaveBeenCalled()
  },20000)
  it('rejects unknown policy and non-navigation syntax before execution',async()=>{
    await expect(compilePlan(yaml([recover()]),emptyProject())).rejects.toThrow('policy')
    await expect(compilePlan(yaml([{recover:{id:'x',policy:'navigation',step:{type:{text:'x'}},postcondition:{visible:{text:'ok'}}}}]),project())).rejects.toThrow()
    await expect(compilePlan(yaml([{recover:{id:'x',policy:'navigation',step:{tap:{text:'x'}}}}]),project())).rejects.toThrow()
  })
  it('never dispatches invented targets or suggestions in suggest mode',async()=>{
    const {workbench}=await setup(async input=>({decision:'propose',observationId:input.id,action:{kind:'tap',nodeId:'invented'},reason:'injected'}))
    const invalid=await run(workbench,[recover()])
    expect(invalid.verdict).toBe('inconclusive');expect(invalid.dispatches).toHaveLength(0)
    const suggestion=await setup();const config=project();config.recoveryPolicies.navigation!.mode='suggest'
    const result=await run(suggestion.workbench,[recover()],config)
    expect(result.verdict).toBe('fail');expect(result.dispatches).toHaveLength(0)
  },20000)
  it('does not turn a later failed assertion into recovered',async()=>{
    const {workbench}=await setup()
    const result=await run(workbench,[recover(),{assertVisible:{text:'never present'}}])
    expect(result.verdict).toBe('fail');expect(result.aiRecovery?.attempts[0]?.status).toBe('recovered')
  },20000)
  it('cancels an uncooperative model without dispatching its late suggestion',async()=>{
    let finish!:(value:unknown)=>void
    const {workbench}=await setup(()=>new Promise(resolve=>{finish=resolve}))
    const started=await workbench.start(yaml([recover()]),undefined,undefined,{project:project()})
    await expect.poll(async()=> (await workbench.get(started.id)).stage).toBe('recovery-planning')
    await expect.poll(()=>typeof finish).toBe('function')
    await workbench.cancel(started.id);await workbench.wait()
    finish({decision:'abstain',reason:'late'})
    const result=await workbench.get(started.id)
    expect(result.verdict).toBe('cancelled');expect(result.dispatches).toHaveLength(0)
  },20000)
  it('aborts even a planner that ignores its deadline',async()=>{
    const config=project()
    const input={image:'',candidates:[]} as unknown as RecoveryObservation
    await expect(boundedProposal(()=>new Promise(()=>{}),input,config.recoveryPolicies.navigation!,config.recoveryModels.vision!,AbortSignal.timeout(20))).rejects.toThrow(/timeout/i)
  })
  it('does not replay an earlier action when a later navigation recovers',async()=>{
    const {workbench}=await setup()
    const step=recover();step.recover.postcondition.visible.text='2 actions received'
    const result=await run(workbench,[{tap:{accessibilityId:'action-card'}},step])
    expect(result.verdict,result.error).toBe('recovered')
    expect(result.dispatches).toHaveLength(2)
    expect(result.dispatches?.map(d=>d.operation)).toEqual(['tap','recovery-tap'])
  },20000)
  it('rejects a page changing during capture without calling a model or clicking',async()=>{
    class MovingFixture extends NavigationFixture {
      revision=0
      override async screenSource(): ReturnType<NavigationFixture['screenSource']> {
        const source=await super.screenSource()
        if(source.kind==='normalized')source.structure.nodes[0]!.text=String(++this.revision)
        return source
      }
    }
    const planner=vi.fn(propose),{workbench}=await setup(planner,new MovingFixture(0))
    const result=await run(workbench,[recover()])
    expect(result.verdict).toBe('fail');expect(result.dispatches).toHaveLength(0);expect(planner).not.toHaveBeenCalled()
  },20000)
  it('never invokes recovery for a provider failure',async()=>{
    class BrokenFixture extends NavigationFixture {override async queryAppState():Promise<import('../src/types.js').MobileAppState>{throw new Error('Provider timeout')}}
    const planner=vi.fn(propose),{workbench}=await setup(planner,new BrokenFixture(0))
    const result=await run(workbench,[recover()])
    expect(result.verdict).toBe('inconclusive');expect(planner).not.toHaveBeenCalled();expect(result.dispatches).toHaveLength(0)
  },20000)
  it('does not retry recovered suite cases and invalidates damaged recovery evidence',async()=>{
    const root=await mkdtemp(join(tmpdir(),'mirror-recovery-suite-'))
    const config=project(), path=join(root,'project.json')
    await writeFile(join(root,'case.yaml'),yaml([recover()]))
    await writeFile(join(root,'reset.yaml'),yaml([assertion]))
    await writeFile(path,JSON.stringify({recoveryModels:config.recoveryModels,recoveryPolicies:config.recoveryPolicies,flows:{test:'case.yaml',reset:'reset.yaml'},suites:{smoke:{name:'Recovery',cases:[{id:'test',flow:'test',retries:1,retrySafe:true,reset:'reset'}]},unknown:{name:'Unknown action',cases:[{id:'first',flow:'test'},{id:'mustNotRun',flow:'test'}]}}}))
    class UnknownAction extends NavigationFixture { fail=false;override async action(action:import('../src/types.js').MirrorAction){await super.action(action);if(this.fail)throw new Error('Action result unknown')} }
    const provider=new UnknownAction(0)
    const mirror=new MirrorService(resolveMirrorConfig({mockStartupDelayMs:0}),'http://127.0.0.1',{providerFactory:()=>provider})
    await mirror.start({provider:'mock'})
    const workbench=new WorkbenchService(mirror,{root:join(root,'runs'),projectPath:path,planner:propose}),suites=new WorkbenchSuites(workbench)
    cleanup.push(async()=>{await suites.close();await workbench.close();await mirror.dispose();await rm(root,{recursive:true,force:true})})
    const started=await suites.start('smoke');await suites.wait()
    const suite=await suites.get(started.id)
    expect(suite.exitCode).toBe(1);expect(suite.cases[0]?.status).toBe('recovered');expect(suite.cases[0]?.attempts).toHaveLength(1)
    expect(junitReport(suite)).toContain('failures="1"');expect(junitReport(suite)).toContain('<failure message="recovered"/>')
    const result=await workbench.get(suite.cases[0]!.attempts[0]!)
    const evidence=result.evidence.find(e=>e.name.startsWith('ai-recovery-')&&e.name.endsWith('.png'))!
    await writeFile(join(root,'runs',result.id,evidence.name),'broken')
    expect((await suites.get(started.id)).exitCode).toBe(2)
    expect((await suites.get(started.id)).cases[0]?.status).toBe('inconclusive')
    provider.fail=true
    const stopped=await suites.start('unknown');await suites.wait()
    const unknown=await suites.get(stopped.id)
    expect(unknown.cases.map(c=>c.status)).toEqual(['inconclusive','skipped'])
    expect(unknown.cases[1]?.attempts).toHaveLength(0)
    expect(unknown.exitCode).toBe(2)
  },20000)
  it('preserves an unknown dispatched action and never invokes the model to repeat it',async()=>{
    class BrokenAction extends NavigationFixture { override async action(action:import('../src/types.js').MirrorAction){await super.action(action);throw new Error('Response lost after action')} }
    const planner=vi.fn(propose),{workbench}=await setup(planner,new BrokenAction(0))
    const result=await run(workbench,[recover('action-card')])
    expect(result.verdict).toBe('inconclusive');expect(result.dispatches?.[0]?.state).toBe('unknown')
    expect(result.steps[0]?.evidence.map(file=>file.name)).toEqual(expect.arrayContaining(['step-1.png','step-1.xml','step-1-action-1-before.png']))
    expect(result.steps[0]?.actionEvidence?.actions[0]?.dispatch).toBe('unknown');expect(planner).not.toHaveBeenCalled()
  },20000)
  it('replans exactly once when a stable new page replaces the observed page',async()=>{
    class ChangedPage extends NavigationFixture {
      changed=false
      override async screenSource():ReturnType<NavigationFixture['screenSource']>{
        const source=await super.screenSource()
        if(this.changed&&source.kind==='normalized')source.structure.nodes.push({nodeId:'new-label',role:'text',text:'New layout',visible:true,bounds:{x:10,y:10,width:50,height:20}})
        return source
      }
    }
    const provider=new ChangedPage(0)
    const planner=vi.fn<RecoveryPlanner>(async(...args)=>{provider.changed=true;return propose(...args)})
    const {workbench}=await setup(planner,provider)
    const result=await run(workbench,[recover()])
    expect(result.verdict,result.error).toBe('recovered');expect(planner).toHaveBeenCalledTimes(2)
    expect(result.dispatches).toHaveLength(1)
  },20000)
  it('rejects page scope mismatch before sharing any image',async()=>{
    const planner=vi.fn(propose),{workbench}=await setup(planner),config=project()
    config.recoveryPolicies.navigation!.page={text:'Unapproved'}
    const result=await run(workbench,[recover()],config)
    expect(result.verdict).toBe('inconclusive');expect(planner).not.toHaveBeenCalled();expect(result.dispatches).toHaveLength(0)
  },20000)
  it('rejects stale and foreign-session observations before dispatch',async()=>{
    const {mirror}=await setup(),lease=mirror.acquireRun('stale-test',new AbortController().signal)
    try {
      const policy=project().recoveryPolicies.navigation!,signal=new AbortController().signal
      const observation=await lease.recoveryObserve(policy,signal)
      await expect(lease.recoveryTap({...observation,capturedAt:Date.now()-16000},observation.candidates[0]!.nodeId,policy,signal)).rejects.toThrow('expired')
      await expect(lease.recoveryTap({...observation,sessionGeneration:observation.sessionGeneration+1},observation.candidates[0]!.nodeId,policy,signal)).rejects.toThrow('expired')
      expect(lease.dispatches).toHaveLength(0)
    } finally {await lease.release()}
  })
  it('does not dispatch if the recovery deadline expires while persisting the intent',async()=>{
    const {mirror,provider}=await setup(),lease=mirror.acquireRun('late-dispatch',new AbortController().signal)
    const action=vi.spyOn(provider,'action'),deadline=new AbortController()
    try {
      const policy=project().recoveryPolicies.navigation!
      const observation=await lease.recoveryObserve(policy,deadline.signal)
      lease.onDispatch=async()=>{deadline.abort(new Error('Recovery budget expired'))}
      await expect(lease.recoveryTap(observation,observation.candidates[0]!.nodeId,policy,deadline.signal)).rejects.toThrow('budget expired')
      expect(action).not.toHaveBeenCalled()
      expect(lease.dispatches[0]?.state).toBe('not-dispatched')
    } finally {await lease.release()}
  })
  it.each([
    {decision:'propose',observationId:'obs',action:{kind:'tap',nodeId:'candidate',x:1,y:2},reason:'coordinate'},
    {decision:'propose',observationId:'obs',action:{kind:'shell',command:'echo unexpected'},reason:'code'},
    {decision:'propose',observationId:'old',action:{kind:'tap',nodeId:'candidate'},reason:'old observation'},
  ])('rejects non-contract planner output %#',async output=>{
    const config=project(),input={id:'obs',image:'',candidates:[{nodeId:'candidate'}]} as unknown as RecoveryObservation
    await expect(boundedProposal(async()=>output,input,config.recoveryPolicies.navigation!,config.recoveryModels.vision!,new AbortController().signal)).rejects.toThrow()
  })
  it('does not replay prepare or completed iterations and enforces the run-wide recovery budget',async()=>{
    const {workbench,root}=await setup(),config=project(),file=join(root,'prepare-count.txt')
    const source=`export default async()=>{await (await import('node:fs/promises')).appendFile(${JSON.stringify(file)},'prepared\\n');return {}}`
    config.extensions.seed={role:'prepare',module:'seed.mjs',input:{type:'object',properties:{}},output:{type:'object',properties:{}},timeoutMs:1000,credentials:{},source,sha256:sha256(source)}
    const wrapped=recover();wrapped.recover.postcondition.visible.text='2 actions received'
    const started=await workbench.start(yaml([{repeat:{times:2,steps:[{tap:{accessibilityId:'action-card'}},wrapped]}}],{prepare:[{ref:'seed'}]}),undefined,undefined,{project:config})
    await workbench.wait();const result=await workbench.get(started.id)
    expect(result.verdict).toBe('fail');expect(result.error).toContain('recovery budget')
    expect(await readFile(file,'utf8')).toBe('prepared\n')
    expect(result.dispatches).toHaveLength(3);expect(result.aiRecovery?.attempts).toHaveLength(1)
    expect(result.steps.some(s=>s.path?.includes('iteration-2'))).toBe(true)
  },20000)
  it('replay asks for a new observation and never reuses the archived suggestion',async()=>{
    const planner=vi.fn(propose),{workbench}=await setup(planner)
    const original=await run(workbench,[recover()])
    const replay=await workbench.replay(original.id);await workbench.wait()
    expect(planner).toHaveBeenCalledTimes(2)
    expect(planner.mock.calls[0]![0].id).not.toBe(planner.mock.calls[1]![0].id)
    expect((await workbench.get(replay.id)).parentRunId).toBe(original.id)
  },20000)
  it.each(['business','cleanup'] as const)('does not report recovered after %s failure',async failure=>{
    const {workbench}=await setup(),config=project()
    const empty={type:'object' as const,properties:{}}
    const definition=(role:'prepare'|'verify'|'cleanup',source:string)=>({role,module:'fixture.mjs',input:empty,output:empty,timeoutMs:1000,credentials:{},source,sha256:sha256(source)})
    config.extensions.seed={...definition('prepare','export default async (_,ctx)=>{await ctx.registerCleanup({});return {}}'),cleanup:'clean'}
    config.extensions.clean=definition('cleanup',failure==='cleanup'?'export default()=>{throw new Error("cleanup failed")}':'export default()=>({})')
    config.extensions.verify={...definition('verify',`export default()=>({verdict:'${failure==='business'?'fail':'pass'}',expected:1200,actual:${failure==='business'?999:1200},source:'independent-test-verifier',artifactRefs:[]})`),output:{type:'object',properties:{verdict:{type:'string'},expected:{type:'number'},actual:{type:'number'},source:{type:'string'},artifactRefs:{type:'array',items:{type:'string'}}}}}
    const started=await workbench.start(yaml([recover()],{prepare:[{ref:'seed'}],verify:[{ref:'verify'}]}),undefined,undefined,{project:config})
    await workbench.wait();const result=await workbench.get(started.id)
    expect(result.aiRecovery?.attempts[0]?.status).toBe('recovered')
    expect(result.verdict).toBe(failure==='business'?'fail':'inconclusive')
    expect(result.resourceCleanup).toBe(failure==='cleanup'?'failed':'pass')
  },20000)
})
