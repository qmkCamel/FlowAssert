import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { RepairError } from './workbench-repair-contracts.js'
import { type RepairSourceRegistration, validRelativePath } from './workbench-repair-source.js'

export interface RepairCommandReceipt {
  commandId: string; executable: string; argvDigest: string; inputTreeDigest: string
  startedAt: string; endedAt: string; exitCode: number | null; signal: string | null
  stdoutDigest: string; stderrDigest: string; stdoutBytes: number; stderrBytes: number
  stdoutHead?: string; stdoutTail?: string; stderrHead?: string; stderrTail?: string
  timedOut: boolean; cancelled: boolean; truncated: boolean; passed: boolean
}

export const repairCommandReceiptSchema = z.object({ commandId: z.string().min(1).max(64),
  executable: z.string().min(1).max(512), argvDigest: z.string().regex(/^[a-f0-9]{64}$/),
  inputTreeDigest: z.string().regex(/^[a-f0-9]{64}$/), startedAt: z.string().datetime(),
  endedAt: z.string().datetime(), exitCode: z.number().int().nullable(), signal: z.string().max(32).nullable(),
  stdoutDigest: z.string().regex(/^[a-f0-9]{64}$/), stderrDigest: z.string().regex(/^[a-f0-9]{64}$/),
  stdoutBytes: z.number().int().nonnegative(), stderrBytes: z.number().int().nonnegative(),
  stdoutHead: z.string().max(1024).optional(), stdoutTail: z.string().max(1024).optional(),
  stderrHead: z.string().max(1024).optional(), stderrTail: z.string().max(1024).optional(),
  timedOut: z.boolean(), cancelled: z.boolean(), truncated: z.boolean(), passed: z.boolean(),
}).strict()

export async function hashRepairToolchain(policy: RepairSourceRegistration): Promise<string> {
  const entries: { executable: string; sha256: string }[] = []
  const commands = [...policy.checks, ...policy.regressionChecks,
    ...policy.builds.flatMap(build => [build.command, build.identityCommand])]
  for (const executable of [...new Set(commands.map(check => check.executable))].sort()) {
    if (!isAbsolute(executable)) throw new RepairError('repair-capability-unavailable')
    const canonical = await realpath(executable), info = await stat(canonical)
    if (!info.isFile() || info.size > 1024 * 1024 * 1024) throw new RepairError('repair-capability-unavailable')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(canonical)) hash.update(chunk)
    entries.push({ executable: canonical, sha256: hash.digest('hex') })
  }
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

/** Local process/worktree isolation is not a security sandbox. Required sandbox capability fails closed. */
export async function runRepairCommand(policy: RepairSourceRegistration, commandId: string, root: string,
  inputTreeDigest: string, signal?: AbortSignal,
  binding?: { outputRoot: string; artifactPath?: string; captureStdout?: boolean }): Promise<RepairCommandReceipt & { stdoutText?: string }> {
  if (policy.isolation !== 'trusted-local') throw new RepairError('repair-capability-unavailable')
  const command = [...policy.checks, ...policy.regressionChecks,
    ...policy.builds.flatMap(build => [build.command, build.identityCommand])].find(item => item.id === commandId)
  if (!command || !isAbsolute(command.executable) || !validRelativePath(command.cwd))
    throw new RepairError('repair-capability-unavailable')
  const canonicalRoot = await realpath(root), cwd = await realpath(resolve(root, command.cwd))
  const rel = relative(canonicalRoot, cwd)
  if (canonicalRoot !== root || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    || !(await stat(cwd)).isDirectory()) throw new RepairError('repair-project-changed')
  const executable = await realpath(command.executable)
  if (!(await stat(executable)).isFile()) throw new RepairError('repair-capability-unavailable')
  if (signal?.aborted) throw new RepairError('repair-cancelled')
  const env = Object.fromEntries(command.envAllowlist.filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]!]))
  const argv = command.argv.map(arg => arg === '%OUTPUT_ROOT%' && binding ? binding.outputRoot
    : arg === '%ARTIFACT%' && binding?.artifactPath ? binding.artifactPath : arg)
  if (argv.some(arg => arg === '%OUTPUT_ROOT%' || arg === '%ARTIFACT%'))
    throw new RepairError('repair-capability-unavailable')
  if (binding) env.MOBILE_MIRROR_BUILD_OUTPUT_ROOT = binding.outputRoot
  const startedAt = new Date().toISOString(), stdout = createHash('sha256'), stderr = createHash('sha256')
  const stdoutParts: Buffer[] = []
  const previews = { stdout: { head: Buffer.alloc(0), tail: Buffer.alloc(0) },
    stderr: { head: Buffer.alloc(0), tail: Buffer.alloc(0) } }
  let stdoutBytes = 0, stderrBytes = 0, truncated = false, timedOut = false, cancelled = false
  const child = spawn(executable, argv, { cwd, env, shell: false, detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'] })
  const killTree = () => {
    if (child.pid === undefined) return
    try {
      if (process.platform === 'win32') child.kill('SIGKILL')
      else process.kill(-child.pid, 'SIGKILL')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
  }
  const onAbort = () => { cancelled = true; killTree() }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => { timedOut = true; killTree() }, command.timeoutMs)
  const collect = (kind: 'stdout' | 'stderr', chunk: Buffer) => {
    const remaining = command.outputBytes - stdoutBytes - stderrBytes
    const accepted = chunk.subarray(0, Math.max(0, remaining))
    const preview = previews[kind]
    preview.head = Buffer.concat([preview.head, accepted]).subarray(0, 768)
    preview.tail = Buffer.concat([preview.tail, accepted]).subarray(-768)
    if (kind === 'stdout') {
      stdout.update(accepted); stdoutBytes += accepted.length
      if (binding?.captureStdout) stdoutParts.push(accepted)
    }
    else { stderr.update(accepted); stderrBytes += accepted.length }
    if (accepted.length < chunk.length) { truncated = true; killTree() }
  }
  child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk))
  child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk))
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal }))
    })
    return { commandId, executable, argvDigest: createHash('sha256').update(JSON.stringify(argv)).digest('hex'),
      inputTreeDigest, startedAt, endedAt: new Date().toISOString(), exitCode: result.code, signal: result.signal,
      stdoutDigest: stdout.digest('hex'), stderrDigest: stderr.digest('hex'), stdoutBytes, stderrBytes,
      stdoutHead: previews.stdout.head.toString('utf8'), stdoutTail: previews.stdout.tail.toString('utf8'),
      stderrHead: previews.stderr.head.toString('utf8'), stderrTail: previews.stderr.tail.toString('utf8'),
      timedOut, cancelled, truncated, passed: result.code === 0 && !timedOut && !cancelled && !truncated,
      ...(binding?.captureStdout ? { stdoutText: Buffer.concat(stdoutParts).toString('utf8') } : {}) }
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', onAbort) }
}
