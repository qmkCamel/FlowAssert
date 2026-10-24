import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LocalViewerConfigStore,
  defaultLocalViewerConfigPath,
  resolveLocalViewerSettings,
} from '../src/local-viewer-config.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LocalViewerConfigStore', () => {
  it('resolves a repository-external default path and rejects unknown settings', () => {
    expect(defaultLocalViewerConfigPath({ XDG_CONFIG_HOME: '/private/config-root' })).toBe('/private/config-root/deepseek-harness-mobile-mirror/viewer.json')
    expect(resolveLocalViewerSettings()).toMatchObject({
      mirror: { appiumRuntimeMode: 'external', appiumSessionStartupTimeoutMs: 120_000 },
      local: { preferredPlatform: null },
    })
    expect(() => resolveLocalViewerSettings({ mirror: {}, local: { preferredPlatform: 'ios', udid: 'PRIVATE' } })).toThrow('Invalid local Viewer configuration')
    expect(() => new LocalViewerConfigStore('relative.json')).toThrow('Invalid local Viewer configuration')
  })

  it('atomically persists only validated setup values with private permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mobile-mirror-config-'))
    roots.push(root)
    const path = join(root, 'private', 'viewer.json')
    const store = new LocalViewerConfigStore(path)
    const before = await store.load()
    expect(before.exists).toBe(false)

    const settings = await store.saveSetup({
      platform: 'ios',
      appiumExecutablePath: '/trusted/appium',
      signing: { teamId: 'ABCDE12345', wdaBundleId: 'com.example.WDA' },
    })
    expect(settings).toMatchObject({
      mirror: {
        defaultProvider: 'appium',
        appiumRuntimeMode: 'managed',
        appiumExecutablePath: '/trusted/appium',
        iosWdaXcodeOrgId: 'ABCDE12345',
        iosWdaUpdatedBundleId: 'com.example.WDA',
      },
      local: { preferredPlatform: 'ios' },
    })
    const mode = (await lstat(path)).mode & 0o777
    const parentMode = (await lstat(join(root, 'private'))).mode & 0o777
    expect(parentMode).toBe(0o700)
    expect(mode).toBe(0o600)
    const text = await readFile(path, 'utf8')
    expect(text).not.toMatch(/udid|serial|assistantId|deviceRef|capabilities|password|certificate/)
    await expect(store.load()).resolves.toMatchObject({ exists: true, settings: { local: { preferredPlatform: 'ios' } } })
  })

  it('rejects unsafe targets, oversized files, and invalid signing without replacing data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mobile-mirror-config-'))
    roots.push(root)
    const target = join(root, 'target.json')
    const link = join(root, 'viewer.json')
    await writeFile(target, '{}', { mode: 0o600 })
    await symlink(target, link)
    const linked = new LocalViewerConfigStore(link)
    await expect(linked.load()).rejects.toThrow('Invalid local Viewer configuration')
    await expect(linked.saveSetup({ platform: 'android', appiumExecutablePath: '/trusted/appium' })).rejects.toThrow('Invalid local Viewer configuration')
    expect(await readFile(target, 'utf8')).toBe('{}')

    const large = join(root, 'large.json')
    await writeFile(large, 'x'.repeat(64 * 1024 + 1))
    await expect(new LocalViewerConfigStore(large).load()).rejects.toThrow('Invalid local Viewer configuration')
    await expect(new LocalViewerConfigStore(join(root, 'invalid.json')).saveSetup({
      platform: 'ios',
      appiumExecutablePath: '/trusted/appium',
      signing: { teamId: 'bad', wdaBundleId: 'not a bundle' },
    })).rejects.toThrow('Invalid local Viewer configuration')
  })
})
