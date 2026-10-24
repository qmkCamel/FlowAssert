import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Config } from './config.js'
import type { MirrorDevice } from './types.js'

const execFileAsync = promisify(execFile)

export async function discoverDevices(config: Config, signal?: AbortSignal): Promise<MirrorDevice[]> {
  const devices: MirrorDevice[] = [{
    id: 'mock-iphone-15',
    name: 'Demo iPhone 15',
    platform: 'mock',
    source: 'mock',
    state: 'available',
  }]
  if (!config.allowHostDeviceDiscovery) return devices

  const [android, ios] = await Promise.allSettled([
    discoverAndroid(config.adbPath, signal),
    discoverIos(config.xcrunPath, signal),
  ])
  if (android.status === 'fulfilled') devices.push(...android.value)
  if (ios.status === 'fulfilled') devices.push(...ios.value)
  return devices
}

async function discoverAndroid(adbPath: string, signal?: AbortSignal): Promise<MirrorDevice[]> {
  const { stdout } = await execFileAsync(adbPath, ['devices', '-l'], { signal, timeout: 5_000 })
  return stdout.split('\n').slice(1).flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed) return []
    const [id, state = 'unknown', ...details] = trimmed.split(/\s+/)
    if (!id) return []
    const model = details.find((part) => part.startsWith('model:'))?.slice('model:'.length)
    return [{
      id,
      name: model?.replaceAll('_', ' ') ?? `Android ${id}`,
      platform: 'android' as const,
      source: 'adb' as const,
      state,
    }]
  })
}

async function discoverIos(xcrunPath: string, signal?: AbortSignal): Promise<MirrorDevice[]> {
  const { stdout } = await execFileAsync(xcrunPath, ['xctrace', 'list', 'devices'], { signal, timeout: 10_000 })
  const physicalSection = stdout.split('== Devices ==')[1]?.split('== Simulators ==')[0] ?? ''
  return physicalSection.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(.+?)\s+\([^)]*\)\s+\(([0-9A-Fa-f-]{8,})\)$/)
    if (!match?.[1] || !match[2]) return []
    return [{
      id: match[2],
      name: match[1],
      platform: 'ios' as const,
      source: 'xctrace' as const,
      state: 'connected',
    }]
  })
}
