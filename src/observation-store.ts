import { structureSummary } from './screen-query.js'
import { randomBytes } from 'node:crypto'
import { screenError } from './screen-errors.js'
import type { ScreenObservation, ScreenObservationSummary } from './types.js'

const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_PER_SESSION = 4
const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_TOMBSTONES = 128

export interface ObservationStoreOptions {
  now?: () => number
  ttlMs?: number
  maxPerSession?: number
  maxImageBytes?: number
}

type DraftObservation = Omit<ScreenObservation, 'observationId' | 'expiresAt'>
type TombstoneReason = 'expired' | 'stale' | 'session'

export class ObservationStore {
  readonly #now: () => number
  readonly #ttlMs: number
  readonly #maxPerSession: number
  readonly #maxImageBytes: number
  readonly #entries = new Map<string, ScreenObservation>()
  readonly #tombstones = new Map<string, { generation: number; reason: TombstoneReason }>()
  #imageBytes = 0

  constructor(options: ObservationStoreOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.#maxPerSession = options.maxPerSession ?? DEFAULT_MAX_PER_SESSION
    this.#maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES
  }

  publish(draft: DraftObservation): ScreenObservation {
    this.sweepExpired()
    const imageBytes = draft.image?.bytes.byteLength ?? 0
    if (imageBytes > this.#maxImageBytes) throw screenError('screen_observation_too_large')

    const observation = freezeObservation({
      ...draft,
      observationId: randomBytes(16).toString('base64url'),
      expiresAt: new Date(this.#now() + this.#ttlMs).toISOString(),
    })

    this.#entries.set(observation.observationId, observation)
    this.#imageBytes += imageBytes
    this.#evictUntilWithinLimits(observation.sessionGeneration)
    return observation
  }

  getForAction(observationId: string, currentGeneration: number): ScreenObservation {
    this.sweepExpired()
    const observation = this.#entries.get(observationId)
    if (observation) {
      if (observation.sessionGeneration !== currentGeneration) {
        throw screenError('screen_observation_session_mismatch')
      }
      return observation
    }

    const tombstone = this.#tombstones.get(observationId)
    if (tombstone?.generation !== undefined && tombstone.generation !== currentGeneration) {
      throw screenError('screen_observation_session_mismatch')
    }
    if (tombstone?.reason === 'expired') throw screenError('screen_observation_expired')
    if (tombstone?.reason === 'session') throw screenError('screen_observation_session_mismatch')
    throw screenError('screen_observation_stale')
  }

  getForRead(observationId: string, currentGeneration: number): ScreenObservation {
    return this.getForAction(observationId, currentGeneration)
  }

  clearGeneration(generation: number): void {
    for (const [id, observation] of this.#entries) {
      if (observation.sessionGeneration === generation) this.#remove(id, 'session')
    }
  }

  clear(): void {
    for (const id of [...this.#entries.keys()]) this.#remove(id, 'session')
  }

  sweepExpired(): void {
    const now = this.#now()
    for (const [id, observation] of this.#entries) {
      if (Date.parse(observation.expiresAt) <= now) this.#remove(id, 'expired')
    }
  }

  #evictUntilWithinLimits(generation: number): void {
    const sameSession = () => [...this.#entries.values()]
      .filter((entry) => entry.sessionGeneration === generation)
      .sort((a, b) => Date.parse(a.captureEndedAt) - Date.parse(b.captureEndedAt))

    while (sameSession().length > this.#maxPerSession) {
      this.#remove(sameSession()[0]!.observationId, 'stale')
    }
    while (this.#imageBytes > this.#maxImageBytes && this.#entries.size > 0) {
      const oldest = [...this.#entries.values()]
        .sort((a, b) => Date.parse(a.captureEndedAt) - Date.parse(b.captureEndedAt))[0]!
      this.#remove(oldest.observationId, 'stale')
    }
  }

  #remove(id: string, reason: TombstoneReason): void {
    const observation = this.#entries.get(id)
    if (!observation) return
    this.#entries.delete(id)
    if (observation.image) {
      this.#imageBytes -= observation.image.bytes.byteLength
      observation.image.bytes.fill(0)
    }
    this.#tombstones.delete(id)
    this.#tombstones.set(id, { generation: observation.sessionGeneration, reason })
    while (this.#tombstones.size > MAX_TOMBSTONES) {
      const oldest = this.#tombstones.keys().next().value as string | undefined
      if (!oldest) break
      this.#tombstones.delete(oldest)
    }
  }
}

function freezeObservation(observation: ScreenObservation): ScreenObservation {
  Object.freeze(observation.viewport)
  if (observation.image) Object.freeze(observation.image)
  if (observation.structure) {
    for (const node of observation.structure.nodes) {
      if (node.bounds) Object.freeze(node.bounds)
      Object.freeze(node)
    }
    Object.freeze(observation.structure.nodes)
    Object.freeze(observation.structure)
  }
  return Object.freeze(observation)
}

export function summarizeObservation(
  observation: ScreenObservation,
  delivery: 'core-memory' | 'deferred-context' | 'mcp-image-content' = 'core-memory',
): ScreenObservationSummary {
  return {
    observationId: observation.observationId,
    frameRevision: observation.frameRevision,
    screenEpoch: observation.screenEpoch,
    capturedAt: observation.capturedAt,
    captureEndedAt: observation.captureEndedAt,
    expiresAt: observation.expiresAt,
    viewport: observation.viewport,
    orientation: observation.orientation,
    orientationSource: observation.orientationSource,
    ...(observation.image
      ? { image: {
          contentType: observation.image.contentType,
          width: observation.image.width,
          height: observation.image.height,
          byteLength: observation.image.bytes.byteLength,
          delivery,
        } }
      : {}),
    ...(observation.structure ? { structure: observation.structure } : {}),
  }
}

export function projectObservation(summary: ScreenObservationSummary, mode: 'full' | 'summary' = 'full') {
  if (mode === 'full' || !summary.structure) return summary
  const { structure, ...metadata } = summary
  return { ...metadata, structureSummary: structureSummary(structure) }
}
