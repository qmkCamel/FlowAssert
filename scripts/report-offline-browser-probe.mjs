import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { chromium, firefox } from '@playwright/test'

// Browser regression probe: isolated profile, no network, passive reviewed file only.
const [name, file] = process.argv.slice(2)
if (!['chrome', 'firefox'].includes(name) || !file) throw new Error('Usage: report-offline-browser-probe chrome|firefox reviewed-report.html')
const browser = await (name === 'firefox' ? firefox : chromium).launch({ headless: true,
  ...(name === 'chrome' ? { executablePath: process.env.MM_BROWSER_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
try {
  const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 900 } })
  const page = await context.newPage(), requests = [], errors = []
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(pathToFileURL(resolve(file)).href)
  assert.match(await page.locator('h1').innerText(), /Reviewed derived report/)
  assert.match(await page.locator('.warning').innerText(), /Not revalidated/)
  assert.match(await page.locator('#omitted').innerText(), /raw observations were omitted/)
  assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(245, 247, 251)')
  const images = page.locator('img')
  for (let index = 0; index < await images.count(); index++) await images.nth(index).evaluate(image => image.decode())
  await page.keyboard.press('Tab'); assert.equal(await page.locator('a[href="#scope"]').evaluate(el => document.activeElement === el), true)
  await page.keyboard.press('Enter'); assert.match(page.url(), /#scope$/)
  await page.getByRole('link', { name: '步骤 / Steps', exact: true }).click(); assert.match(page.url(), /#steps$/)
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await mkdir('artifacts/screenshots',{recursive:true}); await page.screenshot({path:`artifacts/screenshots/report-offline-${name}-narrow.png`,fullPage:true})
  await page.emulateMedia({media:'print'}); await page.screenshot({path:`artifacts/screenshots/report-offline-${name}-print.png`,fullPage:true})
  assert.deepEqual(requests,[]); assert.deepEqual(errors,[])
  await mkdir('artifacts/reports',{recursive:true})
  const result={browser:name,version:browser.version(),profile:'isolated/headless',scope:name==='firefox'?'Playwright-managed Firefox build':'installed Google Chrome',fileUrl:true,offline:true,externalRequests:requests.length,keyboard:'Tab/Enter and anchors pass',narrow:'390px no overflow',print:'screen rendering inspected separately',sourceSemantics:'not-revalidated/omitted visible'}
  await writeFile(`artifacts/reports/report-offline-${name}.json`,JSON.stringify(result,null,2)); console.log(JSON.stringify(result))
  await context.close()
} finally {await browser.close()}
