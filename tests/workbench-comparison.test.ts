import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchComparisonService, type ComparisonReport } from '../src/workbench-comparison.js'
import { WorkbenchStore, sha256, type TestRun } from '../src/workbench-store.js'

const roots:string[]=[]
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))})

async function fixture(platform:'android'|'ios'='ios',availableBytes?: (root:string)=>Promise<number>){
  const root=await mkdtemp(join(tmpdir(),'mobile-mirror-compare-'));roots.push(root);const store=new WorkbenchStore(root,availableBytes);await store.init()
  const png=await sharp({create:{width:2,height:2,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer()
  const make=async(id:string,startedAt:string,verdict:'pass'|'fail',different=false):Promise<TestRun>=>{
    const shot=await store.put(id,'step-1.png',different?await sharp({create:{width:2,height:2,channels:4,background:{r:200,g:20,b:30,alpha:1}}}).png().toBuffer():png,'image/png')
    const xml=await store.put(id,'step-1.xml',different?'<root text="changed"/>':'<root text="same"/>','application/xml; charset=utf-8')
    const run:TestRun={schemaVersion:1,id,name:'Fixture',yaml:'fixture',engine:'test',phase:'finished',verdict,startedAt,endedAt:startedAt,sessionId:'session',deviceName:'device',platform,provider:'mock',verificationScope:'declared-ui-assertions',visualVerification:'not-performed',businessVerification:'pass',cleanup:'session-retained',resourceCleanup:'pass',evidence:[],steps:[{index:1,kind:'assert',path:'root/1/1',status:verdict==='pass'?'passed':'failed',startedAt,endedAt:startedAt,evidence:[shot,xml],executionMs:different?2000:1000,verification:{status:verdict==='pass'?'pass':'fail',message:verdict},comparison:{stepKey:'same-key',semanticDigest:'same-semantic',ancestry:['root'],occurrence:1}}],comparison:{contractVersion:1,logicalTestKey:'flow:test',inputDigest:'input',inputKeyId:'key',planDigest:'plan',executionContext:{platform,provider:'mock',deviceName:'device',os:'test',runtime:'test',viewport:'2x2'},appContext:{appId:'fixture.app',version:'unknown',build:'unknown'},implementationDigest:'worker'},diagnostics:verdict==='fail'?[{domain:'business-assertion',code:'mismatch',phase:'verify',retryable:false,evidenceRefs:[],observedAt:startedAt,message:'Expected one, received two'}]:[]}
    await store.save(run);return run
  }
  return {root,store,make}
}
async function finished(service:WorkbenchComparisonService,id:string){let report:ComparisonReport;for(let i=0;i<100;i++){report=await service.get(id);if(!['queued','running'].includes(report.state))return report;await new Promise(r=>setTimeout(r,20))}throw new Error('comparison timeout')}

describe('workbench run comparison',()=>{
  it('rejects a new comparison before writing a report when capacity is insufficient',async()=>{
    const {root,store,make}=await fixture('ios',async()=>256*1024*1024+127*1024*1024)
    const base=await make('11111111-1111-4111-8111-111111111111','2026-01-01T00:00:00.000Z','pass')
    const target=await make('22222222-2222-4222-8222-222222222222','2026-01-02T00:00:00.000Z','fail',true)
    const service=new WorkbenchComparisonService(store)
    await expect(service.start(base.id,target.id)).rejects.toThrow('storage-insufficient')
    expect((await readdir(join(root,'comparisons'))).filter(name=>/^[0-9a-f-]{36}$/.test(name))).toEqual([])
    expect((await store.get(base.id)).verdict).toBe('pass')
    await store.close()
  })
  it('recommends a clean pass baseline and produces deterministic image, XML, assertion and timing differences',async()=>{
    const {root,store,make}=await fixture(),base=await make('11111111-1111-4111-8111-111111111111','2026-01-01T00:00:00.000Z','pass'),target=await make('22222222-2222-4222-8222-222222222222','2026-01-02T00:00:00.000Z','fail',true),before=await readFile(join(root,base.id,'manifest.json'))
    const service=new WorkbenchComparisonService(store),candidates=await service.candidates(target.id);expect(candidates.candidates.map(v=>v.id)).toEqual([base.id])
    const started=await service.start(base.id,target.id),report=await finished(service,started.id)
    expect(report.state).toBe('completed');expect(report.steps[0]?.dimensions.screenshot?.status).toBe('different');expect(report.steps[0]?.dimensions.structure?.status).toBe('different');expect(report.steps[0]?.dimensions.timing?.details).toMatchObject({deltaMs:1000,ratio:2})
    expect(report.classifications).toEqual([{domain:'business-assertion',facts:['Expected one, received two'],evidenceRefs:[]}]);expect(report.firstConfirmedDifference).toMatchObject({index:0,qualified:true});expect(report.artifacts).toHaveLength(1)
    expect(await readFile(join(root,base.id,'manifest.json'))).toEqual(before);expect((await service.reportBytes(report.id)).toString()).not.toContain(root)
    const context=await service.diagnosticContext(report.id),again=await service.diagnosticContext(report.id)
    expect(context).toEqual(again);expect(context.firstDivergence).toMatchObject({kind:'confirmed',step:{path:'root/1/1'},facts:[{dimension:'assertion'}]})
    expect(context.verdictFacts).toMatchObject({baseline:'pass',candidate:'fail',assertions:{status:'different'},business:{status:'same'}})
    expect(context.evidenceCoverage.registeredEvidence).toBe(4);expect(JSON.stringify(context)).not.toContain(root);expect(JSON.stringify(context)).not.toContain('<root')
    const evidence=await service.evidenceDetail(report.id,context.drillDown.evidenceRefs[0]!);expect(evidence.artifactUrl).toMatch(/^\/api\/runs\//);expect(evidence).not.toHaveProperty('sourceName')
    await store.close()
  })

  it('keeps visual-only noise out of the diagnostic divergence and aggregates only stable historical facts',async()=>{
    const {store,make}=await fixture(),base=await make('12121212-1212-4212-8212-121212121212','2026-01-01T00:00:00.000Z','pass'),target=await make('23232323-2323-4232-8232-232323232323','2026-01-02T00:00:00.000Z','pass',true)
    target.steps[0]!.verification=structuredClone(base.steps[0]!.verification!);target.steps[0]!.comparison!.stepKey='runtime-bound-key';target.steps[0]!.comparison!.semanticDigest='runtime-bound-value'
    base.extensionResults=[{ref:'verify',role:'verify',status:'pass',startedAt:'one',endedAt:'one',result:{verdict:'pass',expected:'dynamic-one',actual:'dynamic-one'}}];target.extensionResults=[{ref:'verify',role:'verify',status:'pass',startedAt:'two',endedAt:'two',result:{verdict:'pass',expected:'dynamic-two',actual:'dynamic-two'}}]
    await store.save(base);await store.save(target)
    const service=new WorkbenchComparisonService(store),report=await finished(service,(await service.start(base.id,target.id)).id),context=await service.diagnosticContext(report.id)
    expect(report.steps[0]).toMatchObject({relation:'matched',dimensions:{screenshot:{status:'different'}}});expect(context.firstDivergence).toBeUndefined();expect(context.verdictFacts.business.status).toBe('same');expect(context.history).toMatchObject({comparisonCount:1,firstDivergenceSteps:[]})
    await store.close()
  })

  it('keeps cross-platform and legacy runs review-only or unavailable without guessing identities',async()=>{
    const one=await fixture('ios'),base=await one.make('33333333-3333-4333-8333-333333333333','2026-01-01T00:00:00.000Z','pass')
    const android=await one.make('44444444-4444-4444-8444-444444444444','2026-01-02T00:00:00.000Z','pass');android.platform='android';android.comparison!.executionContext.platform='android';await one.store.save(android)
    const service=new WorkbenchComparisonService(one.store),report=await finished(service,(await service.start(base.id,android.id)).id);expect(report.comparability).toBe('review-only');expect(report.steps[0]?.dimensions.screenshot?.status).toBe('not-comparable')
    const legacy=await one.make('55555555-5555-4555-8555-555555555555','2026-01-03T00:00:00.000Z','pass');delete legacy.comparison;await one.store.save(legacy)
    expect(await service.candidates(legacy.id)).toMatchObject({comparability:'unavailable',candidates:[]});expect((await service.start(base.id,legacy.id)).comparability).toBe('unavailable')
    await one.store.close()
  })

  it('surfaces app version and build changes instead of treating environments as identical',async()=>{
    const {store,make}=await fixture(),base=await make('56565656-5656-4565-8565-565656565656','2026-01-01T00:00:00.000Z','pass'),target=await make('57575757-5757-4575-8575-575757575757','2026-01-02T00:00:00.000Z','pass')
    base.comparison!.appContext.version='1.0';base.comparison!.appContext.build='10';target.comparison!.appContext.version='1.1';target.comparison!.appContext.build='11';await store.save(base);await store.save(target)
    const service=new WorkbenchComparisonService(store),candidates=await service.candidates(target.id)
    expect(candidates.candidates[0]).toMatchObject({id:base.id,environmentMatch:false})
    const report=await finished(service,(await service.start(base.id,target.id)).id)
    expect(report).toMatchObject({comparability:'review-only',limitations:expect.arrayContaining(['App version or build changed'])})
    expect((await service.diagnosticContext(report.id)).environment).toEqual(expect.arrayContaining([
      {field:'appVersion',baseline:'1.0',candidate:'1.1'},
      {field:'appBuild',baseline:'10',candidate:'11'},
    ]))
    await store.close()
  })

  it('marks corrupt evidence partial without rewriting the run verdict',async()=>{
    const {root,store,make}=await fixture(),base=await make('66666666-6666-4666-8666-666666666666','2026-01-01T00:00:00.000Z','pass'),target=await make('77777777-7777-4777-8777-777777777777','2026-01-02T00:00:00.000Z','fail')
    await writeFile(join(root,target.id,'step-1.xml'),'<changed/>');const service=new WorkbenchComparisonService(store),report=await finished(service,(await service.start(base.id,target.id)).id)
    expect(report.state).toBe('partial');expect(report.steps[0]?.dimensions.structure).toMatchObject({status:'unavailable',completeness:'partial'});expect((await store.readOnlySnapshot(target.id)).run.verdict).toBe('fail');expect(sha256(await readFile(join(root,target.id,'step-1.xml')))).not.toBe(target.steps[0]!.evidence[1]!.sha256)
    await store.close()
  })

  it('marks the first diagnostic divergence as observed when earlier evidence is missing',async()=>{
    const {store,make}=await fixture(),base=await make('67676767-6767-4767-8767-676767676767','2026-01-01T00:00:00.000Z','pass'),target=await make('78787878-7878-4787-8787-787878787878','2026-01-02T00:00:00.000Z','fail')
    const left=structuredClone(base.steps[0]!),right=structuredClone(target.steps[0]!);left.index=2;left.path='root/1/2';left.comparison={...left.comparison!,stepKey:'second'};right.index=2;right.path='root/1/2';right.comparison={...right.comparison!,stepKey:'second'}
    base.steps[0]!.evidence=[];target.steps[0]!.evidence=[];target.steps[0]!.verification=structuredClone(base.steps[0]!.verification!);target.steps[0]!.status='passed';base.steps.push(left);target.steps.push(right);await store.save(base);await store.save(target)
    const service=new WorkbenchComparisonService(store),report=await finished(service,(await service.start(base.id,target.id)).id),context=await service.diagnosticContext(report.id)
    expect(report.firstConfirmedDifference).toMatchObject({index:1,qualified:false});expect(context.firstDivergence).toMatchObject({kind:'observed-with-prior-gap',step:{path:'root/1/2'}})
    await store.close()
  })

  it('applies explicit screenshot masks and rejects XML entities within the worker budget',async()=>{
    const {root,store,make}=await fixture(),base=await make('88888888-8888-4888-8888-888888888888','2026-01-01T00:00:00.000Z','pass'),target=await make('99999999-9999-4999-8999-999999999999','2026-01-02T00:00:00.000Z','pass',true)
    const hostile=Buffer.from('<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]><root>&x;</root>'),xml=target.steps[0]!.evidence.find(e=>e.name.endsWith('.xml'))!;await writeFile(join(root,target.id,xml.name),hostile);xml.bytes=hostile.length;xml.sha256=sha256(hostile);await store.save(target)
    const service=new WorkbenchComparisonService(store),report=await finished(service,(await service.start(base.id,target.id,{masks:[{x:0,y:0,width:2,height:2}]})).id)
    expect(report.state).toBe('partial');expect(report.steps[0]?.dimensions.screenshot?.status).toBe('same');expect(report.steps[0]?.dimensions.structure).toMatchObject({status:'unavailable',reason:'DTD and entities are forbidden'})
    const cached=await service.start(base.id,target.id,{masks:[{x:0,y:0,width:2,height:2}]});expect(cached.id).toBe(report.id)
    await store.close()
  })

  it('bounds native image decoding and XML depth without failing the whole report',async()=>{
    const {root,store,make}=await fixture(),base=await make('89898989-8989-4989-8989-898989898989','2026-01-01T00:00:00.000Z','pass'),target=await make('90909090-9090-4090-8090-909090909090','2026-01-02T00:00:00.000Z','pass')
    const png=await sharp({create:{width:4001,height:4001,channels:4,background:{r:1,g:2,b:3,alpha:1}}}).png().toBuffer(),shot=target.steps[0]!.evidence.find(file=>file.name.endsWith('.png'))!;await writeFile(join(root,target.id,shot.name),png);shot.bytes=png.length;shot.sha256=sha256(png)
    const xmlText=`${'<n>'.repeat(130)}value${'</n>'.repeat(130)}`,xml=target.steps[0]!.evidence.find(file=>file.name.endsWith('.xml'))!,xmlBytes=Buffer.from(xmlText);await writeFile(join(root,target.id,xml.name),xmlBytes);xml.bytes=xmlBytes.length;xml.sha256=sha256(xmlBytes);await store.save(target)
    const service=new WorkbenchComparisonService(store),report=await finished(service,(await service.start(base.id,target.id)).id)
    expect(report.state).toBe('partial');expect(report.steps[0]?.dimensions.screenshot).toMatchObject({status:'unavailable',completeness:'partial'});expect(report.steps[0]?.dimensions.structure).toMatchObject({status:'unavailable'});expect(report.steps[0]?.dimensions.structure?.reason).toMatch(/nested|depth/i)
    await store.close()
  })

  it('cancels queued work without losing an earlier complete report',async()=>{
    const {store,make}=await fixture(),base=await make('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2026-01-01T00:00:00.000Z','pass'),target=await make('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2026-01-02T00:00:00.000Z','pass',true)
    const original=target.steps[0]!;target.steps=Array.from({length:1000},(_,index)=>({...structuredClone(original),index:index+1,path:`root/${index+1}`,comparison:{...original.comparison!,stepKey:`key-${index}`,occurrence:index+1}}));base.steps=target.steps.map(step=>({...structuredClone(step),evidence:structuredClone(original.evidence)}));await store.save(base);await store.save(target)
    const service=new WorkbenchComparisonService(store),first=await service.start(base.id,target.id,{slowerByMs:501}),queued=await service.start(base.id,target.id,{slowerByMs:502}),cancelled=await service.cancel(queued.id)
    expect(cancelled.state).toBe('cancelled');expect((await finished(service,first.id)).state).toMatch(/completed|partial/)
    await store.close()
  })
})
