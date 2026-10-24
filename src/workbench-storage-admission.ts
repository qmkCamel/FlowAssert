import { stat, statfs } from 'node:fs/promises'

const SAFETY_MARGIN = 256 * 1024 * 1024

/** Owner-local reservations are serialized by WorkbenchStore's mutation gate. */
export class WorkbenchStorageAdmission {
  #reservations = new Map<string, { device: number; bytes: number }[]>()
  constructor(private readonly availableBytes: (root: string) => Promise<number> = async root => {
    const stats = await statfs(root)
    return stats.bavail * stats.bsize
  }) {}

  async reserve(root: string, operationId: string, bytes: number): Promise<() => void> {
    return this.reserveGroup(operationId, [{ root, bytes }], SAFETY_MARGIN)
  }

  /** A single owner-local admission decision for build and evidence roots, including same-volume totals. */
  async reserveGroup(operationId: string, requests: readonly { root: string; bytes: number }[],
    maxEachBytes = 4 * 1024 * 1024 * 1024): Promise<() => void> {
    if (!operationId || operationId.length > 160 || !requests.length || requests.length > 4
      || requests.some(item => !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > maxEachBytes))
      throw new Error('Invalid evidence reservation')
    if (this.#reservations.has(operationId)) throw new Error('Evidence reservation already exists')
    const grouped = new Map<number, { root: string; bytes: number }>()
    try {
      for (const item of requests) {
        const device = (await stat(item.root)).dev
        if (!Number.isSafeInteger(device)) throw new Error('Invalid volume identifier')
        const prior = grouped.get(device)
        grouped.set(device, { root: prior?.root ?? item.root, bytes: (prior?.bytes ?? 0) + item.bytes })
      }
      for (const [device, item] of grouped) {
        const available = await this.availableBytes(item.root)
        if (!Number.isSafeInteger(available) || available < 0) throw new Error('Unknown capacity')
        const reserved = [...this.#reservations.values()].flat().filter(value => value.device === device)
          .reduce((total, value) => total + value.bytes, 0)
        if (available - reserved - item.bytes < SAFETY_MARGIN) throw new Error('storage-insufficient')
      }
    } catch (error) {
      if ((error as Error).message === 'storage-insufficient') throw error
      throw new Error('storage-capacity-unknown')
    }
    this.#reservations.set(operationId, [...grouped].map(([device, item]) => ({ device, bytes: item.bytes })))
    let released = false
    return () => { if (!released) { released = true; this.#reservations.delete(operationId) } }
  }
}
