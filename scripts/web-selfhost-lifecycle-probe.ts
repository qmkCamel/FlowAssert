import { fork,execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdir,writeFile,readFile,readdir } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { isWebRun } from '../src/workbench-web-contracts.js'
const content={name:'Web lifecycle probe',tags:['web-selftest'],platform:'web',executionKind:'web',target:'synthetic-viewer',scenarioVersion:1,scenarios:['VA-01','VA-04','VA-05'],calibration:'none'}
const root=process.argv[2]==='--crash-child'?process.argv[3]!:resolve('artifacts/visual-acceptance',`lifecycle-${new Date().toISOString().replaceAll(':','-')}`)
await mkdir(root,{recursive:true})
const options={workbenchRoot:join(root,'a-runs'),webTests:true}
let viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0,mockStartupDelayMs:0}),options)
async function save(value=content,caseId:string|null=null,revision:string|null=null){return viewer.application.cases.save(caseId,{requestId:randomUUID(),expectedRevision:revision,content:value,publicData:true})}
async function start(saved:{caseId:string;revisionId:string},parentRunId?:string){const revision=await viewer.application.cases.revision(saved.caseId,saved.revisionId);const value=revision.platform==='web'?{...content,scenarios:revision.scenarios,calibration:revision.calibration}:content;return viewer.workbench.startWeb(value,{caseId:saved.caseId,revisionId:saved.revisionId,inputDigest:revision.contentDigest},randomUUID(),viewer.url,parentRunId)}
if(process.argv[2]==='--crash-child'){
  await viewer.listen();const saved=await save({...content,scenarios:['VA-02','VA-01','VA-04','VA-05']});const run=await start(saved)
  process.send?.({id:run.id,origin:viewer.url});await viewer.workbench.wait();await viewer.close()
}else{
  console.log(root);const rows:any[]=[]
  const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1280,height:800}})
  async function capture(id:string,name:string){await page.goto(`${viewer.url}/#/runs/${id}`);await page.locator(`#web-run-report[data-run-id="${id}"] #web-run-status`).filter({hasText:'finished'}).waitFor();await page.screenshot({path:join(root,`${name}.png`),fullPage:true})}
  try{
    await viewer.listen()
    const fault=await save({...content,scenarios:['VA-05'],calibration:'hidden-retry'}),failed=await start(fault);await viewer.workbench.wait();rows.push({kind:'fault',id:failed.id});await capture(failed.id,'a-failure')
    const repaired=await save({...content,scenarios:['VA-05']},fault.caseId,fault.revisionId),retry=await start(repaired,failed.id);await viewer.workbench.wait();rows.push({kind:'recovered-attempt',id:retry.id,parentRunId:failed.id});await capture(retry.id,'a-recovered-needs-review')
    const cancelCase=await save({...content,scenarios:['VA-02','VA-01','VA-04','VA-05']}),cancelled=await start(cancelCase)
    await page.goto(`${viewer.url}/#/runs/${cancelled.id}`);await page.locator('#web-cancel').waitFor();await page.screenshot({path:join(root,'a-cancellable-progress.png'),fullPage:true});await page.locator('#web-cancel').click();await viewer.workbench.wait();rows.push({kind:'cancelled',id:cancelled.id});await capture(cancelled.id,'a-cancelled')
    const before=await viewer.workbench.record(retry.id);await viewer.close();viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),options);await viewer.listen();const after=await viewer.workbench.record(retry.id)
    if(JSON.stringify(before.evidence)!==JSON.stringify(after.evidence)||before.verdict!==after.verdict)throw new Error('Restart changed original evidence or verdict')
    await capture(retry.id,'a-restart-history');await viewer.close()
    const crashRoot=join(root,'crash');await mkdir(crashRoot)
    const child=fork(fileURLToPath(import.meta.url),['--crash-child',crashRoot],{execArgv:['--import','tsx'],stdio:['ignore','ignore','ignore','ipc']})
    const binding=await new Promise<any>((done,reject)=>{const timeout=setTimeout(()=>reject(new Error('A start timeout')),30_000);child.once('message',value=>{clearTimeout(timeout);done(value)})})
    let manifest:any;const limit=Date.now()+30000
    do{manifest=JSON.parse(await readFile(join(crashRoot,'a-runs',binding.id,'manifest.json'),'utf8'));if(manifest.resources.sessions.length)break;await delay(100)}while(Date.now()<limit)
    if(!manifest.resources.sessions.length)throw new Error('A did not journal browser ownership')
    const exit=new Promise<void>(done=>child.once('exit',()=>done()));child.kill('SIGKILL');await exit
    viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:join(crashRoot,'a-runs'),webTests:true});await viewer.listen()
    const interrupted=await viewer.workbench.record(binding.id);if(!isWebRun(interrupted)||interrupted.verdict!=='inconclusive'||interrupted.cleanup!=='pending')throw new Error('Interrupted run was not conservatively recovered')
    rows.push({kind:'crash-restart',id:binding.id,root:crashRoot});await capture(binding.id,'a-crash-restart')
    // Explicit test-owner cleanup only, never product recovery by recycled PID.
    for(const session of manifest.resources.sessions)await promisify(execFile)('agent-browser',['--config',resolve('scripts/web-visual-acceptance/config.json'),'--session',session,'--namespace',session,'close'],{timeout:15000}).catch(()=>{})
    await writeFile(join(root,'probe.json'),JSON.stringify({rows},null,2));console.log(JSON.stringify(rows,null,2))
  }finally{await browser.close();await viewer.close()}
}
