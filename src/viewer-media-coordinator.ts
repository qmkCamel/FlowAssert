import { randomUUID } from 'node:crypto'
import type { ViewerMediaConfig } from './config.js'
import { AndroidScrcpySource } from './android-scrcpy-source.js'
import { IosWdaMjpegSource } from './ios-wda-mjpeg-source.js'
import type {
  ViewerMediaClientFailureCode,
  ViewerMediaContext,
  ViewerMediaErrorCode,
  ViewerMediaPacket,
  ViewerMediaSource,
  ViewerMediaState,
  ViewerMediaSubscription,
} from './types.js'
import { viewerMediaError, viewerMediaErrorCode } from './viewer-media-error.js'

const MAX_QUEUE_BYTES = 8 * 1024 * 1024
const MAX_QUEUE_PACKETS = 2

export interface ViewerMediaSourceFactory {
  create(context: ViewerMediaContext, config: ViewerMediaConfig): ViewerMediaSource
}

export interface ViewerMediaCoordinatorOptions {
  sourceFactory?: ViewerMediaSourceFactory
  idleGraceMs?: number
  now?: () => number
  onState?: (state: ViewerMediaState) => void
}

export class ViewerMediaSubscriptionConflict extends Error {
  constructor() {
    super('A Viewer media subscription is already active')
    this.name = 'ViewerMediaSubscriptionConflict'
  }
}

export class ViewerMediaCoordinator {
  readonly #config: ViewerMediaConfig
  readonly #sourceFactory: ViewerMediaSourceFactory
  readonly #idleGraceMs: number
  readonly #now: () => number
  readonly #onState: ((state: ViewerMediaState) => void) | undefined
  #state: ViewerMediaState
  #context: ViewerMediaContext | null = null
  #source: ViewerMediaSource | null = null
  #sourceAbort: AbortController | null = null
  #sourceTask: Promise<void> | null = null
  #active: { generation: string; queue: BoundedPacketQueue } | null = null
  #idleTimer: ReturnType<typeof setTimeout> | null = null
  #codec: string | null = null
  #closing = false

  constructor(config: ViewerMediaConfig, options: ViewerMediaCoordinatorOptions = {}) {
    this.#config = config
    this.#sourceFactory = options.sourceFactory ?? new DefaultViewerMediaSourceFactory()
    this.#idleGraceMs = options.idleGraceMs ?? 5_000
    this.#now = options.now ?? Date.now
    this.#onState = options.onState
    this.#state = initialState(config)
  }

  state(): ViewerMediaState {
    return structuredClone(this.#state)
  }

  async prepare(context: ViewerMediaContext | null, unavailableCode: ViewerMediaErrorCode | null = null): Promise<void> {
    await this.#stopSource()
    this.#context = context
    this.#codec = null
    if (this.#config.mode === 'polling' || !context) {
      this.#setState({
        phase: unavailableCode ? 'fallback' : 'idle',
        transport: 'appium-screenshot',
        targetFps: null,
        lastErrorCode: unavailableCode,
      })
      return
    }
    this.#setState({
      phase: 'ready',
      transport: context.kind === 'android-scrcpy' ? 'scrcpy-h264' : 'wda-mjpeg',
      targetFps: context.kind === 'android-scrcpy' ? this.#config.android.maxFps : this.#config.ios.framerate,
      startedAt: null,
      firstFrameAt: null,
      lastFrameAt: null,
      width: null,
      height: null,
      lastErrorCode: null,
    })
  }

  subscribe(): ViewerMediaSubscription {
    if (this.#active) throw new ViewerMediaSubscriptionConflict()
    if (this.#config.mode === 'polling' || !this.#context || this.#state.phase === 'fallback') {
      throw viewerMediaError(this.#state.lastErrorCode ?? 'viewer_media_unavailable')
    }
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    const generation = randomUUID()
    const queue = new BoundedPacketQueue(this.#state.transport === 'scrcpy-h264')
    this.#active = { generation, queue }
    if (!this.#source) this.#startSource()

    let closed = false
    return {
      generation,
      transport: this.#state.transport === 'wda-mjpeg' ? 'wda-mjpeg' : 'scrcpy-h264',
      contentType: this.#state.transport === 'wda-mjpeg'
        ? 'multipart/x-mixed-replace; boundary=mobile-mirror-frame'
        : 'application/x-mobile-mirror-h264; version=1',
      packets: queue,
      close: async () => {
        if (closed) return
        closed = true
        this.#detach(generation)
      },
    }
  }

  async reportClientFailure(generation: string, code: ViewerMediaClientFailureCode): Promise<boolean> {
    if (this.#active?.generation !== generation) return false
    const errorCode: ViewerMediaErrorCode = code === 'decoder-unsupported'
      ? 'viewer_media_decoder_unsupported'
      : 'viewer_media_stream_ended'
    this.#active.queue.close(viewerMediaError(errorCode))
    this.#active = null
    await this.#stopSource()
    this.#setState({ phase: 'fallback', lastErrorCode: errorCode })
    return true
  }

  async stopSession(): Promise<void> {
    this.#context = null
    await this.#stopSource()
    this.#codec = null
    this.#setState({
      phase: 'idle',
      transport: 'appium-screenshot',
      startedAt: null,
      firstFrameAt: null,
      lastFrameAt: null,
      width: null,
      height: null,
      targetFps: null,
      lastErrorCode: null,
    })
  }

  async dispose(): Promise<void> {
    this.#closing = true
    await this.stopSession()
  }

  #startSource(): void {
    const context = this.#context
    if (!context || this.#source || this.#closing) return
    try {
      this.#source = this.#sourceFactory.create(context, this.#config)
    } catch (error) {
      this.#fallback(error)
      return
    }
    const source = this.#source
    const abort = new AbortController()
    this.#sourceAbort = abort
    this.#setState({ phase: 'starting', startedAt: timestamp(this.#now()), lastErrorCode: null })
    this.#sourceTask = (async () => {
      try {
        for await (const packet of source.open(abort.signal)) {
          if (abort.signal.aborted) break
          if (packet.codec) this.#codec = packet.codec
          if (packet.kind === 'session') {
            this.#setState({ width: packet.width ?? null, height: packet.height ?? null })
          }
          const frameWidth = packet.width ?? this.#state.width
          const frameHeight = packet.height ?? this.#state.height
          const outgoing: ViewerMediaPacket = (packet.kind === 'key' || packet.kind === 'delta')
            ? {
                ...packet,
                ...(frameWidth === null ? {} : { width: frameWidth }),
                ...(frameHeight === null ? {} : { height: frameHeight }),
                ...(this.#codec === null ? {} : { codec: this.#codec }),
              }
            : packet
          // scrcpy key packets already contain the latest Annex-B SPS/PPS. Metadata,
          // session and config packets update coordinator state only; every emitted
          // key frame is made self-describing by the Viewer envelope encoder.
          const deliverable = outgoing.kind === 'key' || outgoing.kind === 'delta' || outgoing.kind === 'jpeg'
          const accepted = deliverable ? this.#active?.queue.push(outgoing) ?? false : false
          if (isFrame(outgoing) && accepted) {
            const now = timestamp(this.#now())
            this.#setState({
              phase: 'live',
              firstFrameAt: this.#state.firstFrameAt ?? now,
              lastFrameAt: now,
              width: outgoing.width ?? this.#state.width,
              height: outgoing.height ?? this.#state.height,
              lastErrorCode: null,
            })
          }
        }
        if (!abort.signal.aborted) this.#fallback(viewerMediaError('viewer_media_stream_ended'))
      } catch (error) {
        if (!abort.signal.aborted) this.#fallback(error)
      } finally {
        if (this.#source === source) {
          this.#source = null
          this.#sourceAbort = null
        }
      }
    })()
  }

  #fallback(error: unknown): void {
    const code = viewerMediaErrorCode(error)
    this.#active?.queue.close(viewerMediaError(code))
    this.#active = null
    this.#setState({ phase: 'fallback', lastErrorCode: code })
  }

  #detach(generation: string): void {
    if (this.#active?.generation !== generation) return
    this.#active.queue.close()
    this.#active = null
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = null
      const context = this.#context
      void this.#stopSource().then(() => {
        if (context && this.#context === context && !this.#active && !this.#source && this.#state.phase !== 'fallback') {
          this.#setState({ phase: 'ready', startedAt: null, firstFrameAt: null, lastFrameAt: null })
        }
      })
    }, this.#idleGraceMs)
  }

  async #stopSource(): Promise<void> {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
    const active = this.#active
    this.#active = null
    active?.queue.close()
    const source = this.#source
    const task = this.#sourceTask
    this.#source = null
    this.#sourceTask = null
    this.#sourceAbort?.abort(viewerMediaError('viewer_media_stream_ended'))
    this.#sourceAbort = null
    await source?.close().catch(() => undefined)
    await task?.catch(() => undefined)
  }

  #setState(patch: Partial<ViewerMediaState>): void {
    this.#state = { ...this.#state, ...patch }
    this.#onState?.(this.state())
  }
}

class DefaultViewerMediaSourceFactory implements ViewerMediaSourceFactory {
  create(context: ViewerMediaContext, config: ViewerMediaConfig): ViewerMediaSource {
    if (context.kind === 'android-scrcpy') {
      return new AndroidScrcpySource(context.deviceId, context.adbPath, config.android)
    }
    return new IosWdaMjpegSource(context.host, context.port)
  }
}

class BoundedPacketQueue implements AsyncIterable<ViewerMediaPacket> {
  #packets: ViewerMediaPacket[] = []
  #bytes = 0
  #waiter: {
    resolve: (result: IteratorResult<ViewerMediaPacket>) => void
    reject: (error: unknown) => void
  } | null = null
  #closed = false
  #error: unknown = null
  #waitingForKey: boolean

  constructor(waitingForKey = false) {
    this.#waitingForKey = waitingForKey
  }

  push(packet: ViewerMediaPacket): boolean {
    if (this.#closed) return false
    if (packet.bytes.byteLength > MAX_QUEUE_BYTES) {
      this.close(viewerMediaError('viewer_media_frame_too_large'))
      return false
    }
    if (packet.kind === 'delta' && this.#waitingForKey) return false
    if (packet.kind === 'key') this.#waitingForKey = false
    if (this.#waiter) {
      const waiter = this.#waiter
      this.#waiter = null
      waiter.resolve({ done: false, value: packet })
      return true
    }
    if (this.#packets.length >= MAX_QUEUE_PACKETS || this.#bytes + packet.bytes.byteLength > MAX_QUEUE_BYTES) {
      if (packet.kind === 'delta') {
        this.#waitingForKey = true
        return false
      }
      this.#packets = []
      this.#bytes = 0
    }
    this.#packets.push(packet)
    this.#bytes += packet.bytes.byteLength
    return true
  }

  close(error?: unknown): void {
    if (this.#closed) return
    this.#closed = true
    this.#error = error ?? null
    this.#packets = []
    this.#bytes = 0
    this.#waitingForKey = false
    if (this.#waiter) {
      const waiter = this.#waiter
      this.#waiter = null
      if (this.#error) waiter.reject(this.#error)
      else waiter.resolve({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<ViewerMediaPacket> {
    return {
      next: async () => {
        const packet = this.#packets.shift()
        if (packet) {
          this.#bytes -= packet.bytes.byteLength
          return { done: false, value: packet }
        }
        if (this.#closed) {
          if (this.#error) throw this.#error
          return { done: true, value: undefined }
        }
        return await new Promise<IteratorResult<ViewerMediaPacket>>((resolve, reject) => { this.#waiter = { resolve, reject } })
      },
    }
  }
}

function initialState(config: ViewerMediaConfig): ViewerMediaState {
  return {
    mode: config.mode,
    phase: 'idle',
    transport: 'appium-screenshot',
    startedAt: null,
    firstFrameAt: null,
    lastFrameAt: null,
    width: null,
    height: null,
    targetFps: null,
    lastErrorCode: null,
  }
}

function isFrame(packet: ViewerMediaPacket): boolean {
  return packet.kind === 'key' || packet.kind === 'delta' || packet.kind === 'jpeg'
}

function timestamp(now: number): string {
  return new Date(now).toISOString()
}
