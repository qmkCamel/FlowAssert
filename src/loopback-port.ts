import { createServer } from 'node:net'
import { viewerMediaError } from './viewer-media-error.js'

export interface LoopbackPortAllocator {
  allocate(signal?: AbortSignal): Promise<number>
  isAvailable?(port: number, signal?: AbortSignal): Promise<boolean>
}

export class NodeLoopbackPortAllocator implements LoopbackPortAllocator {
  async allocate(signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) throw signal.reason
    const server = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          server.close()
          reject(signal?.reason)
        }
        signal?.addEventListener('abort', abort, { once: true })
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          signal?.removeEventListener('abort', abort)
          resolve()
        })
      })
      const address = server.address()
      if (!address || typeof address === 'string' || address.port < 1024) {
        throw viewerMediaError('viewer_media_port_unavailable')
      }
      return address.port
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw viewerMediaError('viewer_media_port_unavailable', error)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined)
    }
  }

  async isAvailable(port: number, signal?: AbortSignal): Promise<boolean> {
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) return false
    if (signal?.aborted) throw signal.reason
    const server = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          server.close()
          reject(signal?.reason)
        }
        signal?.addEventListener('abort', abort, { once: true })
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => {
          signal?.removeEventListener('abort', abort)
          resolve()
        })
      })
      return true
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      return false
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined)
    }
  }
}
