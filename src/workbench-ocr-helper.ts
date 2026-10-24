import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, realpath, rename, rm, statfs } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { release } from 'node:os'
import { fileURLToPath } from 'node:url'
import { readExternalFile } from './workbench-external-files.js'
import { readAcceptance, writeAcceptance } from './workbench-change-storage.js'
import { ocrCapabilitiesSchema, ocrIdentitySchema, ocrHash, type OcrIdentity } from './workbench-ocr-contracts.js'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export function runOcrProcess(command: string, args: string[], input: Buffer, signal: AbortSignal, timeoutMs = 10_000, outputLimit = 262144): Promise<Buffer> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' } })
    let error: Error | undefined, bytes = 0, stderrBytes = 0; const output: Buffer[] = []
    const stop = (reason: string) => { error ??= new Error(reason); if (child.pid) { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } } }
    const abort = () => stop('ocr-cancelled'), timer = setTimeout(() => stop('ocr-timeout'), Math.max(1, timeoutMs))
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > outputLimit) stop('ocr-output-budget'); else output.push(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 16384) stop('ocr-stderr-budget') })
    child.stdin.on('error', () => { /* EPIPE is settled by close after the child has exited. */ })
    child.once('error', () => { error ??= new Error('ocr-spawn-failed') })
    child.once('close', code => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (error || code !== 0) reject(error ?? new Error('ocr-process-failed')); else resolve(Buffer.concat(output)) })
    child.stdin.end(input); if (signal.aborted) abort()
  })
}
async function sourceIdentity(cache: string) {
  if (process.platform !== 'darwin') throw new Error('ocr-macos-required')
  if (!isAbsolute(cache)) throw new Error('ocr-absolute-cache-required')
  const source = fileURLToPath(new URL('../scripts/workbench-ocr.swift', import.meta.url)), bytes = await readExternalFile(source, 65536), sourceSha256 = digest(bytes)
  return { source, sourceSha256, key: ocrHash({ sourceSha256, arch: process.arch, release: release() }), cache }
}
export async function doctorOcr(cache: string, signal: AbortSignal = new AbortController().signal): Promise<{ identity: OcrIdentity; binary: string }> {
  const source = await sourceIdentity(cache)
  if ((await lstat(cache)).isSymbolicLink()) throw new Error('ocr-unsafe-cache')
  const directory = join(await realpath(cache), source.key), binary = join(directory, 'vision-ocr')
  const identity = await readAcceptance(join(directory, 'identity.json'), ocrIdentitySchema)
  const bytes = await readExternalFile(binary, 32 * 1024 * 1024)
  if (identity.sourceSha256 !== source.sourceSha256 || identity.binarySha256 !== digest(bytes)) throw new Error('ocr-helper-integrity')
  const capabilities = ocrCapabilitiesSchema.parse(JSON.parse((await runOcrProcess(binary, ['--doctor'], Buffer.alloc(0), signal)).toString('utf8')))
  if (capabilities.arch !== process.arch || ocrHash(capabilities) !== ocrHash(identity.capabilities)) throw new Error('ocr-helper-version-changed')
  return { identity, binary }
}
/** Only explicit user preparation invokes the compiler. Doctor/recognition never compile or download. */
export async function prepareOcr(cache: string, signal: AbortSignal = new AbortController().signal) {
  const source = await sourceIdentity(cache)
  await mkdir(cache, { recursive: true, mode: 0o700 })
  if ((await lstat(cache)).isSymbolicLink()) throw new Error('ocr-unsafe-cache')
  cache = await realpath(cache)
  const capacity = await statfs(cache), available = capacity.bavail * capacity.bsize
  if (!Number.isFinite(available) || available < 320 * 1024 * 1024) throw new Error('ocr-capacity-unavailable')
  const destination = join(cache, source.key)
  try { await lstat(destination); return await doctorOcr(cache, signal) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const staging = join(cache, `.prepare-${randomUUID()}`); await mkdir(staging, { mode: 0o700 })
  try {
    const binary = join(staging, 'vision-ocr')
    await runOcrProcess('/usr/bin/xcrun', ['swiftc', '-O', source.source, '-o', binary], Buffer.alloc(0), signal, 120_000)
    if (digest(await readExternalFile(source.source, 65536)) !== source.sourceSha256) throw new Error('ocr-source-changed')
    await chmod(binary, 0o700)
    const capabilities = ocrCapabilitiesSchema.parse(JSON.parse((await runOcrProcess(binary, ['--doctor'], Buffer.alloc(0), signal)).toString('utf8')))
    if (capabilities.arch !== process.arch) throw new Error('ocr-architecture-mismatch')
    const identity = ocrIdentitySchema.parse({ sourceSha256: source.sourceSha256, binarySha256: digest(await readExternalFile(binary, 32 * 1024 * 1024)), capabilities })
    const file = await open(binary, constants.O_RDONLY | constants.O_NOFOLLOW); try { await file.sync() } finally { await file.close() }
    await writeAcceptance(join(staging, 'identity.json'), identity)
    signal.throwIfAborted(); await rename(staging, destination)
    const directory = await open(cache, constants.O_RDONLY | constants.O_NOFOLLOW); try { await directory.sync() } finally { await directory.close() }
    return await doctorOcr(cache, signal)
  } finally { await rm(staging, { recursive: true, force: true }) }
}
