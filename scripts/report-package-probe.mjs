import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
const entry = resolve(process.argv[2] ?? 'lib/application.js')
const { LocalDeviceRuntime, Config } = await import(pathToFileURL(entry).href)
const root = await mkdtemp(join(tmpdir(),'report-package-probe-'))
let runtime = new LocalDeviceRuntime(Config({viewerPort:0,mockStartupDelayMs:0}),{workbenchRoot:root})
const post = async (path, body) => { const response = await fetch(runtime.viewer.url+path,{method:'POST',headers:{origin:runtime.viewer.url,'content-type':'application/json'},body:JSON.stringify(body)});const data = await response.json();assert(response.ok,JSON.stringify(data));return data }
const wait = async (jobId) => {const deadline=Date.now()+30000;while(Date.now()<deadline){const record=await (await fetch(runtime.viewer.url+'/api/workbench/share/jobs/'+jobId)).json();if(['succeeded','awaiting-review'].includes(record.phase))return (await fetch(runtime.viewer.url+'/api/workbench/share/jobs/'+jobId+'/result')).json();assert(!['failed','cancelled','interrupted'].includes(record.phase),JSON.stringify(record));await new Promise(resolve=>setTimeout(resolve,25))};throw new Error('Package job timeout')}
try {
 await runtime.listen();await runtime.commands.execute('mobile_mirror_start',{provider:'mock'})
 const accepted=await runtime.application.workbench.start('name: Packed report\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- measure: { id: measured, maxElapsedMs: 10000, steps: [ { assertVisible: { text: "Hello, harness." } } ] }\n- done\n')
 await runtime.application.workbench.wait();const run=await runtime.application.workbench.get(accepted.id)
 assert.equal(run.productContract.contractVersion,2)
 const before=await readFile(join(root,run.id,'manifest.json'))
 const response=await fetch(runtime.viewer.url+'/api/workbench/reports?source=mock'),catalog=await response.json();assert.equal(catalog.contractVersion,1);assert.equal(catalog.items[0].id,run.id)
 for(const path of ['/report-presentation.js','/report-catalog.js','/report-redaction.js','/report-mask-geometry.js']){const asset=await fetch(runtime.viewer.url+path);assert.equal(asset.status,200);assert((await asset.text()).length>0)}
 const base={requestId:randomUUID(),runId:run.id,files:[]};const queued=await post('/api/workbench/share/jobs',{...base,kind:'share-preview',format:'html',contractVersion:1}),preview=await wait(queued.jobId)
 assert(preview.report.html.includes('Source recorded measurement'))
 const exported=await post('/api/workbench/share/jobs',{...base,requestId:randomUUID(),kind:'share-export',format:'html',contractVersion:1,reviewToken:preview.reviewToken,reviewed:true}),html=await wait(exported.jobId)
 assert.equal(html.html,preview.report.html);assert.equal(html.sha256,createHash('sha256').update(html.html).digest('hex'))
 assert.deepEqual(await readFile(join(root,run.id,'manifest.json')),before)
 const jsonInput={runId:run.id,files:[{name:run.steps.flatMap(step=>step.evidence).find(file=>file.name.endsWith('.xml')).name}]}
 const jsonPreview=await post('/api/workbench/share/preview',jsonInput),archive=await post('/api/workbench/share/export',{...jsonInput,previewDigest:jsonPreview.digest,reviewed:true});assert.equal(archive.version,4);assert.equal(archive.sharing.verification,'not-revalidated');assert.equal((await runtime.application.workbench.store.importArchive(archive)).verdict,'inconclusive')
 const unknown=structuredClone(archive);unknown.sharing.requiredFeatures=['unrecognized-runtime-feature'];await assert.rejects(runtime.application.workbench.store.importArchive(unknown))
 await runtime.close();runtime=new LocalDeviceRuntime(Config({viewerPort:0,mockStartupDelayMs:0}),{workbenchRoot:root});await runtime.listen();const recovered=await wait(exported.jobId);assert.equal(recovered.html,preview.report.html)
 if(process.argv[3]){await runtime.close();const baseline=await import(pathToFileURL(resolve(process.argv[3])).href);runtime=new baseline.LocalDeviceRuntime(baseline.Config({viewerPort:0,mockStartupDelayMs:0}),{workbenchRoot:root});await runtime.listen();const older=await fetch(runtime.viewer.url+'/api/workbench/share/jobs/'+exported.jobId+'/result');assert(!older.ok);assert.deepEqual(await readFile(join(root,run.id,'manifest.json')),before);const original=await runtime.application.workbench.get(run.id);assert.equal(original.verdict,'pass');assert.equal((await runtime.application.workbench.store.importArchive(archive)).verdict,'inconclusive')}
 console.log(JSON.stringify({entry:'candidate/lib/application.js',reportQuery:1,html:'frozen-bytes/restart-pass',json:'v4/legacy-pass',unknownFeature:'rejected',source:'unchanged',rollback:process.argv[3]?'previous-dev-fails-closed':'not-tested',scope:'software-Mock'}))
} finally {await runtime.close();await rm(root,{recursive:true,force:true})}
