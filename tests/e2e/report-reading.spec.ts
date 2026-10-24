import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir, cpus, platform, release } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'
import type { TestRun } from '../../src/workbench-domain.js'
let root: string, viewer: ViewerServer
const at = '2026-10-06T00:00:00.000Z'
function runFixture(index = 1): TestRun {
  return { schemaVersion: 1, id: `00000000-0000-4000-8000-${String(index).padStart(12,'0')}`, name: `Report ${index}`, yaml: 'private-source', engine: 'synthetic-reading-fixture', phase: 'finished', verdict: 'fail', startedAt: at, endedAt: at, sessionId: 'private-session', deviceName: 'Synthetic phone', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions', businessVerification: 'not-performed', visualVerification: 'not-performed', cleanup: 'session-retained', steps: [], evidence: [] }
}
test.beforeEach(async () => { root = await mkdtemp(join(tmpdir(),'report-reading-')); viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }),{ workbenchRoot: root }); await viewer.listen(); await viewer.workbench.store.init() })
test.afterEach(async () => { await viewer.close(); await rm(root,{recursive:true,force:true}) })
async function checkReportTextContrast(page: import('@playwright/test').Page, selectors: string[]) {
  const measurements = await page.evaluate(selectors => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    const rgba = (value: string) => { context.clearRect(0,0,1,1); context.fillStyle = value; context.fillRect(0,0,1,1); return [...context.getImageData(0,0,1,1).data] }
    const luminance = (rgb: number[]) => rgb.slice(0,3).map(v => { const s=v/255; return s<=.04045?s/12.92:((s+.055)/1.055)**2.4 }).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i]!,0)
    return selectors.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)].filter(el=>el.getClientRects().length && !el.matches(':disabled')).map(el => {
      const layers: number[][] = []; let parent: HTMLElement|null = el
      while(parent){layers.unshift(rgba(getComputedStyle(parent).backgroundColor));parent=parent.parentElement}
      let background=[7,10,17]
      for(const layer of layers) background=background.map((v,i)=>layer[i]!*(layer[3]!/255)+v*(1-layer[3]!/255))
      const foreground=rgba(getComputedStyle(el).color).slice(0,3), fg=luminance(foreground),bg=luminance(background)
      return {selector,text:el.textContent?.slice(0,80),ratio:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05),scope:'Text colors over computed solid backgrounds; gradients and screen readers require separate review'}
    }))
  },selectors)
  expect(measurements.length).toBeGreaterThan(3)
  for(const item of measurements) expect(item.ratio, `${item.selector}: ${item.text}`).toBeGreaterThanOrEqual(4.5)
  await mkdir('artifacts/reports',{recursive:true}); await writeFile('artifacts/reports/report-text-contrast.json',JSON.stringify(measurements,null,2))
}
async function phoneFixture() {
  const run = runFixture()
  const svg = `<svg width="1170" height="2532"><rect width="1170" height="2532" fill="#eef2fa"/><rect x="50" y="100" width="1070" height="180" rx="20" fill="#243a61"/><text x="100" y="210" font-size="65" fill="white">SYNTHETIC SCREEN</text><text x="80" y="480" font-size="55" fill="#182239">private-account-123</text><rect x="80" y="600" width="1000" height="140" rx="20" fill="#ce5151"/><text x="150" y="690" font-size="48" fill="white">Recorded failure</text></svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer(), file = await viewer.workbench.store.put(run.id,'step-1.png',png,'image/png')
  run.steps = [{ index:1, kind:'assert', status:'failed', error:'Expected visible control', startedAt:at, endedAt:at, evidence:[file] },{ index:2, kind:'tap',status:'passed',startedAt:at,endedAt:at,evidence:[] },{ index:3,kind:'assert',status:'failed',error:'Second failure',startedAt:at,endedAt:at,evidence:[] }]
  await viewer.workbench.store.save(run); return { run, png }
}
test('catalog preserves filtering, pagination, focus and prior page on delayed failure', async ({ page }) => {
  for (let index=1;index<=55;index++) await viewer.workbench.store.save(runFixture(index))
  await page.goto(`${viewer.url}/#/runs`); await expect(page.locator('#report-list tbody tr')).toHaveCount(50)
  await expect(page.locator('.report-counts')).toContainText('55')
  await page.locator('#journey-run-more').click(); await expect(page.locator('#report-list tbody tr')).toHaveCount(5)
  const first = page.locator('.journey-run').first(), id = await first.getAttribute('id'); await first.click(); await expect(page.locator('#analysis-summary')).toBeVisible(); await page.goBack()
  await expect(page.locator('#report-list tbody tr')).toHaveCount(5); await expect(page.locator(`#${id}`)).toBeFocused()
  await page.route('**/api/workbench/reports?**',async route => { await new Promise(resolve=>setTimeout(resolve,650)); await route.fulfill({status:503,contentType:'application/json',body:'{"error":"read unavailable"}'}) })
  await page.locator('#journey-run-refresh').click(); await expect(page.locator('#report-status')).toContainText('Reading reports'); await expect(page.locator('#report-list tbody tr')).toHaveCount(5)
  await page.locator('.report-tabs button[data-view=trends]').click(); await expect(page.locator('#wb-trend-load')).toBeVisible()
  await page.locator('.report-tabs button[data-view=all]').click(); await expect(page.locator('#journey-run-refresh')).toBeEnabled(); await expect(page.locator('#report-status')).toContainText('read unavailable'); await expect(page.locator('#report-status')).toContainText(/Last successful read|上次成功读取/)
  await page.screenshot({path:'artifacts/screenshots/report-catalog-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844}); await page.locator('#language-select').selectOption('zh-CN'); await expect(page.locator('#report-status')).toContainText('读取失败'); await expect(page.locator('#report-status')).toContainText('read unavailable'); await expect(page.locator('#report-status')).toContainText(/Last successful read|上次成功读取/); await page.screenshot({path:'artifacts/screenshots/report-catalog-narrow.png',fullPage:true})
})
test('a search delayed by 650ms cannot replace a newer filtered page', async ({page}) => {
  for(let index=1;index<=55;index++) await viewer.workbench.store.save(runFixture(index))
  await page.goto(`${viewer.url}/#/runs`); await expect(page.locator('#report-list tbody tr')).toHaveCount(50)
  let olderCompleted=false
  await page.route('**/api/workbench/reports?**', async route => {
    const previous = new URL(route.request().url()).searchParams.get('query') === 'Report 1'
    const response=await route.fetch(); if(previous) await new Promise(resolve=>setTimeout(resolve,650))
    await route.fulfill({response}); if(previous) olderCompleted=true
  })
  await page.locator('#journey-run-filter').fill('Report 1'); await expect(page.locator('#report-status')).toContainText('Reading reports')
  await page.locator('#journey-run-filter').fill('Report 55'); await expect(page.locator('#report-list tbody tr')).toHaveCount(1)
  await expect(page.locator('.journey-run')).toHaveText('Report 55'); await expect.poll(()=>olderCompleted).toBe(true)
  await expect(page.locator('#report-list tbody tr')).toHaveCount(1); await expect(page.locator('.journey-run')).toHaveText('Report 55')
})
test('uses the existing trend denominator and maps its exact time range to the report directory', async ({page}) => {
  await viewer.workbench.store.save(runFixture(1))
  await page.setViewportSize({width:1440,height:900}); await page.goto(`${viewer.url}/#/runs`)
  await page.locator('.report-tabs button[data-view=trends]').click()
  await page.locator('#wb-trend-from').fill('2026-10-06'); await page.locator('#wb-trend-to').fill('2026-10-06')
  await page.locator('#wb-trend-load').click(); await expect(page.locator('#wb-trend-results')).toContainText('directory counts executions')
  await expect(page.locator('#wb-trend-results')).toContainText('1 unplanned')
  await page.screenshot({path:'artifacts/screenshots/report-trends-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844}); await page.screenshot({path:'artifacts/screenshots/report-trends-narrow.png',fullPage:true})
  await page.getByRole('button',{name:'View executions in this time range',exact:false}).click()
  await expect(page.locator('#report-from')).toHaveValue('2026-10-06'); await expect(page.locator('#report-list tbody tr')).toHaveCount(1)
  await page.evaluate(()=>document.dispatchEvent(new CustomEvent('report:range',{detail:{from:'2026-10-06T00:15:00.000Z',to:'2026-10-06T00:45:00.000Z'}})))
  await expect(page.locator('#report-status')).toContainText('cannot be represented by date filters'); await expect(page.locator('#report-from')).toHaveValue('2026-10-06'); await expect(page.locator('#report-list tbody tr')).toHaveCount(1)
})
test('background polling does not repeatedly abort a slow report read', async ({page}) => {
  const {run}=await phoneFixture(); let reads=0
  await page.route(`**/api/runs/${run.id}`,async route=>{reads++;await new Promise(resolve=>setTimeout(resolve,1500));await route.continue()})
  await page.goto(`${viewer.url}/#/runs/${run.id}`);await expect(page.locator('#analysis-summary')).toContainText('Loading run')
  await page.locator('.journey-nav a[data-page=runs]').click();await expect(page.locator('#report-list')).toBeVisible();await page.goBack()
  await expect(page.locator('#analysis-summary')).toContainText('Recorded verdict: Failed',{timeout:10000});await expect(page.locator('#analysis-evidence img')).toBeVisible()
  const completedReads=reads
  await page.waitForTimeout(2200)
  expect(reads).toBe(completedReads)
})
test('reads real-size synthetic evidence, navigates failures, zooms and exports the exact reviewed redacted file', async ({ page, browser }) => {
  const {run,png} = await phoneFixture(); const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message))
  await page.setViewportSize({width:1440,height:900}); await page.goto(`${viewer.url}/#/runs/${run.id}?tab=evidence`)
  await expect(page.locator('#analysis-evidence img')).toBeVisible(); await expect(page.locator('#analysis-summary')).toContainText('2 failed steps')
  await checkReportTextContrast(page, ['#analysis-summary h1','#analysis-summary > p','#analysis-summary .wb-warning','#analysis-next-failure','#analysis-steps label','#journey-analysis > nav a'])
  await page.locator('#analysis-step-search').fill('Tap'); await expect(page.locator('#analysis-steps button[data-step="1"]')).toBeVisible(); await expect(page.locator('#analysis-steps button[data-step="3"]')).toBeHidden()
  await page.locator('#analysis-next-failure').click(); await expect(page).toHaveURL(/step=3/); await page.locator('#analysis-previous-failure').click(); await expect(page).toHaveURL(/step=1/)
  await page.locator('.report-image-tools').getByRole('button',{name:'Original size',exact:true}).click(); await expect(page.locator('#analysis-evidence img')).toHaveCSS('width','1170px')
  await page.locator('.report-image-tools').getByRole('button',{name:'Fit',exact:true}).click(); await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:'artifacts/screenshots/report-analysis-desktop.png'})
  await page.setViewportSize({width:390,height:844}); await page.screenshot({path:'artifacts/screenshots/report-analysis-narrow.png',fullPage:true})
  await page.locator('body').evaluate(element=>{element.style.zoom='2'}); await page.screenshot({path:'artifacts/screenshots/report-analysis-200-percent.png',fullPage:true}); await page.locator('body').evaluate(element=>{element.style.zoom='1'}); await page.setViewportSize({width:1440,height:900})
  await page.locator('#journey-analysis > nav a').filter({hasText:'Share'}).click()
  const share = page.locator('#analysis-secondary .wb-share'); await share.locator(':scope > summary').click(); await share.locator('input[type=checkbox]').first().check()
  await share.getByText('Open image and draw masks',{exact:true}).click(); await expect(share.locator('.redaction-plane img')).toBeVisible()
  await share.locator('.redaction-plane').scrollIntoViewIfNeeded()
  const box = await share.locator('.redaction-plane img').boundingBox(); if (!box) throw new Error('Missing redaction image')
  await page.mouse.move(box.x+box.width*.04,box.y+box.height*.13); await page.mouse.down(); await page.mouse.move(box.x+box.width*.94,box.y+box.height*.22); await page.mouse.up(); await expect(share.locator('.redaction-mask')).toHaveCount(1)
  await share.locator('.redaction-plane').focus(); await page.keyboard.press('ArrowRight'); await share.getByRole('button',{name:'Undo',exact:true}).click()
  await page.route('**/api/workbench/share/jobs',async route=>{await new Promise(resolve=>setTimeout(resolve,650));await route.continue()})
  await share.getByRole('button',{name:'Preview derived content',exact:true}).click(); await expect(share).toContainText('Preparing'); await expect(share.getByRole('button',{name:'Preview derived content',exact:true})).toBeDisabled()
  await page.locator('.journey-nav a[data-page=runs]').click(); await expect(page.locator('#report-list')).toBeVisible(); await page.goBack()
  await expect(share.locator('iframe')).toBeVisible(); await expect(share.frameLocator('iframe').locator('body')).toContainText('Not revalidated'); await expect(share.frameLocator('iframe').locator('body')).toHaveCSS('background-color','rgb(245, 247, 251)')
  await share.locator('iframe').scrollIntoViewIfNeeded(); await expect(share.frameLocator('iframe').getByRole('heading',{level:1})).toBeVisible(); await expect.poll(async () => {const pixels = await sharp(await share.locator('iframe').screenshot()).stats(); return pixels.channels[0]!.stdev}, {timeout:10000}).toBeGreaterThan(10); await page.screenshot({path:'artifacts/screenshots/report-share-preview.png'})
  await share.locator('input[type=checkbox]').last().check()
  const downloadPromise = page.waitForEvent('download'); await share.getByRole('button',{name:'Download reviewed report',exact:true}).click(); await expect(share).toContainText('Preparing'); await page.locator('.journey-nav a[data-page=runs]').click(); await expect(page.locator('#report-list')).toBeVisible(); await page.goBack(); const download = await downloadPromise
  const path = await download.path(); if (!path) throw new Error('No download path'); const html = await readFile(path,'utf8')
  expect(html).toBe(await share.locator('iframe').getAttribute('srcdoc')); expect(html).not.toContain('private-session'); expect(html).not.toContain('private-source')
  await mkdir('artifacts/reports',{recursive:true}); await writeFile('artifacts/reports/reviewed-synthetic-report.html',html)
  expect(await readFile(join(root,run.id,'step-1.png'))).toEqual(png); expect(errors).toEqual([])
  const recipientContext = await browser.newContext({offline:true,viewport:{width:1440,height:900}}), recipient=await recipientContext.newPage(), remote:string[]=[]
  try {
    recipient.on('request',request=>{if (/^https?:/.test(request.url())) remote.push(request.url())})
    await recipient.goto(`file://${join(process.cwd(),'artifacts/reports/reviewed-synthetic-report.html')}`); await expect(recipient.getByRole('heading',{level:1})).toContainText('Reviewed derived report'); expect(remote).toEqual([])
    await recipient.emulateMedia({media:'print'}); await recipient.screenshot({path:'artifacts/screenshots/report-offline-print.png',fullPage:true})
  } finally {await recipientContext.close()}

})
test('1000-summary directory cold-page and warm-refresh performance, 30 samples each', async ({page,browser}) => {
  test.skip(process.env.REPORT_PERFORMANCE !== '1', 'Run the performance measurement separately from concurrent native-worker gates')
  test.setTimeout(120000)
  let manifestBytes=0
  for(let index=1;index<=1000;index++){const run=runFixture(index), text=JSON.stringify(run); manifestBytes+=Buffer.byteLength(text); await mkdir(join(root,run.id),{recursive:true});await writeFile(join(root,run.id,'manifest.json'),text)}
  const cold:number[]=[],warm:number[]=[]
  for(let index=0;index<30;index++){const start=performance.now();await page.goto(`${viewer.url}/?report-bench=${index}#/runs`);await expect(page.locator('#report-list tbody tr')).toHaveCount(50);cold.push(performance.now()-start);const next=performance.now();await page.locator('#journey-run-refresh').click();await expect(page.locator('#journey-run-refresh')).toBeEnabled();warm.push(performance.now()-next)}
  const p95=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]!
  await mkdir('artifacts/reports',{recursive:true});await writeFile('artifacts/reports/report-performance.json',JSON.stringify({candidateBase:'REDACTED_REVISION',datasetRecords:1000,manifestBytes,stepsPerRecord:0,artifactsPerRecord:0,hardware:cpus()[0]?.model,os:`${platform()} ${release()}`,browser:browser.version(),coldDefinition:'Fresh page navigation; filesystem cache not evicted',cold,warm,coldP95:p95(cold),warmP95:p95(warm),targetMs:2000},null,2));expect(p95(cold)).toBeLessThanOrEqual(2000);expect(p95(warm)).toBeLessThanOrEqual(2000)
})
