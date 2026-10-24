import { constants } from 'node:fs'
import { access, open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, dirname } from 'node:path'
import type { HostCommandRunner } from './host-command-runner.js'
import type { PreflightCheck } from './environment-preflight.js'

export const SUPPORTED_DSH = '0.2.0-rc.2'
export interface DshTarget { executable?: string; profileRoot?: string }
const result = (id: string, status: PreflightCheck['status'], code: string, version?: string): PreflightCheck => ({ id, status, code,
  suggestion: 'Select the exact supported DSH executable and profile. Static checks do not prove plugin activation or tool calls.', ...(version ? { version } : {}) })

export async function checkDshVersion(target: DshTarget, runner: HostCommandRunner, signal: AbortSignal): Promise<PreflightCheck[]> {
  if (!target.executable) return [result('dsh-version', 'manual', 'dsh_target_required')]
  try {
    signal.throwIfAborted()
    if (!isAbsolute(target.executable)) return [result('dsh-version', 'blocked', 'dsh_target_invalid')]
    const path = await realpath(target.executable)
    if (!(await stat(path)).isFile()) return [result('dsh-version', 'blocked', 'dsh_target_invalid')]
    await access(path, constants.X_OK)
    signal.throwIfAborted()
    const output = await runner.run(path, ['--version'], { signal, timeoutMs: 10_000 })
    const version = /^(?:dsh\s+)?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/.exec(output.stdout.trim())?.[1]
    if (output.timedOut || output.aborted) return [result('dsh-version', 'manual', 'dsh_version_unverified')]
    return [result('dsh-version', output.ok && version === SUPPORTED_DSH ? 'pass' : 'blocked',
      output.ok && version === SUPPORTED_DSH ? 'dsh_version_ready' : 'dsh_version_mismatch', version)]
  } catch { return [result('dsh-version', 'manual', 'dsh_target_unavailable')] }
}

/** Reads only manifests, never evaluates a bundle or reads credential-bearing patch/config files. */
export async function checkDshProfile(target: DshTarget, signal: AbortSignal): Promise<PreflightCheck[]> {
  if (!target.profileRoot) return [result('dsh-profile', 'manual', 'dsh-profile-unverified')]
  let bytes = 0
  const manifest = async (path: string): Promise<Record<string, any>> => {
    signal.throwIfAborted()
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      if (!(await file.stat()).isFile()) throw new Error('metadata_required')
      const buffer = Buffer.alloc(1_048_577)
      let size = 0
      while (size < buffer.length) { signal.throwIfAborted(); const part = await file.read(buffer, size, buffer.length - size, size); if (!part.bytesRead) break; size += part.bytesRead }
      bytes += size
      if (size > 1_048_576 || bytes > 4_194_304) throw new Error('metadata_budget')
      const parsed = JSON.parse(buffer.subarray(0, size).toString('utf8'))
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('metadata_invalid')
      return parsed
    } finally { await file.close() }
  }
  let installation: string | undefined
  // DSH rc.2 resolves built-in peers from its own installation before the profile.
  // Inspect only a bounded chain above the explicitly selected canonical executable.
  const locateInstallation = async () => {
    if (!target.executable) return
    let directory = dirname(await realpath(target.executable))
    for (let depth = 0; depth < 4; depth++) {
      try {
        const meta = await manifest(join(directory, 'package.json'))
        if (meta.name === '@deepseek-ai/dsh') {
          if (meta.version !== SUPPORTED_DSH) throw new Error('installation_mismatch')
          installation = directory
          return
        }
        // An executable in another package is not an identifiable DSH target.
        throw new Error('installation_unverified')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    throw new Error('installation_unverified')
  }
  const resolvePeer = async (root: string, name: string): Promise<Record<string, any>> => {
    // A plugin-local dependency, a package-manager peer sibling, or the selected profile.
    // Never walk into an unrelated parent project/global installation.
    const paths = installation ? [join(installation, 'node_modules', name, 'package.json')]
      : [join(root, 'node_modules', name, 'package.json'), join(dirname(root), name, 'package.json'), join(target.profileRoot!, 'node_modules', name, 'package.json')]
    for (const path of paths) {
      try { return await manifest(await realpath(path)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    throw new Error('peer_missing')
  }
  try {
    if (!isAbsolute(target.profileRoot)) return [result('dsh-profile', 'blocked', 'dsh_profile_invalid')]
    await locateInstallation()
    const root = await realpath(target.profileRoot), profile = await manifest(join(root, 'package.json'))
    const bundles: unknown = profile.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || !bundles.includes('flowassert')) return [result('dsh-profile', 'blocked', 'dsh_plugin_unregistered')]
    const pluginPath = await realpath(join(root, 'node_modules', 'flowassert', 'package.json'))
    const plugin = await manifest(pluginPath)
    if (plugin.name !== 'flowassert') return [result('dsh-profile', 'blocked', 'dsh_plugin_identity_mismatch')]
    for (const name of ['@deepseek-ai/dsh-attachment', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools']) {
      const peer = await resolvePeer(dirname(pluginPath), name)
      if (peer.name !== name || peer.version !== SUPPORTED_DSH || plugin.peerDependencies?.[name] !== SUPPORTED_DSH) return [result('dsh-profile', 'blocked', 'dsh_peer_mismatch')]
    }
    const cordis = await resolvePeer(dirname(pluginPath), '@deepseek-ai/cordis')
    const patch = /^4\.0\.(\d+)$/.exec(cordis.version ?? '')
    if (cordis.name !== '@deepseek-ai/cordis' || !patch || Number(patch[1]) < 4 || plugin.peerDependencies?.['@deepseek-ai/cordis'] !== '~4.0.4') return [result('dsh-profile', 'blocked', 'dsh_peer_mismatch')]
    // Metadata proves installation, not composed activation. Never synthesize a ready host.
    return [result('dsh-registration', 'pass', 'dsh_bundle_registered'), result('dsh-peers', 'pass', 'dsh_peer_metadata_ready', SUPPORTED_DSH), result('dsh-profile', 'manual', 'dsh-profile-unverified')]
  } catch { return [result('dsh-profile', 'manual', 'dsh-profile-unverified')] }
}
