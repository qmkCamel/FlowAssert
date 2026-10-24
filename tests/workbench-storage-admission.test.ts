import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchStore, type TestRun } from '../src/workbench-store.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'

const MIB = 1024 * 1024

describe('store evidence admission', () => {
  it('serializes reservations, preserves the safety margin, and releases only at terminal completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-capacity-'))
    const store = new WorkbenchStore(root, async () => 256 * MIB + 96 * MIB)
    try {
      const first = await store.reserveEvidence('run:first', 64 * MIB)
      await expect(store.reserveEvidence('run:first', 1)).rejects.toThrow(/already exists/)
      await expect(store.reserveEvidence('run:second', 64 * MIB)).rejects.toThrow('storage-insufficient')
      first(); first()
      const second = await store.reserveEvidence('run:second', 64 * MIB)
      second()
    } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('fails closed when capacity cannot be measured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-capacity-'))
    const store = new WorkbenchStore(root, async () => { throw new Error('statfs unavailable') })
    try { await expect(store.reserveEvidence('run:unknown', MIB)).rejects.toThrow('storage-capacity-unknown') }
    finally { await store.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('aggregates concurrent build and evidence reservations on the same volume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-build-capacity-'))
    const store = new WorkbenchStore(join(root, 'evidence'), async () => 256 * MIB + 190 * MIB)
    try {
      await store.init()
      const first = await store.reserveBuildAndEvidence('build:first', root, 100 * MIB, 64 * MIB)
      await expect(store.reserveBuildAndEvidence('build:second', root, 20 * MIB, 16 * MIB))
        .rejects.toThrow('storage-insufficient')
      await expect(store.reserveEvidence('run:concurrent', 32 * MIB)).rejects.toThrow('storage-insufficient')
      first()
      const second = await store.reserveBuildAndEvidence('build:second', root, 20 * MIB, 16 * MIB)
      second()
    } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('rejects a build before side effects when either volume capacity is unknown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-build-unknown-'))
    const store = new WorkbenchStore(join(root, 'evidence'), async () => { throw new Error('statfs unavailable') })
    try {
      await store.init()
      await expect(store.reserveBuildAndEvidence('build:unknown', root, MIB, MIB))
        .rejects.toThrow('storage-capacity-unknown')
    } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('rejects a new run before any device action when the safety margin is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-capacity-run-'))
    let actions = 0
    class CountedProvider extends MockProvider {
      override async action(input: Parameters<MockProvider['action']>[0]) { actions++; await super.action(input) }
    }
    const provider = new CountedProvider(0)
    const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
    const store = new WorkbenchStore(join(root, 'runs'), async () => 256 * MIB + 63 * MIB)
    const workbench = new WorkbenchService(mirror, { store })
    try {
      await mirror.start({ provider: 'mock' })
      await expect(workbench.start('name: Low space\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n'))
        .rejects.toThrow('storage-insufficient')
      expect(actions).toBe(0)
      expect(await store.list()).toEqual([])
    } finally { await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it.each(['manifest:before-write', 'manifest:after-write', 'manifest:after-rename',
    'evidence:before-write', 'evidence:after-write', 'evidence:after-link'])(
    'keeps earlier evidence readable after injected ENOSPC at %s', async phase => {
      const root = await mkdtemp(join(tmpdir(), 'mirror-enospc-'))
      let armed = false
      const store = new WorkbenchStore(root, async () => 1024 * MIB, async point => {
        if (armed && point === phase) {
          armed = false
          const error = new Error('No space left on device') as NodeJS.ErrnoException
          error.code = 'ENOSPC'
          throw error
        }
      })
      const priorId = '00000000-0000-4000-8000-000000000001'
      const nextId = '00000000-0000-4000-8000-000000000002'
      try {
        await store.init()
        const prior = await store.put(priorId, 'flow.yaml', 'old intact evidence', 'text/yaml')
        armed = true
        if (phase.startsWith('evidence:')) await expect(store.put(nextId, 'flow.yaml', 'new evidence', 'text/yaml')).rejects.toMatchObject({ code: 'ENOSPC' })
        else {
          const run: TestRun = { schemaVersion: 1, id: nextId, name: 'new', yaml: '', engine: 'fixture', phase: 'running',
            startedAt: '2026-09-26T00:00:00Z', sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock',
            verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed',
            steps: [], evidence: [], cleanup: 'pending' }
          await expect(store.save(run)).rejects.toMatchObject({ code: 'ENOSPC' })
          expect((await store.get(nextId)).verdict).not.toBe('pass')
        }
        expect((await store.readEvidence(priorId, prior)).toString()).toBe('old intact evidence')
      } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
    })
})
