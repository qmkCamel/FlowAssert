import { readFileSync, lstatSync } from 'node:fs'
import type { Config } from './config.js'
import { repairProjectSchema } from './workbench-repair-project.js'

/** Adapter registration hint only; every call rechecks the full trusted project snapshot. */
export function repairToolsVisible(config: Config): boolean {
  const path = config.agentTestControl?.projectPath
  if (!config.repairToolsEnabled || !path?.startsWith('/')) return false
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return false
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { repair?: unknown }
    const repair = repairProjectSchema.safeParse(raw.repair)
    return repair.success && repair.data.enabled && repair.data.permissions.length > 0
  } catch { return false }
}
