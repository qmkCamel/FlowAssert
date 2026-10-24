import { readFile,writeFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { chromium } from '@playwright/test'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { reviewWebRun } from '../src/workbench-web-review.js'
import { isWebRun } from '../src/workbench-web-contracts.js'
// Review file is supplied only after actual screenshot inspection, never generated from assertion/fault labels.
const [rootArg,id,reviewPath]=process.argv.slice(2);if(!rootArg||!id||!reviewPath)throw new Error('Usage: web-selfhost-review.ts <probe-root> <run-id> <actual-review.json>')
const root=resolve(rootArg),viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:join(root,'a-runs'),webTests:true})
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1280,height:800}})
try{
  await viewer.listen();await viewer.workbench.store.init()
  const supplied=JSON.parse(await readFile(resolve(reviewPath),'utf8'))
  const run=process.argv.includes('--capture-only') ? await viewer.workbench.record(id) : await reviewWebRun(viewer.workbench.store,id,supplied)
  if(!isWebRun(run))throw new Error('Expected Web run')
  await page.goto(`${viewer.url}/#/runs/${id}`);await page.locator('#web-run-status').filter({hasText:`finished · ${run.verdict}`}).waitFor()
  await page.locator('#web-run-report img').evaluateAll(images=>Promise.all(images.map(image=>{const img=image as HTMLImageElement;img.loading='eager';return img.decode()})))
  await page.screenshot({path:join(root,`a-reviewed-${run.verdict}-${id}.png`),fullPage:true})
  await page.locator('#web-run-report details').evaluateAll(details=>details.forEach(item=>item.removeAttribute('open')))
  await page.screenshot({path:join(root,`a-summary-${run.verdict}-${id}.png`),fullPage:true})
  const module=new URL('./web-visual-acceptance/verify-product.mjs',import.meta.url).href
  const {verifyProduct,verifyProductRecord}=await import(module)
  const checked=await verifyProduct(join(root,'a-runs',id));await writeFile(join(root,`independent-${id}.json`),JSON.stringify(checked,null,2))
  if(run.verdict==='fail'){
    const fake=structuredClone(run);fake.verdict='pass';fake.visualReview.status='pass';fake.independentCheck='pass'
    const rejected=await verifyProductRecord(fake,(file:any)=>viewer.workbench.store.readEvidence(id,file))
    if(rejected.reportConsistent||rejected.pass)throw new Error('False pass was not rejected')
    await writeFile(join(root,'false-pass-rejected.json'),JSON.stringify(rejected,null,2))
  }
  const snapshot=await viewer.workbench.record(id);await viewer.close()
  const reopened=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:join(root,'a-runs'),webTests:true})
  try{await reopened.listen();const restored=await reopened.workbench.record(id);if(!isWebRun(restored)||restored.verdict!==snapshot.verdict)throw new Error('Reviewed verdict changed on restart')
    await page.goto(`${reopened.url}/#/runs/${id}`);await page.locator('#web-run-status').filter({hasText:`finished · ${run.verdict}`}).waitFor()
    await page.locator('#web-run-report img').evaluateAll(images=>Promise.all(images.map(image=>{const img=image as HTMLImageElement;img.loading='eager';return img.decode()})))
    await page.screenshot({path:join(root,`a-reviewed-restart-${id}.png`),fullPage:true})
  }finally{await reopened.close()}
  console.log(JSON.stringify({verdict:run.verdict,checked},null,2))
}finally{await browser.close();await viewer.close()}
