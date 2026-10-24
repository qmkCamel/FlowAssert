import { createHash } from 'node:crypto'
import { join, extname, isAbsolute } from 'node:path'
import { chmod } from 'node:fs/promises'
import { readExternalFile } from './workbench-external-files.js'
import { writeAcceptance } from './workbench-change-storage.js'
import type { MatrixRegistry } from './device-matrix-contracts.js'

/** Explicit local APK/IPA only. Installed apps use declared provenance, never an invented binary hash. */
export async function freezeMatrixArtifacts(registry: MatrixRegistry, directory: string) {
  const artifacts: Record<string, { sha256: string; extension: '.apk' | '.ipa' }> = {}
  let total = 0
  for (const slot of registry.slots) {
    const app = slot.capabilities['appium:app'] ?? slot.capabilities.app
    if (app === undefined) continue
    if (slot.capabilities.app !== undefined || typeof app !== 'string' || !isAbsolute(app) || !['.apk', '.ipa'].includes(extname(app))) throw new Error('matrix-explicit-local-apk-ipa-required')
    // Evidence envelopes have a 4 MiB ceiling. Artifact bytes use a separate bounded binary path.
    const bytes = await readExternalFile(app, 64 * 1024 * 1024)
    if ((total += bytes.length) > 128 * 1024 * 1024) throw new Error('matrix-artifact-budget')
    const sha256 = createHash('sha256').update(bytes).digest('hex'), extension = extname(app) as '.apk' | '.ipa'
    const { open } = await import('node:fs/promises')
    const path = join(directory, `${slot.id}${extension}`), file = await open(path, 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    await chmod(path, 0o400)
    artifacts[slot.id] = { sha256, extension }
  }
  const manifest = Object.fromEntries(Object.entries(artifacts).map(([key, { sha256, extension }]) => [key, { sha256, extension }]))
  await writeAcceptance(join(directory, 'artifacts.json'), manifest)
  return manifest
}

export async function bindMatrixArtifacts(registry: MatrixRegistry, directory: string, artifacts: Record<string, { sha256: string; extension: '.apk' | '.ipa' }>) {
  const runtime = structuredClone(registry)
  for (const slot of runtime.slots) {
    const artifact = artifacts[slot.id]
    if (slot.capabilities['appium:app'] !== undefined && !artifact) throw new Error('matrix-artifact-missing')
    if (!artifact) continue
    const path = join(directory, `${slot.id}${artifact.extension}`), bytes = await readExternalFile(path, 64 * 1024 * 1024)
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('matrix-artifact-changed')
    slot.capabilities['appium:app'] = path
  }
  return runtime
}
