/** Explicit physical-device acceptance for archived run comparison. */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createFixtureProject } from '../fixtures/business/project.js'
import { startFixtureServer } from '../fixtures/business/server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { ViewerServer } from '../src/viewer-server.js'
import type { ComparisonReport } from '../src/workbench-comparison.js'

const capsPath=process.env.MOBILE_MIRROR_CAPABILITIES_PATH??'',executable=process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE??''
if(!isAbsolute(capsPath)||!isAbsolute(executable))throw new Error('Explicit absolute capabilities and Appium executable paths required')
const caps=JSON.parse(await readFile(capsPath,'utf8')) as Record<string,unknown>,platform=String(caps.platformName).toLowerCase()
if(platform!=='android'&&platform!=='ios')throw new Error('Android or iOS required')
if(!caps['appium:udid']||caps['appium:app']||caps['appium:fullReset']||(platform==='android'?caps['appium:appPackage']:caps['appium:bundleId'])!=='dev.mobilemirror.fixture')throw new Error('Only a preinstalled Fixture on an explicit device is allowed')
const root=resolve('artifacts/physical-validation',`run-comparison-${platform}-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(root,{recursive:true,mode:0o700})
const host=process.env.FIXTURE_HOST??'127.0.0.1',deviceBase=process.env.FIXTURE_DEVICE_URL??'http://127.0.0.1:47831'
const server=await startFixtureServer({database:resolve(root,'orders.sqlite'),host,port:47831}),project=await createFixtureProject(resolve(root,'project'),platform,'http://127.0.0.1:47831',deviceBase)
const config=resolveMirrorConfig({viewerPort:0,defaultProvider:'appium',appiumRuntimeMode:'managed',appiumExecutablePath:executable,appiumSessionStartupTimeoutMs:120_000,startupTimeoutMs:30_000,viewerMediaMode:'auto'})
let viewer=new ViewerServer(config,{workbenchRoot:resolve(root,'runs'),workbenchProjectPath:project}),browser=await chromium.launch({headless:true,...(!existsSync(chromium.executablePath())?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})}),report:Record<string,unknown>={platform,root,runs:[],comparisons:[]}
const terminal=async(id:string)=>{for(let i=0;i<600;i++){const value=await viewer.comparisons.get(id);if(!['queued','running'].includes(value.state))return value;await new Promise(r=>setTimeout(r,100))}throw new Error('Comparison timed out')}
try{
  await viewer.listen();await viewer.service.start({provider:'appium',capabilities:{...caps,'appium:noReset':true,'appium:fullReset':false,'appium:autoLaunch':false}})
  const runIds:string[]=[]
  for(const suiteName of ['positive','positive','negative']){const suite=await viewer.suites.start(suiteName);await viewer.suites.wait();const suiteRun=await viewer.suites.get(suite.id),id=suiteRun.cases[0]?.attempts[0];if(!id)throw new Error('Missing fixture run');const run=await viewer.workbench.get(id);runIds.push(id);(report.runs as unknown[]).push({suiteName,id,verdict:run.verdict,businessVerification:run.businessVerification,cleanup:run.resourceCleanup,comparison:run.comparison});if(run.verdict!==(suiteName==='negative'?'fail':'pass')||run.resourceCleanup!=='pass')throw new Error(`${suiteName} fixture run failed acceptance`) }
  const strict=await terminal((await viewer.comparisons.start(runIds[0]!,runIds[1]!)).id),review=await terminal((await viewer.comparisons.start(runIds[1]!,runIds[2]!)).id)
  if(strict.comparability!=='comparable'||!['completed','partial'].includes(strict.state)||review.comparability!=='review-only'||!review.classifications.some(v=>v.domain==='business-assertion'))throw new Error('Comparison classification acceptance failed')
  ;(report.comparisons as unknown[]).push(summary(strict),summary(review))
  const page=await browser.newPage({viewport:{width:1440,height:1200}});await page.goto(viewer.url);await page.locator('#language-select').selectOption('zh-CN');await page.locator('#workbench-toggle').click();await page.locator(`[data-run-id="${runIds[2]}"]`).click();await expect(page.locator('.wb-run-id')).toHaveText(runIds[2]!);await expect(page.locator('.wb-comparison select')).toHaveValue(/.+/);await page.locator('.wb-comparison button').click();await expect(page.locator('.wb-comparison')).toContainText(/比较报告 · (completed|partial)/,{timeout:20_000});await page.screenshot({path:resolve(root,'viewer-comparison.png'),fullPage:true})
  await viewer.service.stop();await viewer.close();viewer=new ViewerServer(resolveMirrorConfig({viewerPort:0}),{workbenchRoot:resolve(root,'runs'),workbenchProjectPath:project});await viewer.listen()
  for(const previous of [strict,review]){const restored=await viewer.comparisons.get(previous.id);if(JSON.stringify(restored)!==JSON.stringify(previous))throw new Error('Comparison report changed after restart');for(const artifact of restored.artifacts){const {bytes}=await viewer.comparisons.readArtifact(restored.id,artifact.id);if(createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw new Error('Derived artifact hash mismatch')}}
  report.complete=true
}catch(error){report.error=error instanceof Error?error.message:String(error);process.exitCode=1}
finally{await viewer.close().catch(()=>{});await server.close();await browser.close();await writeFile(resolve(root,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2))}

function summary(value:ComparisonReport){return {id:value.id,state:value.state,comparability:value.comparability,baselineRunId:value.baselineRunId,targetRunId:value.targetRunId,firstConfirmedDifference:value.firstConfirmedDifference,classifications:value.classifications,artifacts:value.artifacts}}
