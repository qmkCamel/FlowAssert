import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SuiteRun } from './workbench-suites.js'
import { runManagedWorkbenchJob } from './workbench-managed-job.js'
import { randomUUID } from 'node:crypto'
import type { TriageJob } from './workbench-triage-contracts.js'
import { runAcceptanceCli } from './workbench-change-cli.js'
import { runExternalCli } from './workbench-external-cli.js'
import { repairCaseSchema, repairExitCode, repairId, type RepairCase } from './workbench-repair-contracts.js'
import { createInterface } from 'node:readline/promises'
export async function runSuiteCli(args: readonly string[],io:{stdout:{write(s:string):unknown};stderr:{write(s:string):unknown}}):Promise<number> {
  try {
    if(args[0]==='acceptance')return await runAcceptanceCli(args.slice(1),io)
    if(args[0]==='external-results')return await runExternalCli(args.slice(1),io)
    if(args[0]==='job')return await runManagedJobCli(args,io)
    if(args[0]==='triage')return await runTriageCli(args.slice(1),io)
    if(args[0]==='repair')return await runRepairCli(args.slice(1),io)
    if(args[0]!=='suite'||!args[1])throw new Error('Usage: test suite <id> --url http://127.0.0.1:<port> [--tags smoke] [--platform ios] [--report-dir path]')
    let url='',reportDir:string|undefined,tags:string[]|undefined,platform:string|undefined
    for(let i=2;i<args.length;i+=2){const value=args[i+1];if(!value)throw new Error('Missing option value');switch(args[i]){case '--url':url=value;break;case '--report-dir':reportDir=resolve(value);break;case '--tags':tags=value.split(',');break;case '--platform':if(!['ios','android'].includes(value))throw new Error('Invalid platform');platform=value;break;default:throw new Error('Unknown option')}}
    const base=new URL(url)
    if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('An explicit loopback Viewer URL is required')
    const call=async(path:string,body?:unknown)=>{const response=await fetch(new URL(path,base),{...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{}),headers:{origin:base.origin,'content-type':'application/json'},signal:AbortSignal.timeout(30_000)});if(!response.ok)throw new Error(`HTTP ${response.status}: ${await response.text()}`);return response}
    let run=await (await call('/api/suites',{id:args[1],tags,platform,localEvidence:true})).json() as SuiteRun
    io.stdout.write(`suite ${run.id}\n`)
    let cancellation:Promise<unknown>|undefined
    const interrupt=()=>{cancellation??=call(`/api/suites/${run.id}/cancel`,{}).catch(e=>io.stderr.write(`${String(e)}\n`))}
    process.on('SIGINT',interrupt)
    try {
      while(run.phase!=='finished'){await new Promise(resolve=>setTimeout(resolve,300));run=await(await call(`/api/suites/${run.id}`)).json() as SuiteRun}
      await cancellation
    }finally{process.removeListener('SIGINT',interrupt)}
    if(reportDir){await mkdir(reportDir,{recursive:true});await writeFile(resolve(reportDir,`${run.id}.json`),JSON.stringify(run,null,2));await writeFile(resolve(reportDir,`${run.id}.xml`),await(await call(`/api/suites/${run.id}/junit`)).text())}
    io.stdout.write(`${JSON.stringify({id:run.id,exitCode:run.exitCode,cases:run.cases.map(c=>({id:c.id,status:c.status,attempts:c.attempts,resultProjections:c.resultProjections??[]}))})}\n`)
    return run.exitCode??2
  }catch(error){io.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);return 2}
}

async function runRepairCli(args: readonly string[], io: { stdout: { write(s: string): unknown }; stderr: { write(s: string): unknown } }): Promise<number> {
  const action = args[0]
  if (!['create', 'get', 'approve', 'verify', 'install', 'inspect-install', 'cancel', 'retire'].includes(action ?? ''))
    throw new Error('Usage: test repair create|get|approve|verify|install|inspect-install|cancel|retire --url <loopback> [options]')
  const options: Record<string, string> = {}
  let start = false
  for (let index = 1; index < args.length; index += 2) {
    if (args[index] === '--start') { start = true; index--; continue }
    const flag = args[index], value = args[index + 1]
    if (!flag || !value || options[flag] !== undefined || !['--id', '--url', '--required-grade', '--source-run',
      '--baseline-run', '--flow', '--request-id', '--route', '--repository-id', '--level', '--expected-revision', '--confirm-id'].includes(flag))
      throw new Error('Invalid repair option')
    options[flag] = value
  }
  const base = new URL(options['--url'] ?? '')
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('An explicit loopback Viewer URL is required')
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(new URL(path, base), { redirect: 'error',
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { origin: base.origin, 'content-type': 'application/json', 'x-mobile-mirror-approval-channel': 'interactive-cli' },
      signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Repair request failed: HTTP ${response.status}: ${await response.text()}`)
    return response.json() as Promise<any>
  }
  if (action === 'create') {
    if (options['--route'] && !['product-code', 'locator-maintenance'].includes(options['--route']))
      throw new Error('Unknown repair route')
    const requestId = repairId.parse(options['--request-id'] ?? randomUUID())
    const sourceRunId = repairId.parse(options['--source-run'])
    const created = await call('/api/workbench/repairs', options['--route'] === 'product-code'
      ? { requestId, sourceRunId, flowId: options['--flow'], route: 'product-code',
        repositoryId: options['--repository-id'] }
      : { requestId, sourceRunId, baselineRunId: repairId.parse(options['--baseline-run']),
        flowId: options['--flow'] })
    io.stdout.write(`${JSON.stringify(created)}\n`); return 0
  }
  const id = repairId.parse(options['--id'])
  if (action === 'get') { io.stdout.write(`${JSON.stringify(await call(`/api/workbench/repairs/${id}`))}\n`); return 0 }
  const expectedRevision = Number(options['--expected-revision'])
  if (action === 'approve') {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1
      || !['scope', 'execution', 'installation'].includes(options['--level'] ?? ''))
      throw new Error('Approval needs --level scope|execution|installation and --expected-revision')
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Approval requires an interactive local terminal')
    const detail = await call(`/api/workbench/repairs/${id}`) as { case: RepairCase; plan: { digest: string };
      candidate?: { digest: string }; patchSubmission?: { patchDigest: string }; buildArtifact?: { artifactDigest: string } }
    if (detail.case.revision !== expectedRevision) throw new Error('Repair revision changed before approval')
    const digest = options['--level'] === 'installation' ? detail.buildArtifact?.artifactDigest
      : options['--level'] === 'execution' ? detail.candidate?.digest ?? detail.patchSubmission?.patchDigest
        : detail.plan.digest
    if (!digest) throw new Error('No exact candidate digest to approve')
    io.stdout.write(`Repair ${id}\nLevel: ${options['--level']}\nPlan: ${detail.plan.digest}\nCandidate: ${detail.candidate?.digest ?? detail.patchSubmission?.patchDigest ?? 'none'}\nArtifact: ${detail.buildArtifact?.artifactDigest ?? 'none'}\n`)
    const prompt = `APPROVE ${digest}`
    const terminal = createInterface({ input: process.stdin, output: process.stdout })
    let answer: string
    try { answer = await terminal.question(`Type ${prompt} to approve: `) } finally { terminal.close() }
    if (answer !== prompt) throw new Error('Approval not confirmed')
    const challenge = await call(`/api/workbench/repairs/${id}/challenge`, { expectedRevision, level: options['--level'] })
    if (challenge.planDigest !== detail.plan.digest
      || (options['--level'] === 'execution' && challenge.patchDigest !== digest)
      || (options['--level'] === 'installation' && challenge.artifactDigest !== digest))
      throw new Error('Approval digest changed')
    const approved = await call(`/api/workbench/repairs/${id}/approve`, { expectedRevision, nonce: challenge.nonce })
    io.stdout.write(`${JSON.stringify(approved)}\n`); return 0
  }
  if (action === 'cancel' || action === 'retire' || action === 'install' || action === 'inspect-install'
    || (action === 'verify' && start)) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error('Mutation needs --expected-revision')
    if (action === 'retire' && options['--confirm-id'] !== id) throw new Error('Retirement needs --confirm-id matching the case')
    const mutation = action === 'verify' ? 'verify' : action
    io.stdout.write(`${JSON.stringify(await call(`/api/workbench/repairs/${id}/${mutation}`, { expectedRevision }))}\n`)
    return 0
  }
  if (action !== 'verify') throw new Error('Unknown repair action')
  const grade = options['--required-grade'] ?? 'device'
  if (grade !== 'device' && grade !== 'software') throw new Error('Invalid required repair grade')
  io.stderr.write(`Checking repair ${id} against ${grade} grade...\n`)
  const detail = await call(`/api/workbench/repairs/${id}`) as { case: RepairCase }
  const record = repairCaseSchema.parse(detail.case)
  io.stdout.write(`${JSON.stringify({ id: record.id, phase: record.phase, outcome: record.outcome ?? null,
    revision: record.revision, requiredGrade: grade, updatedAt: record.updatedAt })}\n`)
  return record.phase === 'finished' && record.outcome ? repairExitCode(record.outcome, grade) : 1
}

async function runTriageCli(args: readonly string[], io: { stdout: { write(s: string): unknown }; stderr: { write(s: string): unknown } }): Promise<number> {
  const action = args[0]
  if (!['start', 'get', 'cancel'].includes(action ?? '') || !args[1]) throw new Error('Usage: test triage start <run-id>|get <job-id>|cancel <job-id> --url http://127.0.0.1:<port> [--comparison <id>] [--request-id <uuid>] [--wait]')
  let url = '', comparisonId: string | undefined, requestId: string = randomUUID(), wait = false
  for (let index = 2; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--wait') { wait = true; continue }
    const value = args[++index]
    if (!value) throw new Error('Missing triage option value')
    if (flag === '--url') url = value
    else if (flag === '--comparison') comparisonId = value
    else if (flag === '--request-id') requestId = value
    else throw new Error('Unknown triage option')
  }
  if (action !== 'start' && (comparisonId || wait)) throw new Error('Comparison and wait are only supported by triage start')
  const base = new URL(url)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('An explicit loopback Viewer URL is required')
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(new URL(path, base), { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { origin: base.origin, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    return response
  }
  const id = args[1]
  let job: TriageJob
  if (action === 'start') job = await (await call('/api/workbench/triage-jobs', { requestId, targetRunId: id, ...(comparisonId ? { comparisonId } : {}) })).json() as TriageJob
  else job = await (await call(`/api/workbench/triage-jobs/${id}${action === 'cancel' ? '/cancel' : ''}`, action === 'cancel' ? {} : undefined)).json() as TriageJob
  io.stdout.write(`${JSON.stringify(job)}\n`)
  if (action !== 'start' || !wait) return ['failed', 'interrupted'].includes(job.state) ? 2 : job.state === 'cancelled' ? 130 : 0
  let interrupted = false
  const interrupt = () => { interrupted = true; void call(`/api/workbench/triage-jobs/${job.jobId}/cancel`, {}).catch(error => io.stderr.write(`${String(error)}\n`)) }
  process.on('SIGINT', interrupt)
  try {
    while (!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.state)) {
      await new Promise(resolve => setTimeout(resolve, 250))
      job = await (await call(`/api/workbench/triage-jobs/${job.jobId}`)).json() as TriageJob
    }
  } finally { process.removeListener('SIGINT', interrupt) }
  if (job.reportId) {
    const result = await (await call(`/api/workbench/triage-reports/${job.reportId}`)).json()
    io.stdout.write(`${JSON.stringify(result)}\n`)
  } else io.stdout.write(`${JSON.stringify(job)}\n`)
  return interrupted || job.state === 'cancelled' ? 130 : job.state === 'succeeded' ? 0 : 2
}

async function runManagedJobCli(args:readonly string[],io:{stdout:{write(s:string):unknown};stderr:{write(s:string):unknown}}):Promise<number>{
  if(!args[1])throw new Error('Usage: test job <id> --config <absolute-json> --connection <absolute-json> --report-dir <absolute-path>')
  let configPath='',connectionPath='',reportDir='',tags:string[]|undefined,platform:'ios'|'android'|undefined
  const budgets:{startupMs?:number;totalMs?:number;shutdownMs?:number}={}
  for(let index=2;index<args.length;index+=2){const key=args[index],value=args[index+1];if(!key||!value)throw new Error('Missing option value');switch(key){
    case '--config':configPath=resolve(value);break
    case '--connection':connectionPath=resolve(value);break
    case '--report-dir':reportDir=resolve(value);break
    case '--tags':tags=value.split(',');break
    case '--platform':if(value!=='ios'&&value!=='android')throw new Error('Invalid platform');platform=value;break
    case '--startup-timeout-ms':budgets.startupMs=positiveInteger(value);break
    case '--timeout-ms':budgets.totalMs=positiveInteger(value);break
    case '--shutdown-timeout-ms':budgets.shutdownMs=positiveInteger(value);break
    default:throw new Error('Unknown option')
  }}
  if(!configPath||!connectionPath||!reportDir)throw new Error('Managed job requires --config, --connection and --report-dir')
  const controller=new AbortController(),interrupt=()=>controller.abort(new Error('Managed job cancelled by signal'))
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt)
  try{
    const record=await runManagedWorkbenchJob({suiteId:args[1],configPath,connectionPath,reportDir,...(tags?{tags}:{}),...(platform?{platform}:{}),budgets,signal:controller.signal})
    io.stdout.write(`${JSON.stringify(record)}\n`)
    return record.jobExitCode
  }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt)}
}

function positiveInteger(value:string):number{const parsed=Number(value);if(!Number.isInteger(parsed)||parsed<1)throw new Error('Timeout must be a positive integer');return parsed}
