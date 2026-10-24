import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AndroidScrcpySource, resolveScrcpyInstallation } from '../src/android-scrcpy-source.js'
import type { ViewerMediaConfig } from '../src/config.js'
import type { HostCommandResult, HostCommandRunner } from '../src/host-command-runner.js'
import type { StreamingHostProcessRunner } from '../src/streaming-host-process.js'
import type { ViewerMediaPacket } from '../src/types.js'
import { scrcpyStreamFixture } from './media-fixtures.js'

const directories: string[] = []
const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Android scrcpy 4.1 source', () => {
  it('requires an explicit executable, exact version, and deterministic readable server path', async () => {
    const fixture = await installationFixture()
    const commands = commandRunner()
    await expect(resolveScrcpyInstallation(fixture.config, commands)).resolves.toEqual({
      executablePath: fixture.executable,
      serverPath: fixture.server,
      version: '4.1',
    })
    await expect(resolveScrcpyInstallation({ ...fixture.config, scrcpyServerPath: '' }, commands)).resolves.toMatchObject({
      serverPath: fixture.server,
    })
    await expect(resolveScrcpyInstallation({ ...fixture.config, scrcpyPath: '' }, commands))
      .rejects.toMatchObject({ code: 'viewer_media_scrcpy_missing' })
    await expect(resolveScrcpyInstallation(fixture.config, commandRunner('scrcpy 4.0\n')))
      .rejects.toMatchObject({ code: 'viewer_media_scrcpy_version_unsupported' })
  })

  it('starts video-only over exact adb resources, parses frames, and cleans only owned handles', async () => {
    const fixture = await installationFixture()
    const tcp = createServer((socket) => {
      socket.end(scrcpyStreamFixture())
    })
    servers.push(tcp)
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve))
    const address = tcp.address()
    if (!address || typeof address === 'string') throw new Error('Missing TCP fixture port')

    const calls: string[][] = []
    const commands = commandRunner('scrcpy 4.1\n', calls)
    const stop = vi.fn(async () => undefined)
    const spawns: Array<{ command: string; args: string[] }> = []
    const processes: StreamingHostProcessRunner = {
      spawn(command, args) {
        spawns.push({ command, args })
        return { stdout: '', stderr: 'PRIVATE_UPSTREAM_STDERR', exited: Promise.resolve(0), stop }
      },
    }
    const source = new AndroidScrcpySource('fixture-device', '/trusted/adb', fixture.config, {
      commands,
      processes,
      ports: { allocate: async () => address.port },
    })
    const packets: ViewerMediaPacket[] = []
    try {
      for await (const packet of source.open(AbortSignal.timeout(2_000))) packets.push(packet)
    } catch (error) {
      expect(error).toMatchObject({ code: 'viewer_media_stream_ended' })
    }

    expect(packets.map((packet) => packet.kind)).toEqual(['metadata', 'session', 'config', 'key', 'delta'])
    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.command).toBe('/trusted/adb')
    expect(spawns[0]?.args).toEqual(expect.arrayContaining([
      '-s', 'fixture-device', 'audio=false', 'control=false', 'video_codec=h264',
      'send_frame_meta=true', 'send_stream_meta=true',
    ]))
    expect(spawns[0]?.args.join(' ')).not.toContain('PRIVATE_UPSTREAM_STDERR')
    expect(calls.some((args) => args.includes('push'))).toBe(true)
    expect(calls.some((args) => args.includes('--remove'))).toBe(true)
    expect(calls.some((args) => args.includes('rm'))).toBe(true)
    expect(calls.some((args) => args.includes('pkill'))).toBe(false)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('retries an ADB forward connection that closes before the device media socket is ready', async () => {
    const fixture = await installationFixture()
    let connections = 0
    const tcp = createServer((socket) => {
      connections += 1
      if (connections === 1) socket.end()
      else socket.end(scrcpyStreamFixture())
    })
    servers.push(tcp)
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve))
    const address = tcp.address()
    if (!address || typeof address === 'string') throw new Error('Missing TCP fixture port')

    const source = new AndroidScrcpySource('fixture-device', '/trusted/adb', fixture.config, {
      commands: commandRunner(),
      processes: {
        spawn: () => ({ stdout: '', stderr: '', exited: Promise.resolve(0), stop: async () => undefined }),
      },
      ports: { allocate: async () => address.port },
    })
    const packets: ViewerMediaPacket[] = []
    try {
      for await (const packet of source.open(AbortSignal.timeout(2_000))) packets.push(packet)
    } catch (error) {
      expect(error).toMatchObject({ code: 'viewer_media_stream_ended' })
    }

    expect(connections).toBe(2)
    expect(packets.map((packet) => packet.kind)).toEqual(['metadata', 'session', 'config', 'key', 'delta'])
  })

  it('aborts while waiting for a first frame and performs idempotent precise cleanup', async () => {
    const fixture = await installationFixture()
    const tcp = createServer(() => undefined)
    servers.push(tcp)
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve))
    const address = tcp.address()
    if (!address || typeof address === 'string') throw new Error('Missing TCP fixture port')
    const calls: string[][] = []
    const stop = vi.fn(async () => undefined)
    const source = new AndroidScrcpySource('fixture-device', '/trusted/adb', fixture.config, {
      commands: commandRunner('scrcpy 4.1\n', calls),
      processes: { spawn: () => ({ stdout: '', stderr: '', exited: new Promise<number | null>(() => undefined), stop }) },
      ports: { allocate: async () => address.port },
    })
    const iterator = source.open(new AbortController().signal)[Symbol.asyncIterator]()
    const pending = iterator.next().catch((error: unknown) => error)
    await waitFor(() => calls.some((args) => args.includes('forward')))
    await source.close()
    await pending
    await source.close()
    expect(calls.filter((args) => args.includes('--remove'))).toHaveLength(1)
    expect(calls.filter((args) => args.includes('rm'))).toHaveLength(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('attempts every exact cleanup step even when individual cleanup commands fail', async () => {
    const fixture = await installationFixture()
    const tcp = createServer(() => undefined)
    servers.push(tcp)
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve))
    const address = tcp.address()
    if (!address || typeof address === 'string') throw new Error('Missing TCP fixture port')
    const calls: string[][] = []
    const commands: HostCommandRunner = {
      async run(_command, args): Promise<HostCommandResult> {
        calls.push(args)
        if (args.includes('--remove') || args.includes('rm')) throw new Error('cleanup fixture failure')
        return { ok: true, stdout: args[0] === '--version' ? 'scrcpy 4.1\n' : '', stderr: '', exitCode: 0, timedOut: false, aborted: false }
      },
    }
    const stop = vi.fn(async () => { throw new Error('child already exited') })
    const source = new AndroidScrcpySource('fixture-device', '/trusted/adb', fixture.config, {
      commands,
      processes: { spawn: () => ({ stdout: '', stderr: '', exited: Promise.resolve(1), stop }) },
      ports: { allocate: async () => address.port },
    })
    const pending = source.open(new AbortController().signal)[Symbol.asyncIterator]().next().catch((error: unknown) => error)
    await waitFor(() => calls.some((args) => args.includes('forward')))
    await expect(source.close()).resolves.toBeUndefined()
    await pending
    expect(calls.filter((args) => args.includes('--remove'))).toHaveLength(1)
    expect(calls.filter((args) => args.includes('rm'))).toHaveLength(1)
  })

  it.each(['push', 'forward'] as const)('aborts safely while adb %s is still pending', async (phase) => {
    const fixture = await installationFixture()
    const calls: string[][] = []
    let reached!: () => void
    const phaseReached = new Promise<void>((resolve) => { reached = resolve })
    const commands: HostCommandRunner = {
      async run(_command, args, options): Promise<HostCommandResult> {
        calls.push(args)
        if (args[0] === '--version') return { ok: true, stdout: 'scrcpy 4.1\n', stderr: '', exitCode: 0, timedOut: false, aborted: false }
        if (args.includes(phase) && !args.includes('--remove')) {
          reached()
          await new Promise<void>((resolve) => options?.signal?.addEventListener('abort', () => resolve(), { once: true }))
          return { ok: false, stdout: '', stderr: '', exitCode: null, timedOut: false, aborted: true }
        }
        return { ok: true, stdout: '', stderr: '', exitCode: 0, timedOut: false, aborted: false }
      },
    }
    const source = new AndroidScrcpySource('fixture-device', '/trusted/adb', fixture.config, { commands })
    const pending = source.open(new AbortController().signal)[Symbol.asyncIterator]().next().catch((error: unknown) => error)
    await phaseReached
    await expect(source.close()).resolves.toBeUndefined()
    await pending
    expect(calls.some((args) => args.includes('pkill'))).toBe(false)
  })
})

async function installationFixture(): Promise<{ executable: string; server: string; config: ViewerMediaConfig['android'] }> {
  const directory = await mkdtemp(join(tmpdir(), 'mobile-mirror-scrcpy-'))
  directories.push(directory)
  const executable = join(directory, 'scrcpy')
  const server = join(directory, 'scrcpy-server')
  await writeFile(executable, '#!/bin/sh\n')
  await chmod(executable, 0o755)
  await writeFile(server, 'fixture-server')
  return {
    executable,
    server,
    config: { scrcpyPath: executable, scrcpyServerPath: server, maxSize: 1280, maxFps: 30, videoBitRate: 4_000_000 },
  }
}

function commandRunner(version = 'scrcpy 4.1\n', calls: string[][] = []): HostCommandRunner {
  return {
    async run(_command, args): Promise<HostCommandResult> {
      calls.push(args)
      return { ok: true, stdout: args[0] === '--version' ? version : '', stderr: '', exitCode: 0, timedOut: false, aborted: false }
    },
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Condition was not reached')
}
