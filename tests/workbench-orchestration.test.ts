import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchReferences } from '../src/workbench-references.js'
import { stringify } from 'yaml'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchSuites, junitReport } from '../src/workbench-suites.js'
import { compilePlan } from '../src/workbench-plan.js'
import { emptyProject, loadTestProject } from '../src/workbench-project.js'
import { executeExtension } from '../src/workbench-extensions.js'
import { WorkbenchStore, sha256 } from '../src/workbench-store.js'
const cleanup:(()=>Promise<unknown>)[]=[]
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn()})
const header={name:'Composition',platform:'ios',appId:'com.example.mobilemirror.mock'}
const flow=(steps:unknown[],extra:object={})=>`${stringify({...header,...extra})}---\n${stringify(steps,{aliasDuplicateObjects:false})}`
const assertion={assertVisible:{text:'Hello, harness.'}}
async function setup(project?:object,availableBytes?: (root:string)=>Promise<number>){
  const root=await mkdtemp(join(tmpdir(),'mirror-compose-'))
  const projectPath=join(root,'project.json');await writeFile(projectPath,JSON.stringify(project??{}))
  const mirror=new MirrorService(resolveMirrorConfig({mockStartupDelayMs:0}),'http://127.0.0.1',{providerFactory:()=>new MockProvider(0)})
  await mirror.start({provider:'mock'})
  const workbench=new WorkbenchService(mirror,{store:new WorkbenchStore(join(root,'runs'),availableBytes),projectPath}),suites=new WorkbenchSuites(workbench)
  cleanup.push(async()=>{await suites.close();await workbench.close();await mirror.dispose();await rm(root,{recursive:true,force:true})})
  return {root,mirror,workbench,suites,projectPath}
}
async function complete(workbench:WorkbenchService,yaml:string,params:Record<string,unknown>={}){const run=await workbench.start(yaml,undefined,undefined,{params});await workbench.wait();return workbench.get(run.id)}
describe('deterministic composition',()=>{
  it('resets the Mock fixture between repair checks with distinct local namespaces', async () => {
    const { mirror, workbench } = await setup()
    const owner = randomUUID(), release = mirror.reserveRepair(owner)
    try {
      const first = await mirror.resetRepairFixture(owner)
      const mutated = await workbench.start(flow([{ tap: { accessibilityId: 'action-card' } }, assertion]), undefined, undefined, { repairOwner: owner })
      await workbench.wait()
      expect((await workbench.get(mutated.id)).verdict).toBe('pass')
      const second = await mirror.resetRepairFixture(owner)
      expect(second.namespaceId).not.toBe(first.namespaceId)
      expect(second.initialStateSha256).toBe(first.initialStateSha256)
      expect(second.sessionId).toBe(first.sessionId)
      const check = await workbench.start(flow([{ assertVisible: { text: '0 actions received' } }]), undefined, undefined, { repairOwner: owner })
      await workbench.wait()
      expect((await workbench.get(check.id)).verdict).toBe('pass')
    } finally { await release() }
  }, 20000)
  it('rejects a repair reset while its child run still owns the device', async () => {
    const { mirror, workbench } = await setup()
    const owner = randomUUID(), release = mirror.reserveRepair(owner)
    let open!: () => void
    const gate = new Promise<void>(resolve => { open = resolve })
    const child = await workbench.start(flow([assertion]), undefined, undefined, { repairOwner: owner, executeGate: gate })
    await expect(mirror.resetRepairFixture(owner)).rejects.toThrow('idle device')
    await workbench.cancel(child.id)
    open(); await workbench.wait()
    await release()
  }, 20000)
  it('fences subsequent control when a fixture reset returns an unknown result', async () => {
    class BrokenResetProvider extends MockProvider {
      override async resetRepairFixture(): Promise<{ namespaceId: string; initialStateSha256: string }> {
        throw new Error('reset receipt lost')
      }
    }
    const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
      { providerFactory: () => new BrokenResetProvider(0) })
    await mirror.start({ provider: 'mock' })
    const owner = randomUUID(), release = mirror.reserveRepair(owner)
    try {
      await expect(mirror.resetRepairFixture(owner)).rejects.toThrow('reset receipt lost')
      expect(() => mirror.acquireRun(randomUUID(), new AbortController().signal, owner)).toThrow('uncertain')
    } finally { await release(); await mirror.dispose() }
  })
  it('keeps one repair owner across separate child runs and excludes unrelated controls', async () => {
    const { mirror, workbench } = await setup()
    const owner = randomUUID(), release = mirror.reserveRepair(owner)
    try {
      await expect(workbench.start(flow([assertion]))).rejects.toThrow('another owner')
      await expect(mirror.action({ kind: 'tap', x: 100, y: 100 })).rejects.toThrow('reserved')
      const first = await workbench.start(flow([assertion]), undefined, undefined, { repairOwner: owner })
      await workbench.wait()
      expect((await workbench.get(first.id)).verdict).toBe('pass')
      await expect(workbench.start(flow([assertion]))).rejects.toThrow('another owner')
      const second = await workbench.start(flow([assertion]), undefined, undefined, { repairOwner: owner })
      await workbench.wait()
      expect((await workbench.get(second.id)).verdict).toBe('pass')
    } finally { await release() }
    const outside = await workbench.start(flow([assertion])); await workbench.wait()
    expect((await workbench.get(outside.id)).verdict).toBe('pass')
  }, 20000)
  it('does not release a repair reservation while a child has not actually exited', async () => {
    const { mirror, workbench } = await setup()
    const owner = randomUUID(), release = mirror.reserveRepair(owner)
    let open!: () => void
    const gate = new Promise<void>(resolve => { open = resolve })
    const child = await workbench.start(flow([assertion]), undefined, undefined, { repairOwner: owner, executeGate: gate })
    await expect(release()).rejects.toThrow('still owns device')
    await workbench.cancel(child.id)
    open(); await workbench.wait()
    expect((await workbench.get(child.id)).verdict).not.toBe('pass')
    await release()
  }, 20000)
  it('runs typed parameters, registered subflows, branches and bounded loops on one session with linked evidence',async()=>{
    const {root,workbench,mirror}=await setup({flows:{common:'common.yaml'}})
    await writeFile(join(root,'common.yaml'),flow([assertion]))
    const session=mirror.state().sessionId
    const result=await complete(workbench,flow([
      {runFlow:{ref:'common'}},
      {if:{condition:{equals:['{{ params.enabled }}',true]},then:[{repeat:{times:2,steps:[{tap:{accessibilityId:'action-card'}}]}}],else:[{assertVisible:{text:'should not happen'}}]}},
      {repeat:{until:{visible:{text:'2 actions received'}},maxIterations:2,steps:[{tap:{accessibilityId:'action-card'}}]}},
      {assertVisible:{text:'2 actions received'}},
    ],{params:{enabled:{type:'boolean'}}}),{enabled:true})
    expect(result.verdict,JSON.stringify(result)).toBe('pass')
    expect(result.steps.filter(s=>s.kind==='tap')).toHaveLength(2)
    expect(result.steps.some(s=>s.path?.includes('iteration-2'))).toBe(true)
    expect(result.steps.every(s=>s.evidence.length===2+(s.actionEvidence?.actions.filter(action=>action.before).length??0))).toBe(true)
    expect(result.steps.filter(s=>s.kind==='tap').every(s=>s.actionEvidence?.actions[0]?.dispatch==='settled')).toBe(true)
    expect(result.evidence.some(e=>e.name==='plan.json')).toBe(true)
    expect(mirror.state().sessionId).toBe(session)
  },20000)
  it('rejects hidden invalid branches, missing params, cycles and expansion overflow before any actions',async()=>{
    const project=emptyProject();project.flows.a=flow([{runFlow:{ref:'a'}}])
    await expect(compilePlan(flow([{runFlow:{ref:'a'}},assertion]),project)).rejects.toThrow('Cyclic')
    await expect(compilePlan(flow([{if:{condition:{platform:'ios'},then:[assertion],else:[{shell:'oops'}]}}]),project)).rejects.toThrow('unsupported')
    await expect(compilePlan(flow([assertion],{params:{x:{type:'string'}}}),project)).rejects.toThrow('requires string')
    await expect(compilePlan(flow([{repeat:{times:20,steps:[{repeat:{times:20,steps:[assertion,assertion]}}]}}]),project)).rejects.toThrow('500')
  })
  it('does not pass when branches skip every assertion or an until loop exhausts',async()=>{
    const {workbench}=await setup()
    const skipped=await complete(workbench,flow([{if:{condition:{equals:[true,false]},then:[assertion]}}]))
    expect(skipped.verdict).toBe('inconclusive');expect(skipped.error).toContain('No UI assertion')
    const exhausted=await complete(workbench,flow([assertion,{repeat:{until:{visible:{text:'missing'}},maxIterations:1,steps:[{wait:0}]}}]))
    expect(exhausted.verdict).toBe('fail');expect(exhausted.error).toContain('exhausted')
  },20000)
  it('cancels inside a nested block without later actions',async()=>{
    const {workbench}=await setup()
    const run=await workbench.start(flow([assertion,{repeat:{times:2,steps:[{wait:30},{tap:{accessibilityId:'action-card'}}]}}]))
    await expect.poll(async()=> (await workbench.get(run.id)).steps.some(s=>s.kind==='wait'), { timeout: 10000 }).toBe(true)
    await workbench.cancel(run.id);await workbench.wait()
    const result=await workbench.get(run.id)
    expect(result.verdict).toBe('cancelled');expect(result.steps.some(s=>s.kind==='tap')).toBe(false)
  },15000)
  it('rejects project traversal and aliased data',async()=>{
    const {root,projectPath}=await setup({flows:{outside:'../outside.yaml'}})
    await expect(loadTestProject(projectPath)).rejects.toThrow()
    await expect(compilePlan('name: A\nplatform: ios\nappId: com.demo\n---\n- &a {assertVisible: {text: hi}}\n- *a',emptyProject())).rejects.toThrow()
    await writeFile(join(root,'rows.json'),JSON.stringify([{id:'x',params:{}},{id:'x',params:{}}]))
    await writeFile(projectPath,JSON.stringify({datasets:{data:'rows.json'}}))
    await expect(loadTestProject(projectPath)).rejects.toThrow('Duplicate')
  })
})
const object={type:'object',properties:{},required:[]} as const
const verified={type:'object',properties:{verdict:{type:'string',enum:['pass','fail','inconclusive']},expected:{type:'number'},actual:{type:'number'},source:{type:'string'},artifactRefs:{type:'array',items:{type:'string'}}},required:['verdict','expected','actual','source','artifactRefs']}
async function businessSetup(options:{bad?:boolean;partial?:boolean;cleanupFail?:boolean}={}) {
  const resources=new Set<string>()
  const server=createServer((req,res)=>{const id=req.url!.slice(1);if(req.method==='POST')resources.add(id);if(req.method==='DELETE')resources.delete(id);res.setHeader('content-type','application/json');res.end(JSON.stringify({count:resources.has(id)?1:0}))})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  cleanup.push(()=>new Promise<void>(resolve=>server.close(()=>resolve())))
  const endpoint=`http://127.0.0.1:${(server.address() as any).port}/test-resource`
  const project={extensions:{seed:{module:'seed.mjs',role:'prepare',input:object,output:{type:'object',properties:{label:{type:'string'}},required:['label']},cleanup:'clean'},verify:{module:'verify.mjs',role:'verify',input:object,output:verified},clean:{module:'clean.mjs',role:'cleanup',input:{type:'object',properties:{url:{type:'string'}},required:['url']},output:object}}}
  const result=await setup(project)
  await writeFile(join(result.root,'seed.mjs'),`export default async (_,ctx)=>{await fetch('${endpoint}',{method:'POST'});await ctx.registerCleanup({url:'${endpoint}'});${options.partial?"throw new Error('partial');":"return {label:'Hello, harness.'}"}}`)
  await writeFile(join(result.root,'verify.mjs'),`export default async()=>{const actual=(await(await fetch('${endpoint}')).json()).count;return {verdict:actual===${options.bad?2:1}?'pass':'fail',expected:${options.bad?2:1},actual,source:'${endpoint}',artifactRefs:[]}}`)
  await writeFile(join(result.root,'clean.mjs'),`export default async ({url})=>{${options.cleanupFail?"throw new Error('cleanup failed')":"await fetch(url,{method:'DELETE'});return {}"}}`)
  const yaml=flow([{assertVisible:{text:'{{ outputs.seed.label }}'}}],{prepare:[{ref:'seed',as:'seed'}],verify:[{ref:'verify'}]})
  return {...result,resources,yaml}
}
describe('trusted business extensions',()=>{
  it('prepares real API data, binds public output, independently verifies and cleans resources',async()=>{
    const {workbench,resources,yaml,root}=await businessSetup()
    const run=await complete(workbench,yaml)
    expect(run.verdict,JSON.stringify(run)).toBe('pass');expect(run.businessVerification).toBe('pass');expect(run.resourceCleanup).toBe('pass');expect(resources.size).toBe(0)
    expect(run.extensionResults?.map(r=>r.role)).toEqual(['prepare','verify','cleanup'])
    expect(JSON.parse(await readFile(join(root,'runs',run.id,'private/resources.json'),'utf8'))).toEqual([])
  },15000)
  it('keeps independent business failure even when UI passes',async()=>{
    const {workbench,resources,yaml}=await businessSetup({bad:true})
    const run=await complete(workbench,yaml)
    expect(run.verdict).toBe('fail');expect(run.businessVerification).toBe('fail');expect(run.resourceCleanup).toBe('pass');expect(resources.size).toBe(0)
  },15000)
  it('cleans a registered resource after partial prepare failure without executing UI',async()=>{
    const {workbench,resources,yaml}=await businessSetup({partial:true})
    const run=await complete(workbench,yaml)
    expect(run.verdict).toBe('inconclusive');expect(run.steps).toHaveLength(0);expect(resources.size).toBe(0)
  })
  it('does not report green when cleanup fails and retains private resource references',async()=>{
    const {workbench,resources,yaml,root}=await businessSetup({cleanupFail:true})
    const run=await complete(workbench,yaml)
    expect(run.verdict).toBe('inconclusive');expect(run.businessVerification).toBe('pass');expect(run.resourceCleanup).toBe('failed');expect(resources.size).toBe(1)
    expect(JSON.parse(await readFile(join(root,'runs',run.id,'private/resources.json'),'utf8'))).toHaveLength(1)
  },15000)
  it('times out and rejects malformed or credential-bearing extension results',async()=>{
    const source='export default async()=>{await new Promise(r=>setTimeout(r,1000));return {}}'
    const def={module:'test.mjs',role:'prepare' as const,timeoutMs:30,input:{type:'object' as const,properties:{}},output:{type:'object' as const,properties:{}},credentials:{},source,sha256:sha256(source)}
    await expect(executeExtension(def,{},new AbortController().signal,async()=>{})).rejects.toThrow('timed out')
    process.env.MIRROR_TEST_SECRET='credential-test-unique'
    try {await expect(executeExtension({...def,timeoutMs:1000,credentials:{KEY:'MIRROR_TEST_SECRET'},source:'export default()=>({secret:process.env.KEY})'},{},new AbortController().signal,async()=>{})).rejects.toThrow('credential')}finally{delete process.env.MIRROR_TEST_SECRET}
  })
})
describe('serial suites',()=>{
  async function suiteSetup(extra:object={},availableBytes?: (root:string)=>Promise<number>) {
    const env=await setup({flows:{demo:'demo.yaml'},datasets:{rows:'rows.json'},suites:{smoke:{name:'Smoke',cases:[{id:'hello',flow:'demo',dataset:'rows',tags:['smoke'],...extra}]}}},availableBytes)
    await writeFile(join(env.root,'demo.yaml'),flow([{assertVisible:{text:'{{ params.label }}'}}],{params:{label:{type:'string'}}}))
    await writeFile(join(env.root,'rows.json'),JSON.stringify([{id:'one',params:{label:'Hello, harness.'}},{id:'two',params:{label:'Hello, harness.'}}]))
    return env
  }
  it('runs each row independently, reports JSON/JUnit and survives restart',async()=>{
    const {suites,workbench}=await suiteSetup()
    const run=await suites.start('smoke',{tags:['smoke']})
    await expect(workbench.start(flow([assertion]))).rejects.toThrow('suite')
    await suites.wait();const result=await suites.get(run.id)
    expect(result.exitCode,JSON.stringify(result)).toBe(0);expect(result.cases.every(c=>c.status==='pass'&&c.attempts.length===1)).toBe(true)
    expect(junitReport(result)).toContain('tests="2"')
    expect(junitReport(result)).toContain('name="visualStatus" value="not-performed"')
    expect(junitReport(result).match(/<testcase /g)).toHaveLength(2)
    expect(result.cases[0]?.resultProjections?.[0]).toMatchObject({ reportedVerdict: 'pass', verdict: 'pass', attempt: 1 })
    const restored=new WorkbenchSuites(workbench);expect((await restored.get(run.id)).cases).toEqual(result.cases)
  },20000)
  it('keeps a prepared child behind the execution gate when owner publication fails', async () => {
    const { suites, workbench } = await suiteSetup()
    let observed = 0
    const suite = await suites.start('smoke', { onChildPrepared: async runId => {
      const prepared = await workbench.store.readOnlySnapshot(runId)
      expect(prepared.run.steps).toEqual([])
      observed++
      throw new Error('repair-ref-publication-failed')
    } })
    await suites.wait()
    const result = await suites.get(suite.id)
    expect(observed).toBe(1)
    expect(result.exitCode).toBe(2)
    expect(result.error).toContain('repair-ref-publication-failed')
    const child = await workbench.get(result.cases[0]!.attempts[0]!)
    expect(child.steps).toEqual([])
    expect(child.verdict).not.toBe('pass')
  }, 20000)
  it('holds execution until attempt references are durably published even with a slow ledger', async () => {
    const { suites, workbench } = await suiteSetup()
    const original = WorkbenchReferences.prototype.publishUnderMutationGate
    let checked = 0
    const spy = vi.spyOn(WorkbenchReferences.prototype, 'publishUnderMutationGate').mockImplementation(async function (this: WorkbenchReferences, value) {
      if (value.consumerKind === 'workbench:suite') {
        const before = await workbench.store.readOnlySnapshot(value.targetRunId)
        await new Promise(resolve => setTimeout(resolve, 200))
        const after = await workbench.store.readOnlySnapshot(value.targetRunId)
        expect(after.manifestSha256).toBe(before.manifestSha256)
        expect(after.run.steps).toEqual([]); checked++
      }
      return original.call(this, value)
    })
    try {
      const run = await suites.start('smoke'); await suites.wait()
      expect((await suites.get(run.id)).exitCode).toBe(0); expect(checked).toBe(2)
    } finally { spy.mockRestore() }
  }, 20_000)
  it('cancels an admitted attempt before execution if its reference publication fails', async () => {
    const { suites, workbench } = await suiteSetup()
    const original = WorkbenchReferences.prototype.publishUnderMutationGate
    let injected = false
    const spy = vi.spyOn(WorkbenchReferences.prototype, 'publishUnderMutationGate').mockImplementation(async function (this: WorkbenchReferences, value) {
      if (!injected && value.consumerKind === 'workbench:suite') { injected = true; throw new Error('ENOSPC suite reference') }
      return original.call(this, value)
    })
    try {
      const run = await suites.start('smoke'); await suites.wait()
      const result = await suites.get(run.id)
      expect(result).toMatchObject({ exitCode: 2, error: 'ENOSPC suite reference' })
      expect((await workbench.get(result.cases[0]!.attempts[0]!)).steps).toEqual([])
      expect(result.cases[1]!.attempts).toEqual([])
    } finally { spy.mockRestore() }
  }, 20_000)
  it('rejects no-match and unsafe retry before running',async()=>{
    const {suites,workbench}=await suiteSetup({retries:1})
    await expect(suites.start('smoke',{tags:['none']})).rejects.toThrow('No matching')
    await expect(suites.start('smoke')).rejects.toThrow('Retries require')
    expect(await workbench.list()).toHaveLength(0)
  })
  it('rejects suite metadata before device work when capacity admission fails, then retries after space returns',async()=>{
    let available=256*1024*1024+7*1024*1024
    const {suites,workbench}=await suiteSetup({},async()=>available)
    await expect(suites.start('smoke')).rejects.toThrow('storage-insufficient')
    expect(await workbench.list()).toHaveLength(0)
    available=1024*1024*1024
    const run=await suites.start('smoke');await suites.wait()
    expect((await suites.get(run.id)).exitCode).toBe(0)
  },20000)
  it('cancels the queue and never runs later data rows',async()=>{
    const {root,suites,workbench}=await suiteSetup()
    await writeFile(join(root,'demo.yaml'),flow([{wait:30},assertion],{params:{label:{type:'string'}}}))
    const run=await suites.start('smoke')
    await expect.poll(()=>workbench.activeId).not.toBeNull()
    await suites.cancel(run.id);await suites.wait();const result=await suites.get(run.id)
    expect(result.exitCode).toBe(130);expect(result.cases[1]?.status).toBe('skipped');expect(result.cases[1]?.attempts).toHaveLength(0)
  },15000)
})

it('treats condition capture failures as unknown and never executes the false branch',async()=>{
 const env=await setup();await env.workbench.close();await env.mirror.dispose()
 class Broken extends MockProvider {override async screenSource():ReturnType<MockProvider['screenSource']>{throw new Error('source unavailable')}}
 const mirror=new MirrorService(resolveMirrorConfig({mockStartupDelayMs:0}),'http://127.0.0.1',{providerFactory:()=>new Broken(0)});await mirror.start({provider:'mock'})
 const workbench=new WorkbenchService(mirror,{root:join(env.root,'broken')});cleanup.push(async()=>{await workbench.close();await mirror.dispose()})
 const run=await complete(workbench,flow([{if:{condition:{visible:{text:'hello'}},then:[assertion],else:[{tap:{accessibilityId:'action-card'}},assertion]}}]))
 expect(run.verdict).toBe('inconclusive');expect(run.steps.some(s=>s.kind==='tap')).toBe(false);expect(run.steps[0]?.evidence.some(e=>e.name.endsWith('.png'))).toBe(true)
})
it('replays the original subflow snapshot after the registered file changes',async()=>{
 const {root,workbench}=await setup({flows:{common:'common.yaml'}})
 await writeFile(join(root,'common.yaml'),flow([assertion]))
 const first=await complete(workbench,flow([{runFlow:{ref:'common'}}]))
 await writeFile(join(root,'common.yaml'),flow([{assertVisible:{text:'not the original'}}]))
 const next=await workbench.replay(first.id);await workbench.wait()
 expect((await workbench.get(next.id)).verdict).toBe('pass');expect(next.parentRunId).toBe(first.id)
},15000)
it('preserves a failed attempt and reports flaky with a nonzero CI status',async()=>{
 const {root,suites}=await setup({flows:{main:'main.yaml',reset:'reset.yaml'},extensions:{verify:{module:'verify.mjs',input:object,output:verified,role:'verify'}},suites:{retry:{name:'Retry',cases:[{id:'case',flow:'main',retrySafe:true,retries:1,reset:'reset'}]}}})
 await writeFile(join(root,'main.yaml'),flow([assertion],{verify:[{ref:'verify'}]}))
 await writeFile(join(root,'reset.yaml'),flow([assertion]))
 await writeFile(join(root,'verify.mjs'),`import {readFile,writeFile} from 'node:fs/promises';export default async()=>{const file=${JSON.stringify(join(root,'counter'))};let actual=0;try{actual=Number(await readFile(file,'utf8'))}catch{};actual++;await writeFile(file,String(actual));return {verdict:actual===2?'pass':'fail',expected:2,actual,source:'controlled counter',artifactRefs:[]}}`)
 const run=await suites.start('retry');await suites.wait();const result=await suites.get(run.id)
 expect(result.cases[0]?.status,JSON.stringify(result)).toBe('flaky');expect(result.cases[0]?.attempts).toHaveLength(2);expect(result.exitCode).toBe(1);expect(junitReport(result)).toContain('message="flaky"')
},15000)
it('rejects an undeclared extension and malformed hook input before device acquisition',async()=>{
 const {workbench,mirror}=await setup()
 await expect(workbench.start(flow([assertion],{prepare:[{ref:'missing'}]}))).rejects.toThrow('Unregistered')
 expect(mirror.runOwner).toBeNull();expect(await workbench.list()).toHaveLength(0)
})
it('kills extension child processes on cancellation and ignores late results',async()=>{
 const {root}=await setup();const pidPath=join(root,'pid')
 const source=`import {spawn} from 'node:child_process';import {writeFile} from 'node:fs/promises';export default async()=>{const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await writeFile(${JSON.stringify(pidPath)},String(child.pid));await new Promise(r=>setTimeout(r,10000));return {}}`
 const controller=new AbortController()
 const promise=executeExtension({module:'child.mjs',role:'prepare',timeoutMs:15000,input:{type:'object',properties:{}},output:{type:'object',properties:{}},credentials:{},source,sha256:sha256(source)},{},controller.signal,async()=>{})
 const checked=expect(promise).rejects.toThrow('cancelled fixture')
 await expect.poll(async()=>{try{return Number(await readFile(pidPath,'utf8'))}catch{return 0}}).toBeGreaterThan(0)
 const pid=Number(await readFile(pidPath,'utf8'));controller.abort(new Error('cancelled fixture'));await checked
 await expect.poll(()=>{try{process.kill(pid,0);return true}catch{return false}}).toBe(false)
})

it('recovers a killed preparation as unknown without replaying cleanup writes',async()=>{
 const {root,workbench,mirror,projectPath,resources,yaml}=await businessSetup()
 const source=await readFile(join(root,'seed.mjs'),'utf8')
 await writeFile(join(root,'seed.mjs'),source.replace("return {label:","await new Promise(r=>setTimeout(r,30000));return {label:"))
 const childRoot=join(root,'killed')
 const url=(file:string)=>pathToFileURL(join(process.cwd(),file)).href
 const script=`import {MirrorService} from '${url('src/mirror-service.ts')}';import {resolveMirrorConfig} from '${url('src/mcp-config.ts')}';import {MockProvider} from '${url('src/providers/mock-provider.ts')}';import {WorkbenchService} from '${url('src/workbench-service.ts')}';const m=new MirrorService(resolveMirrorConfig({mockStartupDelayMs:0}),'http://127.0.0.1',{providerFactory:()=>new MockProvider(0)});await m.start({provider:'mock'});const w=new WorkbenchService(m,{root:${JSON.stringify(childRoot)},projectPath:${JSON.stringify(projectPath)}});await w.start(${JSON.stringify(yaml)});await w.wait();`
 await writeFile(join(root,'host.mjs'),script)
 const child=spawn(process.execPath,['--import','tsx',join(root,'host.mjs')],{stdio:'ignore'})
 const exited=new Promise(resolve=>child.once('exit',resolve))
 cleanup.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited})
 await expect.poll(()=>resources.size,{timeout:5000}).toBe(1)
 let runId=''
 await expect.poll(async()=>{try{const {readdir}=await import('node:fs/promises');runId=(await readdir(childRoot)).find(f=>/^[a-f0-9-]{36}$/.test(f))??'';return JSON.parse(await readFile(join(childRoot,runId,'private/resources.json'),'utf8')).length}catch{return 0}}).toBe(1)
 child.kill('SIGKILL');await exited
 const restored=new WorkbenchService(mirror,{root:childRoot,projectPath});cleanup.push(()=>restored.close())
 const run=await restored.get(runId)
 expect(run.verdict).toBe('inconclusive');expect(run.resourceCleanup).toBe('pending');expect(resources.size).toBe(1)
},15000)

it('keeps root blockers active inside registered subflow assertions',async()=>{
 const {root,workbench}=await setup({flows:{common:'common.yaml'}})
 await writeFile(join(root,'common.yaml'),flow([assertion]))
 const run=await complete(workbench,flow([{runFlow:{ref:'common'}}],{blockers:[{text:'Hello, harness.'}]}))
 expect(run.verdict).toBe('evidence-contaminated')
})
it('rejects non-bundled runtime imports in an extension',async()=>{
 const source="export default async()=>{await import('file:///tmp/unregistered-extension.mjs');return {}}"
 await expect(executeExtension({module:'bad.mjs',role:'prepare',timeoutMs:1000,input:{type:'object',properties:{}},output:{type:'object',properties:{}},credentials:{},source,sha256:sha256(source)},{},new AbortController().signal,async()=>{})).rejects.toThrow('failed')
})

it('continues reverse cleanup after one resource fails, retaining only unresolved tokens',async()=>{
 const {root,workbench,projectPath}=await setup({extensions:{seed:{role:'prepare',module:'seed.mjs',input:object,output:object,cleanup:'clean'},clean:{role:'cleanup',module:'clean.mjs',input:{type:'object',properties:{id:{type:'number'}},required:['id']},output:object}}})
 const log=join(root,'cleanup-order')
 await writeFile(join(root,'seed.mjs'),`export default async(_,ctx)=>{await ctx.registerCleanup({id:1});await ctx.registerCleanup({id:2});await ctx.registerCleanup({id:3});return {}}`)
 await writeFile(join(root,'clean.mjs'),`import {appendFile} from 'node:fs/promises';export default async({id})=>{await appendFile(${JSON.stringify(log)},String(id));if(id===2)throw new Error('fixture');return {}}`)
 const run=await complete(workbench,flow([assertion],{prepare:[{ref:'seed'}]}))
 expect(await readFile(log,'utf8')).toBe('321');expect(run.resourceCleanup).toBe('failed');expect(run.verdict).toBe('inconclusive')
 const pending=JSON.parse(await readFile(join(root,'runs',run.id,'private/resources.json'),'utf8'))
 expect(pending).toEqual([{ref:'clean',token:{id:2}}])
})
