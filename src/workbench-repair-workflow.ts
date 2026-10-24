import { RepairError, type RepairCase } from './workbench-repair-contracts.js'

/** A conservative phase graph. A blocked/finished case never silently resumes a side effect. */
const next: Record<RepairCase['phase'], readonly RepairCase['phase'][]> = {
  planning: ['awaiting-approval', 'finished', 'blocked'],
  'awaiting-approval': ['queued', 'installing', 'finished', 'blocked'],
  queued: ['preparing', 'finished', 'blocked'],
  preparing: ['patching', 'checking', 'revalidating', 'cancelling', 'blocked', 'finished'],
  patching: ['checking', 'cancelling', 'blocked', 'finished'],
  checking: ['building', 'finalizing', 'cancelling', 'blocked', 'finished'],
  building: ['awaiting-approval', 'cancelling', 'blocked', 'finished'],
  installing: ['revalidating', 'cancelling', 'blocked', 'finished'],
  revalidating: ['regressing', 'finalizing', 'cancelling', 'blocked', 'finished'],
  regressing: ['finalizing', 'cancelling', 'blocked', 'finished'],
  finalizing: ['building', 'finished', 'cancelling', 'blocked'],
  cancelling: ['finished', 'blocked'],
  blocked: [],
  finished: [],
}

export function assertRepairTransition(before: RepairCase, after: RepairCase): void {
  if (before.phase !== after.phase && !next[before.phase].includes(after.phase))
    throw new RepairError('repair-invalid-contract')
  if (before.cancelRequestedAt && !['cancelling', 'blocked', 'finished'].includes(after.phase))
    throw new RepairError('repair-invalid-contract')
  if (after.phase === 'finished' && !after.outcome) throw new RepairError('repair-invalid-contract')
  if (after.phase === 'blocked' && !after.reason) throw new RepairError('repair-invalid-contract')
}
