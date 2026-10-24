import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, rename, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { constants } from 'node:fs'
import { loadTestProject, type ProjectSnapshot } from './workbench-project.js'
import { compilePlan, type ExecutionPlan } from './workbench-plan.js'
import { WorkbenchService } from './workbench-service.js'
import { validRunId, sha256 } from './workbench-store.js'
import type { Verdict, TestRun } from './workbench-domain.js'
import type { RunResultProjection } from './workbench-contracts.js'
import { freezeSuiteCase, hasFrozenSuiteFacts, unavailableSuiteProjection } from './workbench-suite-facts.js'
import { syncBuiltinReferences } from './workbench-builtin-references.js'
import type { ReferencePublications } from './workbench-evidence-contracts.js'
export interface FrozenSuiteAttempt { runId: string; manifestSha256: string; projection: RunResultProjection; trendRun: TestRun }
export interface SuiteCase { id: string; flow: string; rowId: string; status: 'queued'|'running'|'skipped'|'flaky'|Verdict; attempts: string[]; retries: number; retrySafe: boolean; reset?: string; params: Record<string,unknown>; resultProjections?: RunResultProjection[]; frozenAttempts?: FrozenSuiteAttempt[]; frozenDigest?: string }
export interface SuiteRun { referencePublications?: ReferencePublications; id: string; parentSuiteId?: string; source?: 'viewer'|'agent'; name: string; registeredId: string; phase: 'running'|'finished'|'cancelling'; startedAt: string; endedAt?: string; sessionId: string; cases: SuiteCase[]; error?: string; exitCode?: number; project: ProjectSnapshot; snapshotSha256: string; stopOnFailure: boolean; timeoutMs: number }
const errorMessage=(e:unknown)=>e instanceof Error?e.message:String(e)
export class WorkbenchSuites {
  #closed = false
  #startIdle: Promise<void> = Promise.resolve()
  #closePromise: Promise<void> | undefined
  #active: SuiteRun|null=null
  #done: Promise<void>|null=null
  #ready: Promise<void>|null=null
  #unsaved: SuiteRun|null=null
  #activeReservation: (()=>void)|null=null
  constructor(readonly workbench: WorkbenchService) {}
  get activeId() {return this.#active?.id??null}
  get root() {return join(this.workbench.store.root,'suites')}
  async #init() {return this.#ready??=this.#initialize()}
  async #initialize() {
    await this.workbench.store.init();await mkdir(this.root,{recursive:true,mode:0o700})
    const directory=await lstat(this.root);if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error('Invalid suite directory')
    for(const file of await readdir(this.root)) {
      if(!/^[a-f0-9-]{36}\.json$/.test(file))continue
      const run=await this.#read(file.slice(0,-5))
      if(run.phase!=='finished') {run.phase='finished';run.exitCode=2;run.endedAt=new Date().toISOString();run.error='Interrupted; no automatic resume';for(const c of run.cases)if(c.status==='running'||c.status==='queued')c.status='inconclusive';const release=await this.workbench.store.reserveEvidence(`suite-recovery:${run.id}`,8*1024*1024);try{await this.#save(run)}finally{release()}}
    }
  }
  async #save(run:SuiteRun, underGate = false) {
    const save = () => syncBuiltinReferences(this.workbench.store, 'workbench:suite', run.id, run.referencePublications,
      run.cases.flatMap(item => run.phase === 'finished' && hasFrozenSuiteFacts(item) ? [] : item.attempts), async publications => {
        await this.#write({ ...run, referencePublications: publications }); run.referencePublications = publications
      })
    return underGate ? save() : this.workbench.store.withMutationGate(save)
  }
  async #write(run:SuiteRun) {
    const data=JSON.stringify(run,null,2)
    if(Buffer.byteLength(data)>8*1024*1024)throw new Error('Suite manifest exceeds storage budget')
    const path=join(this.root,`${run.id}-${randomUUID()}.tmp`)
    const handle=await open(path,'wx',0o600)
    try {await handle.writeFile(data);await handle.sync()}finally{await handle.close()}
    await rename(path,join(this.root,`${run.id}.json`))
    const dir=await open(this.root,'r');try{await dir.sync()}finally{await dir.close()}
  }
  async #read(id:string):Promise<SuiteRun> {
    validRunId(id)
    const handle=await open(join(this.root,`${id}.json`),constants.O_RDONLY|constants.O_NOFOLLOW)
    try {
      const run=JSON.parse(await handle.readFile('utf8')) as SuiteRun
      if(run.id!==id||!Array.isArray(run.cases)||!['running','cancelling','finished'].includes(run.phase))throw new Error('Invalid suite manifest')
      if(sha256(JSON.stringify(run.project))!==run.snapshotSha256)throw new Error('Suite snapshot integrity failure')
      for(const item of run.cases) if((item.frozenAttempts||item.frozenDigest) && !hasFrozenSuiteFacts(item))throw new Error('Invalid suite attempt tombstone')
      return run
    }finally{await handle.close()}
  }
  async get(id:string) {await this.#init();const run=this.#active?.id===id?structuredClone(this.#active):this.#unsaved?.id===id?structuredClone(this.#unsaved):await this.#read(id);if(run.phase==='finished')for(const c of run.cases){c.resultProjections=[];for(const [index,attempt] of c.attempts.entries()){let projection:RunResultProjection;try{projection=(await this.workbench.get(attempt)).resultProjection!}catch{projection=unavailableSuiteProjection(c,index)}c.resultProjections.push(projection);if(projection.verdict==='inconclusive'&&['pass','recovered','flaky'].includes(c.status)){c.status='inconclusive';run.exitCode=2;run.error='Attempt evidence no longer verifies'}}}return run}
  /** Explicitly publish verified terminal facts before a suite releases media references. */
  async freezeForRetention(id:string):Promise<SuiteRun> {
    await this.#init()
    const release=await this.workbench.store.reserveEvidence(`suite-freeze:${id}:${randomUUID()}`,8*1024*1024)
    let releaseReads: (() => void) | undefined
    try {
      const scope = await this.#read(id)
      const attempts = scope.cases.filter(item => !hasFrozenSuiteFacts(item)).flatMap(item => item.attempts)
      if (attempts.length) releaseReads = await this.workbench.store.lease(attempts, `suite-freeze:${id}`)
      return await this.workbench.store.withMutationGate(async()=>{
      const run=await this.#read(id)
      if(run.phase!=='finished')throw new Error('Only a finished suite can release attempt evidence')
      for(const item of run.cases) if (!hasFrozenSuiteFacts(item)) await freezeSuiteCase(this.workbench.store, attempt=>this.workbench.get(attempt, { alreadyLeased: true }), item)
      await this.#save(run, true)
      return run
      })
    }finally{releaseReads?.();release()}
  }
  async status(id:string) {await this.#init();return this.#active?.id===id?structuredClone(this.#active):this.#unsaved?.id===id?structuredClone(this.#unsaved):this.#read(id)}
  async list() {await this.#init();const files=(await readdir(this.root)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f));const runs=await Promise.all(files.map(f=>this.get(f.slice(0,-5))));if(this.#unsaved&&!runs.some(r=>r.id===this.#unsaved!.id))runs.push(structuredClone(this.#unsaved));return runs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt))}
  async start(id:string,options:{suiteId?:string|undefined;source?:'viewer'|'agent'|undefined;executeGate?:Promise<void>|undefined;project?:ProjectSnapshot|undefined;tags?:string[]|undefined;platform?:'android'|'ios'|undefined;params?:Record<string,unknown>|undefined;parentSuiteId?:string|undefined;
    /** Internal owner hook: reference publication must finish before the run gate opens. */
    onChildPrepared?:(runId:string)=>Promise<void>}={}) {
    if(this.#closed)throw new Error('Suites are closed')
    if(this.#active||this.workbench.suiteOwner||this.workbench.activeId)throw new Error('A test is already running')
    const suiteId=options.suiteId??randomUUID();validRunId(suiteId);this.workbench.reserveSuite(suiteId)
    let release!:()=>void
    this.#startIdle=new Promise<void>(resolve=>{release=resolve})
    try {
      await this.#init()
      const previous=options.parentSuiteId?await this.get(options.parentSuiteId):undefined
      const project=previous?.project??options.project??await this.workbench.baselines.applyApproved(await loadTestProject(this.workbench.projectPath)), definition=project.suites[id]
      if(!definition)throw new Error('Unknown registered suite')
      const state=this.workbench.mirror.state()
      if(state.lifecycle!=='streaming'||!state.sessionId)throw new Error('Connect a device first')
      const cases:SuiteCase[]=[],plans:ExecutionPlan[]=[]
      for(const c of definition.cases) {
        if(options.tags?.length&&!options.tags.every(t=>c.tags.includes(t)))continue
        if(!project.flows[c.flow])throw new Error(`Unknown flow ${c.flow}`)
        const rows=c.dataset?project.datasets[c.dataset]:[{id:'default',params:{}}]
        if(!rows)throw new Error(`Unknown dataset ${c.dataset}`)
        for(const row of rows) {
          const prior=previous?.cases.find(entry=>entry.id===`${c.id}:${row.id}`)
          if(previous&&!prior)continue
          const params=prior?.params??{...definition.params,...c.params,...row.params,...options.params}
          const plan=await compilePlan(project.flows[c.flow]!,project,params)
          if(options.platform&&plan.header.platform!==options.platform)continue
          // The existing provider is the sole platform authority.
          const actual=this.workbench.mirror.testPlatform
          if(plan.header.platform!==actual)throw new Error('Suite platform does not match the connected device; explicitly filter platforms')
          if(c.retries&&(!c.retrySafe||!c.reset))throw new Error('Retries require retrySafe and a registered reset flow')
          if(c.reset) {
            if(!project.flows[c.reset])throw new Error('Unknown reset flow')
            const reset=await compilePlan(project.flows[c.reset]!,project)
            if(reset.header.appId!==plan.header.appId||reset.header.platform!==plan.header.platform||reset.header.prepare.length||reset.header.verify.length)throw new Error('Reset flow must share app/platform and declare no hooks')
            plan.nodes=[...reset.nodes,...plan.nodes]
          }
          cases.push({id:`${c.id}:${row.id}`,flow:c.flow,rowId:row.id,status:'queued',attempts:[],retries:c.retries,retrySafe:c.retrySafe,...(c.reset?{reset:c.reset}:{}),params});plans.push(plan)
          if(cases.length>100)throw new Error('Suite exceeds 100 cases')
        }
      }
      if(!cases.length)throw new Error('No matching cases')
      if(new Set(cases.map(c=>c.id)).size!==cases.length)throw new Error('Duplicate case id')
      const run:SuiteRun={id:suiteId,source:options.source??'viewer',...(previous?{parentSuiteId:previous.id}:{}),name:definition.name,registeredId:id,phase:'running',startedAt:new Date().toISOString(),sessionId:state.sessionId,cases,project,snapshotSha256:sha256(JSON.stringify(project)),stopOnFailure:definition.stopOnFailure,timeoutMs:definition.timeoutMs}
      this.#activeReservation=await this.workbench.store.reserveEvidence(`suite:${suiteId}`,8*1024*1024)
      await this.#save(run);this.#active=run;this.#done=(options.executeGate??Promise.resolve()).then(()=>this.#execute(run,plans,options.onChildPrepared)).catch(async error=>{
        if(this.#active?.id!==run.id)throw error
        run.phase='finished';run.endedAt=new Date().toISOString();run.error=errorMessage(error);run.exitCode=2
        for(const c of run.cases)if(c.status==='queued'||c.status==='running')c.status='skipped'
        try{await this.#save(run)}catch(saveError){run.error=errorMessage(saveError);this.#unsaved=structuredClone(run)}
        this.#activeReservation?.();this.#activeReservation=null;this.workbench.releaseSuite(suiteId);this.#active=null
      })
      return structuredClone(run)
    }catch(error){this.#activeReservation?.();this.#activeReservation=null;this.workbench.releaseSuite(suiteId);throw error}finally{release()}
  }
  async cancel(id:string) {
    if(this.#active?.id!==id)throw new Error('Suite is not active')
    this.#active.phase='cancelling';await this.#save(this.#active)
    if(this.workbench.activeId)await this.workbench.cancel(this.workbench.activeId)
    return structuredClone(this.#active)
  }
  async wait(){await this.#done}
  stopAccepting(){this.#closed=true}
  close(){
    if(this.#closePromise)return this.#closePromise
    this.#closed=true
    return this.#closePromise=(async()=>{await this.#startIdle;await this.#ready;if(this.#active)await this.cancel(this.#active.id);await this.#done})()
  }
  async #execute(run:SuiteRun,plans:ExecutionPlan[],onChildPrepared?:((runId:string)=>Promise<void>)) {
    let timedOut=false
    const timeout=setTimeout(()=>{timedOut=true;void this.cancel(run.id).catch(()=>{})},run.timeoutMs)
    try {
      for(const [index,c] of run.cases.entries()) {
        if(String(run.phase)==='cancelling')break
        if(this.workbench.mirror.state().sessionId!==run.sessionId)throw new Error('Device session changed')
        c.status='running';await this.#save(run)
        for(let attempt=0;attempt<=c.retries;attempt++) {
          if(String(run.phase)==='cancelling')break
          let openGate!: () => void
          const executeGate = new Promise<void>(resolve => { openGate = resolve })
          const started=await this.workbench.start(plans[index]!.yaml,c.attempts.at(-1),undefined,{executeGate,source:run.source??'viewer',plan:plans[index]!,project:run.project,suiteId:run.id,flowId:c.flow,caseId:c.id,attempt:attempt+1,comparisonKey:`${run.registeredId}:${c.flow}:${c.id}`})
          try {
            c.attempts.push(started.id);await this.#save(run)
            await onChildPrepared?.(started.id)
            if(String(run.phase)==='cancelling')await this.workbench.cancel(started.id)
          } catch (error) {
            await this.workbench.cancel(started.id)
            openGate(); await this.workbench.wait()
            throw error
          } finally { openGate() }
          await this.workbench.wait()
          const result=await this.workbench.get(started.id)
          c.status=result.verdict??'inconclusive'
          if(result.resourceCleanup==='failed'||result.cleanup==='failed'||result.verdict==='inconclusive')throw new Error('Cleanup or device outcome is uncertain; suite stopped')
          if(result.verdict==='pass'){if(attempt)c.status='flaky';break}
          if(result.verdict!=='fail'||!c.retrySafe||!c.reset||result.resourceCleanup!=='pass')break
        }
        await this.#save(run)
        if(run.stopOnFailure&&c.status!=='pass')break
      }
      run.exitCode=timedOut?2:run.phase==='cancelling'?130:run.cases.some(c=>c.status==='inconclusive')?2:run.cases.every(c=>c.status==='pass')?0:1
    }catch(error){run.error=errorMessage(error);run.exitCode=run.phase==='cancelling'&&!timedOut?130:2}
    finally {
      clearTimeout(timeout)
      for(const c of run.cases)if(c.status==='queued'||c.status==='running')c.status='skipped'
      run.phase='finished';run.endedAt=new Date().toISOString()
      try{await this.#save(run)}catch(error){run.exitCode=2;run.error=errorMessage(error);this.#unsaved=structuredClone(run)}
      this.#activeReservation?.();this.#activeReservation=null
      this.workbench.releaseSuite(run.id);this.#active=null
    }
  }
}
export function junitReport(run:SuiteRun):string {
  const escape=(value:string)=>value.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!))
  const failures=run.cases.filter(c=>['fail','flaky','recovered','evidence-conflict','evidence-contaminated'].includes(c.status)).length
  const errors=run.cases.filter(c=>c.status==='inconclusive').length
  const bounded=(value:string)=>escape(value.slice(0,2048))
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="${escape(run.name)}" tests="${run.cases.length}" failures="${failures}" errors="${errors}">${run.cases.map(c=>{
    const result=c.resultProjections?.at(-1)
    const properties=result?`<properties><property name="attempts" value="${bounded(String(c.attempts.length))}"/><property name="reportedVerdict" value="${bounded(result.reportedVerdict??'unknown')}"/><property name="trustedVerdict" value="${bounded(result.verdict??'unknown')}"/><property name="visualStatus" value="${bounded(result.verification.visual.status)}"/><property name="visualRevisions" value="${bounded(result.visualBaselines.map(item=>`${item.profile}:${item.revision}`).join(','))}"/><property name="reasonCodes" value="${bounded(result.reasons.map(item=>item.code).join(','))}"/><property name="evidenceRefs" value="${bounded(result.verification.evidence.evidenceRefs.slice(0,16).join(','))}"/></properties>`:''
    const outcome=c.status==='pass'?'':c.status==='skipped'||c.status==='cancelled'?'<skipped/>':c.status==='inconclusive'?'<error message="inconclusive"/>':`<failure message="${escape(c.status)}"/>`
    const runtimeProperties=result?.verification.contractVersion===2
      ? ['health','performance'].map(dimension => { const value=result.verification.contractVersion===2 ? result.verification[dimension as 'health'|'performance'] : undefined
        return `<property name="${dimension}Status" value="${bounded(value?.status??'not-performed')}"/><property name="${dimension}Reason" value="${bounded(value?.reason??'')}"/>` }).join('') : ''
    return `<testcase name="${escape(c.id)}">${runtimeProperties ? properties.replace('</properties>',runtimeProperties+'</properties>') : properties}${outcome}<system-out>${bounded(c.attempts.map(id=>`/api/runs/${id}`).join('\n'))}</system-out></testcase>`
  }).join('')}</testsuite>`
}
