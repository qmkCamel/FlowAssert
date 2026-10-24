import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
// Read an existing archived original into a private copy. Never claim this is a fresh device execution.
const [entry, sourceDirectory, outputDirectory, maskPolicyPath] = process.argv.slice(2)
if (!entry || !sourceDirectory || !outputDirectory) throw new Error('Usage: report-archived-material-probe candidate/lib/application.js source-run-directory private-output-directory')
const source=resolve(sourceDirectory),out=resolve(outputDirectory),root=await mkdtemp(join(tmpdir(),'report-archive-copy-'))
const sha=value=>createHash('sha256').update(value).digest('hex'),manifest=await readFile(join(source,'manifest.json')),run=JSON.parse(manifest)
assert.equal(run.phase,'finished');assert(['android','ios'].includes(run.platform));assert.notEqual(run.provider,'mock')
await mkdir(join(root,run.id),{recursive:true});await writeFile(join(root,run.id,'manifest.json'),manifest)
const files=[...run.evidence,...run.steps.flatMap(step=>step.evidence)]
for(const file of files){assert(/^[a-z0-9-]+\.(png|xml|yaml|json|txt|webm|mp4)$/.test(file.name));const bytes=await readFile(join(source,file.name));assert.equal(sha(bytes),file.sha256);await writeFile(join(root,run.id,file.name),bytes)}
const png=files.find(file=>file.contentType==='image/png'),original=await readFile(join(source,png.name));const width=original.readUInt32BE(16),height=original.readUInt32BE(20)
// The reviewed policy is bound to this immutable source and natural pixel dimensions.
let masks
if(maskPolicyPath){const policy=JSON.parse(await readFile(resolve(maskPolicyPath),'utf8'));assert.equal(policy.sourceManifestSha256,sha(manifest));assert.deepEqual(policy.viewport,[width,height]);masks=policy.masks}
else {assert.equal(width,1290);assert.equal(height,2796);masks=[{x:0,y:480,width:1290,height:350},{x:0,y:1010,width:1290,height:150}]}
const {LocalDeviceRuntime,Config}=await import(pathToFileURL(resolve(entry)).href),runtime=new LocalDeviceRuntime(Config({viewerPort:0,mockStartupDelayMs:0}),{workbenchRoot:root})
try{
 await runtime.listen();await runtime.application.workbench.store.init()
 const before=await readFile(join(root,run.id,'manifest.json'));assert.deepEqual(before,manifest)
 const api=async(path,body)=>{const response=await fetch(runtime.viewer.url+path,body?{method:'POST',headers:{origin:runtime.viewer.url,'content-type':'application/json'},body:JSON.stringify(body)}:{});const value=await response.json();assert(response.ok,JSON.stringify(value));return value}
 const base={contractVersion:1,format:'html',runId:run.id,files:[{name:png.name,masks}]}
 const wait=async(id)=>{for(let n=0;n<1200;n++){const value=await api('/api/workbench/share/jobs/'+id);if(['awaiting-review','succeeded'].includes(value.phase))return api('/api/workbench/share/jobs/'+id+'/result');assert(!['failed','cancelled','interrupted'].includes(value.phase),JSON.stringify(value));await new Promise(resolve=>setTimeout(resolve,25))}throw new Error('Archived report timeout')}
 const query=await api('/api/workbench/reports');assert.equal(query.items[0].recordedVerdict,run.verdict)
 const detail=await api('/api/runs/'+run.id);assert.equal(detail.resultProjection.reportedVerdict,run.verdict)
 const preview=await wait((await api('/api/workbench/share/jobs',{...base,kind:'share-preview',requestId:randomUUID()})).jobId)
 const result=await wait((await api('/api/workbench/share/jobs',{...base,kind:'share-export',requestId:randomUUID(),reviewToken:preview.reviewToken,reviewed:true})).jobId)
 assert.equal(result.html,preview.report.html);assert.deepEqual(await readFile(join(source,png.name)),original);assert.deepEqual(await readFile(join(source,'manifest.json')),manifest)
 await mkdir(out,{recursive:true});await writeFile(join(out,`reviewed-archived-${run.platform}-report.html`),result.html)
 await writeFile(join(out,'material-validation.json'),JSON.stringify({kind:'historical-physical-device-capture/fixture-App',sourceManifestSha256:sha(manifest),sourceImageSha256:sha(original),outputHtmlSha256:result.sha256,platform:run.platform,provider:run.provider,sourceStartedAt:run.startedAt,recordedVerdict:run.verdict,viewport:[width,height],deviceModel:'not verified from archived metadata',deviceOs:'not recorded in archive',runtimeDeclared:Boolean(detail.productContract?.contractVersion===2),runtimeDimensions:detail.resultProjection.verification,measurements:(run.measurements??[]).map(({elapsedMs,maxElapsedMs,status})=>({elapsedMs,maxElapsedMs,status})),video:Boolean(run.video?.file),linkedChild:Boolean(run.parentRunId||run.repair),sourceUnchanged:true,newPhysicalExecution:false},null,2))
 console.log(JSON.stringify({platform:run.platform,viewport:[width,height],verdict:run.verdict,scope:'historical physical capture, fixture App',source:'unchanged',html:'reviewed/frozen-byte-pass',deviceOs:'unverified',freshPhysicalAcceptance:false}))
}finally{await runtime.close();await rm(root,{recursive:true,force:true})}
