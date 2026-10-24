import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { stringify } from 'yaml'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { emptyProject } from '../src/workbench-project.js'
import { planRecovery } from '../src/workbench-recovery.js'

// --deepseek uses a real model, but the device is always simulated.
const realModel=process.argv.includes('--deepseek')
if(realModel&&!process.env.MIRROR_DEEPSEEK_KEY)throw new Error('Set MIRROR_DEEPSEEK_KEY in the process environment')
class NavigationFixture extends MockProvider {
  override async screenSource():ReturnType<MockProvider['screenSource']>{
    const source=await super.screenSource()
    if(source.kind==='normalized')source.structure.nodes=source.structure.nodes.filter(n=>!n.sensitive)
    return source
  }
}
const root=resolve(`artifacts/fixture/${realModel?'recovery-deepseek-workbench':'recovery-controlled'}`,new Date().toISOString().replaceAll(':','-'))
await mkdir(root,{recursive:true})
const mirror=new MirrorService(resolveMirrorConfig({mockStartupDelayMs:0}),'http://127.0.0.1',{providerFactory:()=>new NavigationFixture(0)})
let requests=0
let workbench=new WorkbenchService(mirror,{root:join(root,'runs'),planner:async (input,policy,model,signal,usage)=>{
  requests++
  if(realModel)return planRecovery(input,policy,model,signal,usage)
  return {decision:'propose',observationId:input.id,action:{kind:'tap',nodeId:input.candidates[0]!.nodeId},reason:'Controlled fixture proposal; not a real model'}
}})
try {
  await mirror.start({provider:'mock'})
  const project=emptyProject(),appId='com.example.mobilemirror.mock'
  project.recoveryModels.fixture=realModel?{endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-flash',apiKeyEnv:'MIRROR_DEEPSEEK_KEY',thinking:'disabled'}:{endpoint:'http://127.0.0.1:9/unused',model:'controlled-test-only',apiKeyEnv:'UNUSED'}
  project.recoveryPolicies.nav={mode:'auto',platform:'ios',appId,intent:'Open the next synthetic demo state by tapping the demo button labeled "0 actions received".',modelRef:'fixture',navigationOnly:true,allowImageSharing:true,page:{text:'Hello, harness.'},allowedTargets:[{accessibilityId:'action-card'}]}
  const yaml=`${stringify({name:'Controlled recovery proof',platform:'ios',appId})}---\n${stringify([{recover:{id:'navigation',policy:'nav',step:{tap:{accessibilityId:'obsolete-navigation'}},postcondition:{visible:{text:'1 actions received'}}}}])}`
  const started=await workbench.start(yaml,undefined,undefined,{project})
  await workbench.wait();const before=await workbench.get(started.id)
  if(before.verdict!=='recovered'||requests!==1||before.dispatches?.length!==1)throw new Error(`Unexpected recovery result: ${before.verdict}: ${before.error}`)
  await workbench.close()
  workbench=new WorkbenchService(mirror,{root:join(root,'runs')})
  const after=await workbench.get(started.id)
  if(after.verdict!=='recovered')throw new Error('Restart integrity verification failed')
  const report={scope:realModel?'real-model-and-mock-device':'controlled-planner-and-mock-device',realModel,physicalDevice:false,root,runId:after.id,verdict:after.verdict,modelRequests:requests,deviceWrites:after.dispatches?.length,verifiedFiles:after.evidence.length+after.steps.reduce((n,s)=>n+s.evidence.length,0),originalFailureRetained:after.steps.some(s=>s.status==='failed'&&s.recoveredBy),restartVerified:true}
  await writeFile(join(root,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
} finally {await workbench.close();await mirror.dispose()}
