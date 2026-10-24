import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { chromium } from '@playwright/test'

// Read-only historical device captures. All mutations are confined to the private copy.
const [entry, inputPath, outputPath] = process.argv.slice(2)
if (!entry || !inputPath || !outputPath) throw new Error('Usage: report-runtime-material-probe candidate/lib/application.js private-source-list.json private-output-directory')
const sources=JSON.parse(await readFile(inputPath,'utf8')); assert(Array.isArray(sources)&&sources.length>0&&sources.length<=12)
const root=await mkdtemp(join(tmpdir(),'report-runtime-materials-')), out=resolve(outputPath),sha=bytes=>createHash('sha256').update(bytes).digest('hex'), records=[]
const {LocalDeviceRuntime,Config}=await import(pathToFileURL(resolve(entry)).href)
const runtime=new LocalDeviceRuntime(Config({viewerPort:0,mockStartupDelayMs:0}),{workbenchRoot:root}),browser=await chromium.launch({headless:true})
try {
 for(const source of sources){const manifest=await readFile(join(source,'manifest.json')),run=JSON.parse(manifest);assert.equal(run.phase,'finished');assert([1,2].includes(run.productContract?.contractVersion));assert.notEqual(run.provider,'mock');assert(/^[a-f0-9-]{36}$/.test(run.id));await mkdir(join(root,run.id),{recursive:true});await writeFile(join(root,run.id,'manifest.json'),manifest)
  for(const file of [...run.evidence,...run.steps.flatMap(step=>step.evidence)]){assert(/^[a-z0-9-]+\.(png|xml|yaml|json|txt|webm|mp4)$/.test(file.name));const bytes=await readFile(join(source,file.name));assert.equal(sha(bytes),file.sha256);await writeFile(join(root,run.id,file.name),bytes)}
  let videoIndex
  if(run.video){videoIndex=await readFile(join(source,'video.json'));assert(videoIndex.length<=64*1024);const video=JSON.parse(videoIndex);assert.equal(video.captureId,run.video.captureId);assert.equal(video.sessionId,run.sessionId);assert.equal(video.startedAt,run.video.startedAt);assert(['complete','partial'].includes(video.status));const file=video.file;assert(file&&['recording.webm','recording.mp4'].includes(file.name)&&file.bytes<=136*1024*1024);const bytes=await readFile(join(source,file.name));assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);await writeFile(join(root,run.id,file.name),bytes);await writeFile(join(root,run.id,'video.json'),videoIndex)}
  records.push({source,manifest,run,videoIndex})
 }
 await runtime.listen();await runtime.application.workbench.store.init();await mkdir(out,{recursive:true});const page=await browser.newPage({viewport:{width:1440,height:900}})
 const api=async(path,body)=>{const response=await fetch(runtime.viewer.url+path,body?{method:'POST',headers:{origin:runtime.viewer.url,'content-type':'application/json'},body:JSON.stringify(body)}:{});const result=await response.json();assert(response.ok,JSON.stringify(result));return result}
 const wait=async id=>{for(let i=0;i<1200;i++){const job=await api('/api/workbench/share/jobs/'+id);if(['awaiting-review','succeeded'].includes(job.phase))return api('/api/workbench/share/jobs/'+id+'/result');assert(!['failed','cancelled','interrupted'].includes(job.phase),JSON.stringify(job));await new Promise(resolve=>setTimeout(resolve,25))}throw new Error('Timeout')}
 const results=[]
 for(const {source,manifest,run,videoIndex} of records){assert.deepEqual(await readFile(join(root,run.id,'manifest.json')),manifest);const detail=await api('/api/runs/'+run.id);assert.equal(detail.resultProjection.reportedVerdict,run.verdict);assert.deepEqual(detail.measurements,run.measurements)
  await page.goto(`${runtime.viewer.url}/#/runs/${run.id}`);await page.locator('#analysis-summary h1').waitFor();assert.match(await page.locator('#analysis-summary').innerText(),/Recorded verdict/);await page.locator('#analysis-summary details').filter({hasText:'Full verification scope'}).locator('summary').click();if(run.productContract.contractVersion===2) assert.match(await page.locator('#analysis-summary').innerText(),/Performance/)
  await page.screenshot({path:join(out,`runtime-${run.platform}-${results.length}.png`),fullPage:true})
  let videoRead=false
  if(videoIndex){assert.equal(detail.video.status,JSON.parse(videoIndex).status);assert.equal(detail.video.file.sha256,JSON.parse(videoIndex).file.sha256);await page.getByText('Video (on demand; approximate timing)',{exact:true}).click();const player=page.locator('#analysis-evidence video');await player.waitFor();await page.waitForFunction(()=>{const video=document.querySelector('#analysis-evidence video');return video&&video.readyState>=2&&!video.seeking},undefined,{timeout:30000});assert(await player.evaluate(video=>video.videoWidth>0&&video.videoHeight>0&&Number.isFinite(video.currentTime)));await player.evaluate(video=>video.pause());await page.screenshot({path:join(out,`video-${run.platform}.png`),fullPage:true});assert.deepEqual(await readFile(join(source,'video.json')),videoIndex);videoRead=true}
  const base={contractVersion:1,format:'html',runId:run.id,files:[]},preview=await wait((await api('/api/workbench/share/jobs',{...base,kind:'share-preview',requestId:randomUUID()})).jobId)
  const exported=await wait((await api('/api/workbench/share/jobs',{...base,kind:'share-export',requestId:randomUUID(),reviewToken:preview.reviewToken,reviewed:true})).jobId);assert.equal(exported.html,preview.report.html)
  for(const measurement of run.measurements??[])if(Number.isFinite(measurement.elapsedMs))assert(exported.html.includes(`${measurement.elapsedMs} / ${measurement.maxElapsedMs} ms`))
  assert.deepEqual(await readFile(join(source,'manifest.json')),manifest)
  await writeFile(join(out,`runtime-${run.platform}-${results.length}.html`),exported.html)
  results.push({sourceManifestSha256:sha(manifest),platform:run.platform,recordedVerdict:run.verdict,runtimeDeclared:run.productContract.contractVersion===2,performance:run.productContract.verification.performance?.status??'not-declared',health:run.productContract.verification.health?.status??'not-declared',sourceOs:run.productContract.provenance.environment.os,measurements:run.measurements?.length??0,videoRead,htmlSha256:exported.sha256,sourceUnchanged:true,freshDeviceExecution:false})
 }
 const followups=[]
 for(const {run} of records.filter(record=>record.run.parentRunId)) {
  const parent=records.find(record=>record.run.id===run.parentRunId); assert(parent)
  const compared=await api(`/api/workbench/investigation?runId=${parent.run.id}&followup=${run.id}`)
  assert.equal(compared.plan.projection.reportedVerdict,parent.run.verdict);assert.equal(compared.followup.projection.reportedVerdict,run.verdict)
  await page.goto(`${runtime.viewer.url}/#/runs/${parent.run.id}?tab=compare`)
  await page.locator('#analysis-followup').fill(run.id);await page.getByRole('button',{name:'Read plan / follow-up comparison',exact:true}).click()
  await page.getByText('Original:',{exact:false}).waitFor();assert.match(await page.locator('#analysis-secondary').innerText(),/follow-up: pass/)
  await page.screenshot({path:join(out,`followup-${run.platform}.png`),fullPage:true})
  followups.push({platform:run.platform,original:parent.run.verdict,child:run.verdict,yamlChanged:compared.followup.yamlChanged,paramsChanged:compared.followup.paramsChanged,causality:'not-proven'})
 }
 const positive=records.find(record=>record.run.verdict==='pass'), image=[...positive.run.evidence,...positive.run.steps.flatMap(step=>step.evidence)].find(file=>file.contentType==='image/png')
 assert(positive&&image);await rm(join(root,positive.run.id,image.name))
 const missing=await api('/api/runs/'+positive.run.id);assert.equal(missing.resultProjection.reportedVerdict,'pass');assert.equal(missing.resultProjection.evidenceAvailability,'unavailable')
 await page.goto(`${runtime.viewer.url}/#/runs/${positive.run.id}?tab=evidence`);await page.getByText('Historical image missing or integrity failed',{exact:false}).waitFor();await page.screenshot({path:join(out,'controlled-missing-evidence.png'),fullPage:true})
 assert.deepEqual(await readFile(join(positive.source,'manifest.json')),positive.manifest)
 const missingEvidence={scope:'registered image removed only in disposable copy',reportedVerdict:missing.resultProjection.reportedVerdict,evidenceAvailability:missing.resultProjection.evidenceAvailability,currentVerdict:missing.resultProjection.verdict,sourceUnchanged:true}
 await writeFile(join(out,'runtime-material-validation.json'),JSON.stringify({scope:'historical physical fixture-App archives; no new execution or approved real health signal',results,followups,missingEvidence},null,2));console.log(JSON.stringify({scope:'historical physical fixture-App archives',records:results.length,followups:followups.length,platforms:[...new Set(results.map(r=>r.platform))],performanceStates:[...new Set(results.map(r=>r.performance))],sourceUnchanged:true,freshDeviceExecution:false}))
} finally {await browser.close();await runtime.close();await rm(root,{recursive:true,force:true})}
