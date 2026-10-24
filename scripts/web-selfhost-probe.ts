import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'

const root=resolve('artifacts/visual-acceptance',`selfhost-${new Date().toISOString().replaceAll(':','-')}`)
await mkdir(root,{recursive:true});console.log(root)
const viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0,mockStartupDelayMs:0}),{workbenchRoot:join(root,'a-runs'),webTests:true})
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1280,height:800}})
const rows:unknown[]=[]
page.on('pageerror',error=>console.error('Controller UI:',error.message))
try{
  await viewer.listen()
  const content={name:'Viewer self-hosted acceptance',tags:['web-selftest'],platform:'web',executionKind:'web',target:'synthetic-viewer',scenarioVersion:1,scenarios:process.argv.includes('--eight')?['VA-01','VA-02','VA-03','VA-04','VA-05','VA-06','VA-07','VA-08']:['VA-01','VA-04','VA-05'],calibration:'none'}
  const saved=await viewer.application.cases.save(null,{requestId:randomUUID(),expectedRevision:null,content,publicData:true})
  await page.goto(`${viewer.url}/#/cases/${saved.caseId}/edit`)
  await page.locator('#web-case-name').waitFor();await page.locator('#web-evidence-consent').check()
  await page.locator('#web-start').click();await page.waitForURL(/#\/runs\//)
  await page.locator('#web-run-status').waitFor();await page.screenshot({path:join(root,'a-progress.png'),fullPage:true})
  const id=page.url().split('/runs/')[1]!.split('?')[0]!
  await viewer.workbench.wait()
  const result=await viewer.workbench.record(id);rows.push({kind:'normal',id,run:result})
  await page.reload();await page.locator('#web-run-status').filter({hasText:'finished'}).waitFor()
  await page.screenshot({path:join(root,'a-complete-needs-review.png'),fullPage:true})
  console.log(JSON.stringify(result,null,2))
  await writeFile(join(root,'probe.json'),JSON.stringify({origin:viewer.url,rows},null,2))
}finally{await browser.close();await viewer.close();await writeFile(join(root,'probe-complete.txt'),'Controller stopped; evidence retained.\n')}
