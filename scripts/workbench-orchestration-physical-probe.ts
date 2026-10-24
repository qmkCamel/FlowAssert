/** Explicit capabilities and owned Appium executable are required. No installs or data resets. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import { chromium } from '@playwright/test'
import { stringify } from 'yaml'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { ViewerServer } from '../src/viewer-server.js'
const capsPath=process.env.MOBILE_MIRROR_CAPABILITIES_PATH??'',executable=process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE??''
if(!isAbsolute(capsPath)||!isAbsolute(executable))throw new Error('Explicit CAPABILITIES_PATH and APPIUM_EXECUTABLE required')
const caps=JSON.parse(await readFile(capsPath,'utf8'))
if(!caps['appium:udid']||caps['appium:app']||caps['appium:fullReset'])throw new Error('Selected physical device required; installation/reset forbidden')
const platform=String(caps.platformName).toLowerCase()
if(platform!=='android'&&platform!=='ios')throw new Error('Unknown platform')
const appId=platform==='android'?caps['appium:appPackage']:caps['appium:bundleId']
const text=process.env.MOBILE_MIRROR_EXPECTED_TEXT??'设置'
if(!appId)throw new Error('Explicit installed appId required')
const root=resolve('artifacts/physical-validation',`orchestration-${platform}-${new Date().toISOString().replace(/[:.]/g,'-')}`)
await mkdir(root,{recursive:true,mode:0o700})
const flow=(steps:unknown[],params?:unknown)=>`${stringify({name:'Physical composition',platform,appId,...(params?{params}:{})})}---\n${stringify(steps,{aliasDuplicateObjects:false})}`
await writeFile(resolve(root,'common.yaml'),flow([{assertVisible:{text}}]))
await writeFile(resolve(root,'nested.yaml'),flow([{runFlow:{ref:'common'}}]))
await writeFile(resolve(root,'main.yaml'),flow(['launchApp',{runFlow:{ref:'nested'}},{if:{condition:{equals:['{{ params.branch }}',true]},then:[{repeat:{times:2,steps:[{assertVisible:{text}}]}}],else:[{assertVisible:{text}}]}},{assertVisible:{text}}],{branch:{type:'boolean'}}))
await writeFile(resolve(root,'fail.yaml'),flow([{assertVisible:{text:'MOBILE-MIRROR-INTENTIONAL-FAILURE'}}]))
await writeFile(resolve(root,'cancel.yaml'),flow([{assertVisible:{text}},{repeat:{times:2,steps:[{wait:30},{assertVisible:{text:'MOBILE-MIRROR-MUST-NOT-EXECUTE'}}]}}]))
await writeFile(resolve(root,'rows.json'),JSON.stringify([{id:'true',params:{branch:true}},{id:'false',params:{branch:false}}]))
const projectPath=resolve(root,'project.json')
await writeFile(projectPath,JSON.stringify({flows:{common:'common.yaml',nested:'nested.yaml',main:'main.yaml',negative:'fail.yaml',cancel:'cancel.yaml'},datasets:{rows:'rows.json'},suites:{physical:{name:'Physical composition and failure',cases:[{id:'matrix',flow:'main',dataset:'rows'},{id:'negative',flow:'negative'}]},cancel:{name:'Physical cancellation',cases:[{id:'cancel',flow:'cancel'},{id:'never',flow:'negative'}]}}}))
const config=resolveMirrorConfig({viewerPort:0,defaultProvider:'appium',appiumRuntimeMode:'managed',appiumExecutablePath:executable,appiumSessionStartupTimeoutMs:120_000,startupTimeoutMs:30_000,viewerMediaMode:'auto'})
let viewer=new ViewerServer(config,{workbenchRoot:resolve(root,'runs'),workbenchProjectPath:projectPath})
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const report:Record<string,unknown>={platform,root}
async function until(check:()=>Promise<boolean>,label:string){const deadline=Date.now()+60_000;while(!await check()){if(Date.now()>deadline)throw new Error(`Timed out: ${label}`);await new Promise(r=>setTimeout(r,100))}}
try {
 await viewer.listen();await viewer.service.start({provider:'appium',capabilities:{...caps,'appium:noReset':true,'appium:fullReset':false,'appium:autoLaunch':false}})
 const session=viewer.service.state().sessionId
 const page=await browser.newPage({viewport:{width:1440,height:1100}})
 await page.goto(viewer.url);await page.locator('#language-select').selectOption('zh-CN');await page.locator('#workbench-toggle').click()
 const suite=await viewer.suites.start('physical');await viewer.suites.wait()
 const result=await viewer.suites.get(suite.id);report.suiteId=result.id;report.cases=result.cases.map(c=>({id:c.id,status:c.status,attempts:c.attempts}));report.exitCode=result.exitCode
 if(result.cases[0]?.status!=='pass'||result.cases[1]?.status!=='pass'||result.cases[2]?.status!=='fail')throw new Error('Physical positive/negative expectations not met')
 const paths=[]
 for(const [i,c] of result.cases.slice(0,2).entries()){
  const run=await viewer.workbench.get(c.attempts[0]!)
  const conditions=run.steps.filter(s=>s.kind==='condition').map(s=>JSON.parse(s.message??'{}').result)
  const assertions=run.steps.filter(s=>s.kind==='assert'&&s.status==='passed').length
  if(conditions.length!==1||conditions[0]!== (i===0)||assertions!==(i===0?4:3))throw new Error('Branch/loop evidence differs from expected execution')
  paths.push({caseId:c.id,runId:run.id,conditions,assertions,steps:run.steps.map(s=>({kind:s.kind,path:s.path,status:s.status}))})
 }
 report.paths=paths
 report.sameSession=viewer.service.state().sessionId===session
 if(!report.sameSession)throw new Error('Composition changed the device session')
 const cancelled=await viewer.suites.start('cancel')
 report.cancelSuiteId=cancelled.id
 await until(async()=>Boolean(viewer.workbench.activeId),'active cancel run')
 const runId=viewer.workbench.activeId!
 await until(async()=>(await viewer.workbench.get(runId)).steps.some(s=>s.kind==='wait'&&s.status==='running'),'nested wait')
 await viewer.suites.cancel(cancelled.id);await viewer.suites.wait()
 const cancelResult=await viewer.suites.get(cancelled.id);report.cancelExit=cancelResult.exitCode;report.cancelCases=cancelResult.cases.map(c=>({id:c.id,status:c.status,attempts:c.attempts}))
 if(cancelResult.exitCode!==130||cancelResult.cases[1]?.attempts.length)throw new Error('Cancellation did not stop queue')
 const cancelledRun=await viewer.workbench.get(runId)
 if(cancelledRun.verdict!=='cancelled'||cancelledRun.steps.filter(s=>s.kind==='assert').length!==1)throw new Error('Cancellation executed a later leaf')
 await page.locator('#wb-refresh').click();await page.screenshot({path:resolve(root,'viewer.png'),fullPage:true})
 await viewer.close()
 viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:resolve(root,'runs'),workbenchProjectPath:projectPath})
 await viewer.listen()
 report.restored=(await viewer.suites.get(suite.id)).cases.map(c=>c.status)
 if(JSON.stringify(report.restored)!==JSON.stringify(result.cases.map(c=>c.status)))throw new Error('Restart changed case outcomes')
 const restoredCancel=await viewer.suites.get(cancelled.id)
 if(restoredCancel.exitCode!==130||restoredCancel.cases[1]?.attempts.length)throw new Error('Restart resumed cancelled queue')
 let verified=0
 for(const c of [...result.cases,...cancelResult.cases])for(const id of c.attempts){const run=await viewer.workbench.get(id);for(const file of [...run.evidence,...run.steps.flatMap(s=>s.evidence)]){await viewer.workbench.store.readEvidence(id,file);verified++}}
 report.verifiedArtifacts=verified;report.complete=true
} catch(error){report.error=error instanceof Error?error.message:String(error);process.exitCode=1}
finally {await viewer.close();await browser.close();await writeFile(resolve(root,'report.json'),JSON.stringify(report,null,2));process.stdout.write(JSON.stringify(report,null,2)+'\n')}
