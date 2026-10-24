import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runComparisonWorker, ComparisonTerminationError, type ComparisonWorkerFactory } from './workbench-comparison-worker.js'
import type { ExecutionPlan } from './workbench-plan.js'
import { sha256, validRunId, type WorkbenchStore } from './workbench-store.js'
import type { EvidenceFile, RunDiagnostic, RunStep, TestRun, Verdict } from './workbench-domain.js'
import type { RunProvenance } from './workbench-contracts.js'
import { publishConsumer, retireConsumerUnderMutationGate, type ReferencePublication, type ReferenceCutpoint } from './workbench-consumer-references.js'

export const COMPARISON_RULES_VERSION = 2
export interface ComparisonOptions { masks?: {x:number;y:number;width:number;height:number}[]; slowerByMs?:number; slowerByRatio?:number }
export type ComparisonState = 'queued'|'running'|'completed'|'partial'|'failed'|'cancelled'|'interrupted'
export interface DimensionResult { status:'same'|'different'|'not-comparable'|'unavailable'; completeness:'complete'|'partial'; reason:string; baselineRefs:string[]; targetRefs:string[]; details?:unknown }
export interface StepComparison { baseline?:number; target?:number; relation:'matched'|'added'|'removed'|'ambiguous'; path?:string; dimensions:Record<string,DimensionResult>; divergent:boolean }
export interface ComparisonReport {
  referencePublication?: ReferencePublication
  schemaVersion:1; rulesVersion:number; id:string; baselineRunId:string; targetRunId:string; state:ComparisonState
  createdAt:string; completedAt?:string; progress:string; comparability:'comparable'|'review-only'|'unavailable'; limitations:string[]
  input:{baselineManifestSha256:string;targetManifestSha256:string;optionsDigest:string}; baseline:{verdict?:string;name:string;platform:string}; target:{verdict?:string;name:string;platform:string}
  steps:StepComparison[]; firstConfirmedDifference?:{index:number;qualified:boolean;reason:string}; classifications:{domain:RunDiagnostic['domain'];facts:string[];evidenceRefs:string[]}[]
  artifacts:{id:string;name:string;sha256:string;bytes:number;contentType:string}[]; error?:string
}
export interface DiagnosticEvidenceRef { id:string; side:'baseline'|'candidate'; runId:string; kind:'image'|'hierarchy'|'text'|'other'; contentType:string; bytes:number; sha256:string }
export interface DiagnosticContext {
  schemaVersion:1
  comparison:{id:string;comparability:ComparisonReport['comparability'];limits:string[]}
  subject:{logicalTestKey:string;flowId?:string;caseId?:string;attempt?:number}
  baseline:DiagnosticRunReference
  candidate:DiagnosticRunReference
  verdictFacts:{baseline?:Verdict;candidate?:Verdict;business:DiagnosticDimensionSummary;assertions:DiagnosticDimensionSummary}
  firstDivergence?:{kind:'confirmed'|'observed-with-prior-gap';step:DiagnosticStepReference;facts:DiagnosticFact[];evidenceRefs:string[]}
  downstreamDifferences:DiagnosticStepReference[]
  classifications:{domain:RunDiagnostic['domain'];facts:string[];evidenceRefs:string[]}[]
  environment:{field:string;baseline:string;candidate:string}[]
  evidenceCoverage:{dimensions:{complete:number;partial:number;unavailable:number};registeredEvidence:number}
  history:{comparisonCount:number;firstDivergenceSteps:{step:string;count:number}[];classifications:{domain:string;count:number}[];comparability:{value:string;count:number}[]}
  drillDown:{reportRef:string;evidenceRefs:string[]}
}
interface DiagnosticRunReference { id:string;name:string;platform:string;provider:string;deviceName:string;startedAt:string;verdict?:Verdict }
interface DiagnosticDimensionSummary { status:'same'|'different'|'not-comparable'|'unavailable';completeness:'complete'|'partial';facts:string[] }
interface DiagnosticStepReference { index:number;path:string;relation:StepComparison['relation'] }
interface DiagnosticFact {dimension:string;status:DimensionResult['status'];reason:string}
export interface DiagnosticEvidenceDetail extends DiagnosticEvidenceRef { artifactUrl:string }
type RegisteredEvidence = DiagnosticEvidenceRef & { sourceName:string }
type WorkerReply={report:{steps:StepComparison[];classifications:ComparisonReport['classifications'];limitations:string[];partial:boolean};artifacts:{name:string;contentType:string;base64:string}[]}

export function stableJson(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value)
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`
  return `{${Object.keys(value as object).sort().map(k=>`${JSON.stringify(k)}:${stableJson((value as Record<string,unknown>)[k])}`).join(',')}}`
}
export function planDigest(plan:ExecutionPlan):string { return sha256(stableJson({header:plan.header,nodes:plan.nodes,project:plan.project})) }
export function logicalTestKey(plan:ExecutionPlan, explicitKey?:string):string {
  return explicitKey ? `registered:${explicitKey}` : `flow:${sha256(stableJson({appId:plan.header.appId,platform:plan.header.platform,plan:plan.nodes})).slice(0,32)}`
}
export function semanticStep(step:unknown):string { return sha256(stableJson(step)) }

export class ComparisonIdentityService {
  #key:Buffer|null=null
  constructor(readonly root:string) {}
  async create(plan:ExecutionPlan, run:Pick<TestRun,'platform'|'provider'|'deviceName'|'runtime'>, provenance:RunProvenance, explicitKey?:string) {
    const key=await this.#loadKey(), inputDigest=createHmac('sha256',key).update(stableJson(plan.params)).digest('hex')
    return {contractVersion:1 as const,logicalTestKey:logicalTestKey(plan,explicitKey),inputDigest,inputKeyId:sha256(key).slice(0,16),planDigest:planDigest(plan),
      executionContext:{platform:run.platform,provider:run.provider,deviceName:run.deviceName,os:provenance.environment.os.value,runtime:run.runtime?.workbenchVersion??'unknown',viewport:provenance.environment.viewport.value},
      appContext:{appId:plan.header.appId,version:provenance.app.version.value,build:provenance.app.build.value},implementationDigest:run.runtime?.workerSha256??'unknown'}
  }
  async #loadKey():Promise<Buffer>{
    if(this.#key)return this.#key
    const dir=join(this.root,'comparisons');await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,'.input-hmac-key')
    try {const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{return this.#key=await h.readFile()}finally{await h.close()}}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;const key=randomBytes(32);await writeFile(path,key,{flag:'wx',mode:0o600});return this.#key=key}
  }
}

export class WorkbenchComparisonService {
  readonly root:string; #queue:string[]=[]; #running=false; #runningId:string|null=null; #controllers=new Map<string,AbortController>(); #ready:Promise<void>|null=null
  #reservationReleases = new Map<string, () => void>()
  #closed = false
  #closePromise: Promise<void> | undefined
  #acceptTail: Promise<void> = Promise.resolve()
  #drainPromise: Promise<void> = Promise.resolve()
  #errors: unknown[] = []
  constructor(readonly store:WorkbenchStore, private readonly cutpoint: ReferenceCutpoint = async () => {},
    private readonly createWorker?: ComparisonWorkerFactory){this.root=join(store.root,'comparisons')}
  async init():Promise<void>{if(this.#closed)throw new Error('Comparison service is closed');return this.#ready??=this.#initialize().catch(error=>{this.#ready=null;throw error})}
  async #initialize():Promise<void>{
    await this.store.init()
    await mkdir(this.root,{recursive:true,mode:0o700})
    for(const name of await readdir(this.root)){
      if(!/^[0-9a-f-]{36}$/.test(name))continue
      let report: ComparisonReport
      try { report=await this.#read(name) } catch { continue /* invalid comparison stays unavailable */ }
      if(['queued','running'].includes(report.state)){report.state='interrupted';report.progress='interrupted';report.completedAt=new Date().toISOString();await this.#save(report)}
    }
  }
  async candidates(runId:string,cursor=0,limit=20){
    const target=(await this.store.readOnlySnapshot(runId)).run
    if(!target.comparison)return {comparability:'unavailable',reason:'comparison metadata missing',candidates:[],nextCursor:null}
    const runs=await this.store.list();const matches=runs.filter(r=>r.id!==runId&&r.phase==='finished'&&r.verdict==='pass'&&(r.attempt??1)===1&&r.comparison?.logicalTestKey===target.comparison!.logicalTestKey&&r.comparison.inputDigest===target.comparison!.inputDigest&&r.comparison.inputKeyId===target.comparison!.inputKeyId&&r.platform===target.platform&&r.comparison.appContext.appId===target.comparison!.appContext.appId&&!hasIncomplete(r))
      .map(r=>({id:r.id,name:r.name,startedAt:r.startedAt,environmentMatch:stableJson({execution:r.comparison!.executionContext,app:r.comparison!.appContext})===stableJson({execution:target.comparison!.executionContext,app:target.comparison!.appContext}),reason:'same test, input, platform and app'}))
      .sort((a,b)=>Number(b.environmentMatch)-Number(a.environmentMatch)||b.startedAt.localeCompare(a.startedAt))
    const page=matches.slice(cursor,cursor+Math.min(50,limit));return {comparability:'comparable',candidates:page,nextCursor:cursor+page.length<matches.length?cursor+page.length:null}
  }
  async start(baselineRunId:string,targetRunId:string,options:ComparisonOptions={}):Promise<ComparisonReport>{
    if (this.#closed) throw new Error('Comparison service is closed')
    const previous = this.#acceptTail
    let release!: () => void
    this.#acceptTail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      if (this.#closed) throw new Error('Comparison service is closed')
      return await this.#start(baselineRunId, targetRunId, options)
    } finally { release() }
  }
  async #start(baselineRunId:string,targetRunId:string,options:ComparisonOptions):Promise<ComparisonReport>{
    validRunId(baselineRunId);validRunId(targetRunId);if(baselineRunId===targetRunId)throw new Error('Choose two different runs')
    const release=await this.store.lease([baselineRunId,targetRunId])
    try {
    await this.init();if(this.#queue.length+(this.#running?1:0)>=5)throw new Error('Comparison queue is busy')
    validateOptions(options)
    const [baseline,target]=await Promise.all([this.store.readOnlySnapshot(baselineRunId),this.store.readOnlySnapshot(targetRunId)]),optionsDigest=sha256(stableJson(options))
    for(const name of await readdir(this.root)){if(!/^[0-9a-f-]{36}$/.test(name))continue;try{const cached=await this.#read(name);if(!cached.referencePublication?.retiredAt&&['completed','partial'].includes(cached.state)&&cached.baselineRunId===baselineRunId&&cached.targetRunId===targetRunId&&cached.input.baselineManifestSha256===baseline.manifestSha256&&cached.input.targetManifestSha256===target.manifestSha256&&cached.input.optionsDigest===optionsDigest&&cached.rulesVersion===COMPARISON_RULES_VERSION){await Promise.all(cached.artifacts.map(a=>this.readArtifact(cached.id,a.id)));return cached}}catch{/* invalid cache is ignored */}}
    const id=randomUUID(), comparability=compareability(baseline.run,target.run), limitations=comparability.limitations
    const report:ComparisonReport={schemaVersion:1,rulesVersion:COMPARISON_RULES_VERSION,id,baselineRunId,targetRunId,state:'queued',createdAt:new Date().toISOString(),progress:'queued',comparability:comparability.state,limitations,
      input:{baselineManifestSha256:baseline.manifestSha256,targetManifestSha256:target.manifestSha256,optionsDigest},baseline:{...(baseline.run.verdict?{verdict:baseline.run.verdict}:{}),name:baseline.run.name,platform:baseline.run.platform},target:{...(target.run.verdict?{verdict:target.run.verdict}:{}),name:target.run.name,platform:target.run.platform},steps:[],classifications:[],artifacts:[]}
    if(report.comparability==='unavailable'){report.state='failed';report.progress='unavailable';report.error=report.limitations.join('; ');report.completedAt=new Date().toISOString()}
    const releaseReservation = await this.store.reserveEvidence(`comparison:${id}`, 128 * 1024 * 1024)
    try {
      await publishConsumer(this.store, 'workbench:comparison', id, comparisonReferenceTargets(report), async publication => {
        report.referencePublication = publication
        await this.#save(report)
        await writeAtomic(join(this.root,id),'options.json',Buffer.from(JSON.stringify(options)))
      }, this.cutpoint)
      if(report.state==='queued'){
        this.#reservationReleases.set(id, releaseReservation)
        this.#queue.push(id);this.#schedule()
      } else releaseReservation()
      return report
    } catch (error) { releaseReservation(); throw error }
    } finally {release()}
  }
  async get(id:string):Promise<ComparisonReport>{validRunId(id);return this.#read(id)}
  async retire(id: string): Promise<ComparisonReport> {
    if (this.#closed) throw new Error('Comparison service is closed')
    validRunId(id)
    return this.store.withMutationGate(async () => {
      const report = await this.#read(id)
      if (['queued', 'running'].includes(report.state) || this.#runningId === id) throw new Error('Active comparison cannot be retired')
      if (!report.referencePublication) throw new Error('Legacy comparison retirement requires explicit migration')
      await retireConsumerUnderMutationGate(this.store, report.referencePublication, 'workbench:comparison', id, comparisonReferenceTargets(report),
        async publication => { report.referencePublication = publication; await this.#save(report) }, this.cutpoint)
      return report
    })
  }
  async cancel(id:string):Promise<ComparisonReport>{
    if (this.#closed) { await this.#closePromise; return this.get(id) }
    const previous = this.#acceptTail
    let release!: () => void
    this.#acceptTail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      if (this.#runningId === id) { this.#controllers.get(id)?.abort(new Error('Cancelled by user')); await this.#drainPromise }
      else {
        // Remove synchronously before the next drain can take ownership.
        this.#queue = this.#queue.filter(value => value !== id)
        await this.#cancelQueued(id)
      }
      return await this.get(id)
    } finally { release() }
  }
  async #cancelQueued(id: string) {
    try {
      const report = await this.get(id)
      if (report.state !== 'queued') return
      report.state = 'cancelled'; report.progress = 'cancelled'; report.completedAt = new Date().toISOString()
      await this.#save(report)
    } finally { this.#reservationReleases.get(id)?.(); this.#reservationReleases.delete(id) }
  }
  stopAccepting(): void { this.#closed = true }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.stopAccepting()
    for (const controller of this.#controllers.values()) controller.abort(new Error('Comparison shutting down'))
    return this.#closePromise = (async () => {
      await this.#acceptTail
      await this.#ready?.catch(error => { this.#errors.push(error) })
      for (const id of this.#queue.splice(0)) {
        try { await this.#cancelQueued(id) } catch (error) { this.#errors.push(error) }
      }
      await this.#drainPromise
      if (this.#errors.length) throw new AggregateError(this.#errors, 'Comparison cleanup failed')
    })()
  }
  async readArtifact(id:string,artifactId:string){const report=await this.get(id),file=report.artifacts.find(v=>v.id===artifactId);if(!file)throw new Error('Comparison artifact not found');const h=await open(join(this.root,id,file.name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const bytes=await h.readFile();if(bytes.length!==file.bytes||sha256(bytes)!==file.sha256)throw new Error('Comparison artifact integrity check failed');return {file,bytes}}finally{await h.close()}}
  async reportBytes(id:string){const report=await this.get(id);return Buffer.from(JSON.stringify(report,null,2))}
  async diagnosticContext(id:string):Promise<DiagnosticContext>{
    const report=await this.get(id)
    if (report.referencePublication?.retiredAt) throw new Error('Comparison is retired')
    if(!['completed','partial'].includes(report.state))throw new Error('Comparison report is not complete')
    const [baselineSnapshot,targetSnapshot]=await Promise.all([this.store.readOnlySnapshot(report.baselineRunId),this.store.readOnlySnapshot(report.targetRunId)])
    const baseline=baselineSnapshot.run,target=targetSnapshot.run
    const evidence=this.#evidenceRegistry(report,baseline,target)
    const dimensions=report.steps.flatMap(step=>Object.values(step.dimensions))
    const diagnosticRows=report.steps.map((step,index)=>({step,index,dimensions:Object.entries(step.dimensions).filter(([name,value])=>isDiagnosticDimension(name,value)&&(name!=='alignment'||report.comparability==='comparable'))})).filter(row=>row.dimensions.length>0)
    const first=diagnosticRows[0]
    const priorGap=first?report.steps.slice(0,first.index).some(step=>Object.values(step.dimensions).some(value=>value.completeness==='partial'||value.status==='unavailable')):false
    const firstRefs=first?[...new Set(first.dimensions.flatMap(([,value])=>this.#dimensionEvidenceRefs(value,evidence)))]:[]
    const downstream=first?diagnosticRows.slice(1).filter(row=>row.step.relation==='added'||row.step.relation==='removed').map(row=>stepReference(row.step,row.index)):[]
    const context:DiagnosticContext={
      schemaVersion:1,
      comparison:{id:report.id,comparability:report.comparability,limits:[...new Set(report.limitations)]},
      subject:{logicalTestKey:target.comparison!.logicalTestKey,...(target.flowId?{flowId:target.flowId}:{}),...(target.caseId?{caseId:target.caseId}:{}),...(target.attempt!==undefined?{attempt:target.attempt}:{})},
      baseline:runReference(baseline),candidate:runReference(target),
      verdictFacts:{...(baseline.verdict?{baseline:baseline.verdict}:{}),...(target.verdict?{candidate:target.verdict}:{}),business:summarizeDimension(report.steps.find(step=>step.path==='run')?.dimensions.business),assertions:summarizeDimensions(report.steps.map(step=>step.dimensions.assertion).filter((value):value is DimensionResult=>Boolean(value)))},
      ...(first?{firstDivergence:{kind:priorGap?'observed-with-prior-gap':'confirmed',step:stepReference(first.step,first.index),facts:first.dimensions.map(([dimension,value])=>({dimension,status:value.status,reason:value.reason})),evidenceRefs:firstRefs}}:{}),
      downstreamDifferences:downstream,
      classifications:report.classifications.map(item=>({...item,evidenceRefs:item.evidenceRefs.map(ref=>this.#lookupEvidenceRef(ref,target,evidence)).filter((value):value is string=>Boolean(value))})),
      environment:environmentDifferences(baseline,target),
      evidenceCoverage:{dimensions:{complete:dimensions.filter(value=>value.completeness==='complete').length,partial:dimensions.filter(value=>value.completeness==='partial').length,unavailable:dimensions.filter(value=>value.status==='unavailable').length},registeredEvidence:evidence.size},
      history:await this.#history(target.comparison!.logicalTestKey,report.createdAt),
      drillDown:{reportRef:`comparison:${report.id}`,evidenceRefs:[...evidence.keys()].sort()},
    }
    return context
  }
  async evidenceDetail(id:string,evidenceRef:string):Promise<DiagnosticEvidenceDetail>{
    const report=await this.get(id)
    if (report.referencePublication?.retiredAt) throw new Error('Comparison is retired')
    const [baseline,target]=await Promise.all([this.store.readOnlySnapshot(report.baselineRunId),this.store.readOnlySnapshot(report.targetRunId)])
    const registry=this.#evidenceRegistry(report,baseline.run,target.run),entry=registry.get(evidenceRef)
    if(!entry)throw new Error('Comparison evidence reference not found')
    const run=entry.side==='baseline'?baseline.run:target.run,file=allEvidence(run).find(item=>item.name===entry.sourceName&&item.sha256===entry.sha256)
    if(!file)throw new Error('Comparison evidence is no longer registered')
    await this.store.readEvidence(run.id,file)
    const {sourceName:_,...publicEntry}=entry
    return {...publicEntry,artifactUrl:`/api/runs/${run.id}/artifacts/${encodeURIComponent(file.name)}`}
  }
  #schedule(){
    if(this.#closed||this.#running)return
    const id=this.#queue.shift();if(!id)return
    this.#running=true;this.#runningId=id
    this.#drainPromise=this.#run(id).catch(error=>{this.#errors.push(error)}).finally(()=>{
      this.#running=false;this.#runningId=null
      queueMicrotask(()=>this.#schedule())
    })
  }
  async #run(id:string){
    let report!: ComparisonReport;const controller=new AbortController();this.#controllers.set(id,controller)
    let release: (() => void) | undefined
    try{report=await this.#read(id)
      controller.signal.throwIfAborted()
      if (!this.#reservationReleases.has(id)) throw new Error('Comparison storage reservation unavailable')
      report.state='running';report.progress='validating';await this.#save(report)
      release=await this.store.lease([report.baselineRunId,report.targetRunId],`comparison:${id}`)
      const [baseline,target]=await Promise.all([this.store.readOnlySnapshot(report.baselineRunId),this.store.readOnlySnapshot(report.targetRunId)])
      if(baseline.manifestSha256!==report.input.baselineManifestSha256||target.manifestSha256!==report.input.targetManifestSha256)throw new Error('Run manifest changed before analysis')
      report.progress='comparing';await this.#save(report)
      const options=await this.#options(report.id)
      const reply=await runComparisonWorker<WorkerReply>({baseline:baseline.run,target:target.run,root:this.store.root,options,comparable:report.comparability==='comparable'},controller.signal,this.createWorker)
      controller.signal.throwIfAborted()
      report.steps=reply.report.steps;report.classifications=reply.report.classifications;report.limitations.push(...reply.report.limitations)
      let artifactBytes = 0
      for(const artifact of reply.artifacts){controller.signal.throwIfAborted();const bytes=Buffer.from(artifact.base64,'base64'),artifactId=randomUUID(),name=`artifact-${artifactId}.png`;artifactBytes+=bytes.length;if(artifactBytes>128*1024*1024)throw new Error('Comparison artifacts exceed storage budget');await writeAtomic(join(this.root,id),name,bytes);report.artifacts.push({id:artifactId,name,sha256:sha256(bytes),bytes:bytes.length,contentType:artifact.contentType})}
      const first=report.steps.findIndex(v=>v.divergent);if(first>=0){const prior=report.steps.slice(0,first);report.firstConfirmedDifference={index:first,qualified:prior.every(v=>Object.values(v.dimensions).every(d=>d.completeness==='complete')),reason:prior.some(v=>Object.values(v.dimensions).some(d=>d.completeness==='partial'))?'Earlier evidence is incomplete':'Earliest confirmed difference in aligned evidence'}}
      const [endBase,endTarget]=await Promise.all([this.store.readOnlySnapshot(report.baselineRunId),this.store.readOnlySnapshot(report.targetRunId)])
      if(endBase.manifestSha256!==baseline.manifestSha256||endTarget.manifestSha256!==target.manifestSha256){report.limitations.push('Input manifest changed during analysis');report.state='partial'}else report.state=reply.report.partial?'partial':'completed'
      controller.signal.throwIfAborted()
      report.progress='saved';report.completedAt=new Date().toISOString();await this.#save(report)
    }catch(error){
      if (error instanceof ComparisonTerminationError) this.#errors.push(error)
      report=await this.#read(id);report.state=controller.signal.aborted?'cancelled':'failed';report.error=error instanceof Error?error.message:String(error);report.progress=report.state;report.completedAt=new Date().toISOString();await this.#save(report)
    }finally{release?.();this.#reservationReleases.get(id)?.();this.#reservationReleases.delete(id);this.#controllers.delete(id)}
  }
  async #read(id:string):Promise<ComparisonReport>{const dir=join(this.root,id);const st=await import('node:fs/promises').then(fs=>fs.lstat(dir));if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Comparison not found');const h=await open(join(dir,'report.json'),constants.O_RDONLY|constants.O_NOFOLLOW);try{const result=JSON.parse(await h.readFile('utf8'));if(result?.id!==id||result?.schemaVersion!==1)throw new Error('Invalid comparison report');return result}finally{await h.close()}}
  async #save(report:ComparisonReport){await this.cutpoint(`report:before-${report.state}`);const dir=join(this.root,report.id);await mkdir(dir,{recursive:true,mode:0o700});await writeAtomic(dir,'report.json',Buffer.from(JSON.stringify(report,null,2)));const parent=await open(this.root,constants.O_RDONLY|constants.O_NOFOLLOW);try{await parent.sync()}finally{await parent.close()}}
  async #options(id:string):Promise<ComparisonOptions>{try{return JSON.parse(await readFile(join(this.root,id,'options.json'),'utf8'))}catch{return {}}}
  #evidenceRegistry(report:ComparisonReport,baseline:TestRun,target:TestRun):Map<string,RegisteredEvidence>{
    const registry=new Map<string,RegisteredEvidence>(),referenced=new Set(report.steps.flatMap(step=>Object.values(step.dimensions).flatMap(value=>[...value.baselineRefs.map(name=>`baseline\0${name}`),...value.targetRefs.map(name=>`candidate\0${name}`)])))
    for(const [side,run] of [['baseline',baseline],['candidate',target]] as const){for(const file of allEvidence(run)){if(!referenced.has(`${side}\0${file.name}`))continue;const id=`evidence:${sha256(`${report.id}\0${side}\0${run.id}\0${file.name}\0${file.sha256}`).slice(0,32)}`;registry.set(id,{id,side,runId:run.id,kind:evidenceKind(file),contentType:file.contentType,bytes:file.bytes,sha256:file.sha256,sourceName:file.name})}}
    return registry
  }
  #dimensionEvidenceRefs(value:DimensionResult,registry:Map<string,RegisteredEvidence>):string[]{return [...registry.values()].filter(entry=>(entry.side==='baseline'?value.baselineRefs:value.targetRefs).includes(entry.sourceName)).map(entry=>entry.id)}
  #lookupEvidenceRef(name:string,run:TestRun,registry:Map<string,RegisteredEvidence>):string|undefined{const file=allEvidence(run).find(item=>item.name===name);return file?[...registry.values()].find(item=>item.runId===run.id&&item.sha256===file.sha256)?.id:undefined}
  async #history(logicalTestKey:string,createdAt:string):Promise<DiagnosticContext['history']>{
    const reports:ComparisonReport[]=[]
    for(const name of await readdir(this.root)){if(!/^[0-9a-f-]{36}$/.test(name))continue;try{const report=await this.#read(name);if(report.referencePublication?.retiredAt||!['completed','partial'].includes(report.state)||report.createdAt>createdAt||report.rulesVersion!==COMPARISON_RULES_VERSION)continue;const target=(await this.store.readOnlySnapshot(report.targetRunId)).run;if(target.comparison?.logicalTestKey===logicalTestKey)reports.push(report)}catch{/* damaged history is omitted from aggregate */}}
    const count=(values:string[])=>[...new Set(values)].sort().map(value=>({value,count:values.filter(item=>item===value).length}))
    const steps=reports.flatMap(report=>{const index=diagnosticIndex(report);return index>=0?[String(report.steps[index]?.path??index)]:[]})
    const domains=reports.flatMap(report=>report.classifications.map(item=>item.domain))
    return {comparisonCount:reports.length,firstDivergenceSteps:count(steps).map(({value,count})=>({step:value,count})),classifications:count(domains).map(({value,count})=>({domain:value,count})),comparability:count(reports.map(report=>report.comparability))}
  }
}
function compareability(a:TestRun,b:TestRun):{state:ComparisonReport['comparability'];limitations:string[]}{const l:string[]=[];if(a.phase!=='finished'||b.phase!=='finished')return{state:'unavailable',limitations:['Both runs must be finished']};if(!a.comparison||!b.comparison)return{state:'unavailable',limitations:['Comparison metadata missing; rerun the flow']};if(a.platform!==b.platform)l.push('Cross-platform comparison is review only');if(a.comparison.logicalTestKey!==b.comparison.logicalTestKey)l.push('Different logical tests');if(a.comparison.inputDigest!==b.comparison.inputDigest||a.comparison.inputKeyId!==b.comparison.inputKeyId)l.push('Different or unknown inputs');if(a.comparison.appContext.appId!==b.comparison.appContext.appId)l.push('Different apps');if(a.comparison.appContext.version!==b.comparison.appContext.version||a.comparison.appContext.build!==b.comparison.appContext.build)l.push('App version or build changed');if(stableJson(a.comparison.executionContext)!==stableJson(b.comparison.executionContext))l.push('Execution environment changed; timing alerts disabled');return{state:l.length?'review-only':'comparable',limitations:l}}
function hasIncomplete(run:TestRun){return [...run.evidence,...run.steps.flatMap(s=>s.evidence)].some(e=>e.incomplete||e.recovered)}
function validateOptions(o:ComparisonOptions){if(o.masks&&o.masks.length>20)throw new Error('At most 20 masks');for(const m of o.masks??[])if(![m.x,m.y,m.width,m.height].every(Number.isSafeInteger)||m.x<0||m.y<0||m.width<1||m.height<1)throw new Error('Invalid screenshot mask')}
async function writeAtomic(dir:string,name:string,bytes:Buffer){const tmp=join(dir,`.tmp-${randomUUID()}`);const h=await open(tmp,'wx',0o600);try{await h.writeFile(bytes);await h.sync()}finally{await h.close()}await rename(tmp,join(dir,name));const d=await open(dir,constants.O_RDONLY|constants.O_NOFOLLOW);try{await d.sync()}finally{await d.close()}}
export function comparisonReferenceTargets(report: ComparisonReport) { return [
  { runId: report.baselineRunId, sourceHash: report.input.baselineManifestSha256, evidenceRefs: [] },
  { runId: report.targetRunId, sourceHash: report.input.targetManifestSha256, evidenceRefs: [] },
] }
function runReference(run:TestRun):DiagnosticRunReference{return{id:run.id,name:run.name,platform:run.platform,provider:run.provider,deviceName:run.deviceName,startedAt:run.startedAt,...(run.verdict?{verdict:run.verdict}:{})}}
function stepReference(step:StepComparison,index:number):DiagnosticStepReference{return{index,path:step.path??`step-${index+1}`,relation:step.relation}}
function summarizeDimension(value:DimensionResult|undefined):DiagnosticDimensionSummary{return value?{status:value.status,completeness:value.completeness,facts:[value.reason]}:{status:'unavailable',completeness:'partial',facts:['Dimension is unavailable']}}
function summarizeDimensions(values:DimensionResult[]):DiagnosticDimensionSummary{if(!values.length)return summarizeDimension(undefined);return{status:values.some(v=>v.status==='different')?'different':values.some(v=>v.status==='unavailable')?'unavailable':values.some(v=>v.status==='not-comparable')?'not-comparable':'same',completeness:values.every(v=>v.completeness==='complete')?'complete':'partial',facts:[...new Set(values.filter(v=>v.status!=='same').map(v=>v.reason))]}}
function isDiagnosticDimension(name:string,value:DimensionResult):boolean{return value.status==='different'&&(name==='alignment'||name==='assertion'||name==='business'||name==='cleanup'||name==='recovery')}
function environmentDifferences(a:TestRun,b:TestRun){const left={...a.comparison!.executionContext,appVersion:a.comparison!.appContext.version,appBuild:a.comparison!.appContext.build},right={...b.comparison!.executionContext,appVersion:b.comparison!.appContext.version,appBuild:b.comparison!.appContext.build};return(Object.keys(left) as (keyof typeof left)[]).filter(key=>String(left[key])!==String(right[key])).map(key=>({field:key,baseline:String(left[key]),candidate:String(right[key])}))}
function allEvidence(run:TestRun):EvidenceFile[]{return[...run.evidence,...run.steps.flatMap(step=>step.evidence)]}
function evidenceKind(file:EvidenceFile):DiagnosticEvidenceRef['kind']{if(file.contentType.startsWith('image/'))return'image';if(file.name.endsWith('.xml'))return'hierarchy';if(file.contentType.startsWith('text/')||file.contentType.includes('json'))return'text';return'other'}
function diagnosticIndex(report:ComparisonReport):number{return report.steps.findIndex(step=>Object.entries(step.dimensions).some(([name,value])=>isDiagnosticDimension(name,value)&&(name!=='alignment'||report.comparability==='comparable')))}
