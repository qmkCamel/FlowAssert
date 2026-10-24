import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveMirrorConfig as Config } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { parseWorkbenchFlow } from '../src/workbench-flow.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchStore } from '../src/workbench-store.js'
import { Worker } from 'node:worker_threads'
import { spawn } from 'node:child_process'

const demo = await readFile(new URL('../examples/flows/demo.yaml', import.meta.url), 'utf8')
const sanitizedArchive = JSON.parse(await readFile(new URL('./fixtures/workbench-runs/sampleapp-ios-history-title-missing.mobile-mirror-run.json', import.meta.url), 'utf8'))
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(provider = new MockProvider(0), Store = WorkbenchStore) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-workbench-'))
  const mirror = new MirrorService(Config({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
  await mirror.start({ provider: 'mock' })
  const store = new Store(root), workbench = new WorkbenchService(mirror, { store })
  cleanups.push(async () => { await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) })
  return { mirror, workbench, root, store }
}
async function complete(workbench: WorkbenchService, yaml = demo) {
  const started = await workbench.start(yaml)
  await workbench.wait()
  return workbench.get(started.id)
}

describe('native workbench closed loop', () => {
  it('runs the pinned native engine, acts, persists real PNG/source and verifies hashes', async () => {
    const { workbench, mirror, store } = await setup()
    const session = mirror.state().sessionId
    const run = await complete(workbench)
    expect(run, JSON.stringify(run)).toMatchObject({ verdict: 'pass', cleanup: 'session-retained', visualVerification: 'not-performed' })
    expect(run.productContract).toMatchObject({
      contractVersion: 1,
      provenance: { app: { version: { source: 'observed', value: 'mock-1' } }, environment: { driver: { source: 'observed', value: 'mobile-mirror-mock' } } },
      verification: { ui: { status: 'pass' }, evidence: { status: 'pass' }, visual: { required: false, status: 'not-performed' } },
    })
    expect(run.steps).toHaveLength(5)
    expect(run.steps[3]?.verification?.status).toBe('pass')
    const png = run.steps[3]!.evidence.find((f) => f.name.endsWith('.png'))!
    expect(png.lineage).toEqual({ contractVersion: 1, kind: 'original', integrity: 'verified', sharing: 'private' })
    expect((await store.readEvidence(run.id, png)).subarray(1, 4).toString()).toBe('PNG')
    expect(mirror.state().sessionId).toBe(session)
    expect(mirror.runOwner).toBeNull()
  }, 15000)

  it('rejects missing strict provenance before reserving or writing to the device', async () => {
    class CountingProvider extends MockProvider {
      writes = 0
      override async action(action: Parameters<MockProvider['action']>[0]) { this.writes++; return super.action(action) }
      override async inputText(request: Parameters<NonNullable<MockProvider['inputText']>>[0], signal?: AbortSignal) { this.writes++; return super.inputText(request, signal) }
      override async manageApp(request: Parameters<NonNullable<MockProvider['manageApp']>>[0], signal?: AbortSignal) { this.writes++; return super.manageApp(request, signal) }
    }
    const provider = new CountingProvider(0)
    const root = await mkdtemp(join(tmpdir(), 'mirror-strict-provenance-'))
    const projectPath = join(root, 'project.json')
    await writeFile(projectPath, JSON.stringify({ provenance: { required: ['appBinarySha256'] } }))
    const mirror = new MirrorService(Config({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
    await mirror.start({ provider: 'mock' })
    const workbench = new WorkbenchService(mirror, { root: join(root, 'runs'), projectPath })
    cleanups.push(async () => { await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) })
    await expect(workbench.start(demo)).rejects.toThrow('appBinarySha256')
    expect(provider.writes).toBe(0)
    expect(mirror.runOwner).toBeNull()
    expect(await workbench.list()).toEqual([])
  })

  it('retains screenshots and a real failed assertion; never ignores engine false', async () => {
    const { workbench } = await setup()
    const run = await complete(workbench, demo.replace('1 actions received', 'Impossible expected result'))
    expect(run.verdict, JSON.stringify(run)).toBe('fail')
    expect(run.steps.at(-1)?.status).toBe('failed')
    expect(run.steps.at(-1)?.evidence).toHaveLength(2)
  }, 15000)

  it('cancels a sleeping native worker, prevents later taps and keeps preview available', async () => {
    const { mirror, workbench } = await setup()
    const started = await workbench.start(demo.replace('- tap:', '- wait: 30\n- tap:'))
    await expect(mirror.action({ kind: 'back' })).rejects.toThrow('reserved')
    await expect(mirror.stop()).rejects.toThrow('reserved')
    await expect(mirror.observe({ image: false, structure: true })).rejects.toThrow('reserved')
    await expect(workbench.start(demo)).rejects.toThrow('already running')
    expect((await mirror.frame()).bytes.length).toBeGreaterThan(0)
    await expect.poll(async () => (await workbench.get(started.id)).steps.some((s) => s.kind === 'wait')).toBe(true)
    await workbench.cancel(started.id); await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run.verdict).toBe('cancelled')
    expect(run.steps.some((s) => s.kind === 'tap')).toBe(false)
    expect(mirror.runOwner).toBeNull()
    await mirror.action({ kind: 'back' })
  }, 15000)

  it('blocks a declared overlay at the checkpoint and retains the contaminated screenshot', async () => {
    const { workbench } = await setup()
    const run = await complete(workbench, demo.replace('platform: ios', 'blockers:\n  - text: Hello, harness.\nplatform: ios'))
    expect(run.verdict, JSON.stringify(run)).toBe('evidence-contaminated')
    expect(run.steps.at(-1)?.evidence).toHaveLength(2)
    expect(run.steps.some((s) => s.kind === 'tap')).toBe(false)
  }, 15000)

  it('detects a green engine assertion that no longer holds in checkpoint evidence', async () => {
    class ChangingSource extends MockProvider {
      reads = 0
      override async screenSource() {
        const source = await super.screenSource()
        this.reads++
        if (this.reads >= 3 && source.kind === 'normalized') {
          for (const node of source.structure.nodes) if (node.text === 'Hello, harness.') node.text = 'Changed screen'
        }
        return source
      }
    }
    const { workbench } = await setup(new ChangingSource(0))
    const run = await complete(workbench)
    expect(run.verdict, JSON.stringify(run)).toBe('evidence-conflict')
    expect(run.steps.some((s) => s.kind === 'tap')).toBe(false)
  }, 15000)

  it('never passes when writing a required screenshot fails', async () => {
    class BrokenStore extends WorkbenchStore {
      override async put(...args: Parameters<WorkbenchStore['put']>) {
        if (args[1].endsWith('.png')) throw new Error('Disk full')
        return super.put(...args)
      }
    }
    const { workbench, mirror } = await setup(new MockProvider(0), BrokenStore)
    const run = await complete(workbench)
    expect(run.verdict).toBe('inconclusive')
    expect(run.error).toContain('Disk full')
    expect(mirror.runOwner).toBeNull()
  }, 15000)

  it('detects modified evidence and rejects traversal', async () => {
    const { workbench, root, store } = await setup()
    const run = await complete(workbench)
    const file = run.steps[0]!.evidence[0]!
    await writeFile(join(root, run.id, file.name), 'tampered')
    await expect(store.readEvidence(run.id, file)).rejects.toThrow('integrity')
    expect((await workbench.get(run.id))).toMatchObject({ verdict: 'inconclusive', resultProjection: {
      reportedVerdict: 'pass', verdict: 'inconclusive', evidenceAvailability: 'unavailable' } })
    expect((await store.get(run.id)).verdict).toBe('pass')
    await expect(store.get('../outside')).rejects.toThrow('Invalid run')
    await expect(store.readEvidence(run.id, { ...file, name: '../secret.png' })).rejects.toThrow('filename')
  }, 15000)

  it('restores history, marks interrupted records unknown, and links retries', async () => {
    const { workbench, root, mirror } = await setup()
    const first = await complete(workbench)
    await workbench.close()
    const raw = JSON.parse(await readFile(join(root, first.id, 'manifest.json'), 'utf8'))
    raw.phase = 'running'; delete raw.verdict
    await writeFile(join(root, first.id, 'manifest.json'), JSON.stringify(raw))
    const second = new WorkbenchService(mirror, { root })
    cleanups.push(() => second.close())
    expect((await second.get(first.id)).verdict).toBe('inconclusive')
    const retry = await second.start(demo.replace('1 actions received', '2 actions received'), first.id)
    await second.wait()
    expect((await second.get(retry.id)).parentRunId).toBe(first.id)
    expect(await second.list()).toHaveLength(2)
  }, 15000)
})

describe('portable run archive import', () => {
  it('imports a verified finished failure under a new id and preserves readable evidence', async () => {
    const { store } = await setup()
    const run = await store.importArchive(sanitizedArchive)
    expect(run.id).not.toBe(sanitizedArchive.run.id)
    expect(run).toMatchObject({ source: 'import', verdict: 'fail', sessionId: 'imported', deviceName: 'Sanitized iPhone' })
    expect(run.steps[1]).toMatchObject({ index: 12, status: 'failed' })
    const screenshot = run.steps[1]!.evidence.find((file) => file.contentType === 'image/png')!
    expect((await store.readEvidence(run.id, screenshot)).subarray(1, 4).toString()).toBe('PNG')
  })

  it('rejects tampering, missing/unregistered files and limits without leaving a run', async () => {
    for (const mutate of [
      (archive: any) => { archive.files[0].base64 = `${archive.files[0].base64.slice(0, -2)}AA` },
      (archive: any) => { archive.files.pop() },
      (archive: any) => { archive.files.push({ ...archive.files[0], name: 'extra.txt' }) },
      (archive: any) => { archive.files[0].bytes = 4 * 1024 * 1024 + 1 },
      (archive: any) => { archive.files[0].contentType = archive.run.evidence[0].contentType = 'text/html' },
    ]) {
      const { store, root } = await setup()
      const archive = structuredClone(sanitizedArchive); mutate(archive)
      await expect(store.importArchive(archive)).rejects.toThrow()
      expect((await readdir(root)).filter((name) => /^[0-9a-f-]{36}$/.test(name))).toEqual([])
    }
  })
})

describe('checkpoint reliability and timings', () => {
  it('retains earlier evidence when the actual native worker exits unexpectedly', async () => {
    const { workbench, mirror, root } = await setup()
    await workbench.close()
    let native: Worker | undefined
    const interrupted = new WorkbenchService(mirror, { root, createWorker: (url, options) => { native = new Worker(url, options); return native } })
    cleanups.push(() => interrupted.close())
    const started = await interrupted.start(demo.replace('- tap:', '- wait: 30\n- tap:'))
    await expect.poll(async () => (await interrupted.get(started.id)).steps.some((s) => s.kind === 'wait')).toBe(true)
    await native!.terminate(); await interrupted.wait()
    const run = await interrupted.get(started.id)
    expect(run.verdict).toBe('inconclusive')
    expect(run.steps[0]!.evidence).toHaveLength(2)
    expect(run.steps.some((s) => s.kind === 'tap')).toBe(false)
    expect(mirror.runOwner).toBeNull()
  }, 15000)

  it('recovers committed PNG after the real host is killed before manifest registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-host-interruption-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const script = `
      import {readFile} from 'node:fs/promises';
      import {resolveMirrorConfig} from './src/mcp-config.ts';
      import {MirrorService} from './src/mirror-service.ts';
      import {WorkbenchStore} from './src/workbench-store.ts';
      import {WorkbenchService} from './src/workbench-service.ts';
      class KilledStore extends WorkbenchStore { async put(...args) { const file = await super.put(...args); if(args[1].endsWith('.png')) process.kill(process.pid, 'SIGKILL'); return file; } }
      const mirror = new MirrorService(resolveMirrorConfig({mockStartupDelayMs:0}), 'http://127.0.0.1');
      await mirror.start({provider:'mock'});
      const workbench = new WorkbenchService(mirror, {store: new KilledStore(process.argv[2])});
      await workbench.start(await readFile('examples/flows/demo.yaml','utf8')); await workbench.wait();
    `
    const scriptPath = join(root, 'interrupted-host.mjs')
    await writeFile(scriptPath, script.replaceAll("'./src/", `'${new URL('../src/', import.meta.url).href}`))
    const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, root], { stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''; child.stderr.on('data', (data: Buffer) => { errors += data.toString() })
    try {
      const signal = await new Promise<string | null>((resolve, reject) => { child.once('exit', (_code, signal) => resolve(signal)); child.once('error', reject) })
      expect(signal, errors).toBe('SIGKILL')
      const store = new WorkbenchStore(root); cleanups.push(() => store.close()); await store.init()
      const run = (await store.list())[0]!
      expect(run.verdict).toBe('inconclusive')
      const png = run.steps.flatMap((s) => s.evidence).find((f) => f.name === 'step-1.png')!
      expect(png.recovered).toBe(true)
      expect((await store.readEvidence(run.id, png)).subarray(1, 4).toString()).toBe('PNG')
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
  }, 15000)

  it('retains PNG when source capture fails, and never starts the next step', async () => {
    class BrokenSource extends MockProvider { override async screenSource(): ReturnType<MockProvider['screenSource']> { throw new Error('Source transport failed') } }
    const { workbench, store } = await setup(new BrokenSource(0))
    const run = await complete(workbench)
    expect(run.verdict).toBe('inconclusive')
    expect(run.steps).toHaveLength(1)
    expect(run.steps[0]!.checkpointError).toContain('xml: Source transport failed')
    expect(run.steps[0]!.evidence.map((f) => f.name)).toEqual(['step-1.png'])
    expect((await store.readEvidence(run.id, run.steps[0]!.evidence[0]!)).subarray(1, 4).toString()).toBe('PNG')
    expect(run.timings).toContainEqual(expect.objectContaining({ phase: 'xml', ok: false, step: 1 }))
  }, 15000)

  it('retains XML independently when screenshot capture fails', async () => {
    class BrokenImage extends MockProvider { override async snapshot(): ReturnType<MockProvider['snapshot']> { throw new Error('Screenshot failed') } }
    const { workbench, store } = await setup(new BrokenImage(0))
    const run = await complete(workbench)
    expect(run.verdict).toBe('inconclusive')
    expect(run.steps[0]!.evidence.map((f) => f.name)).toEqual(['step-1.xml'])
    expect((await store.readEvidence(run.id, run.steps[0]!.evidence[0]!)).toString()).toContain('AppiumAUT')
  }, 15000)

  it('preserves both files in memory and on restart when manifest updates fail', async () => {
    class BrokenManifest extends WorkbenchStore {
      override async save(run: Parameters<WorkbenchStore['save']>[0]) {
        if (run.steps.some((s) => s.evidence.length)) throw new Error('Manifest disk full')
        return super.save(run)
      }
    }
    const { workbench, mirror, root } = await setup(new MockProvider(0), BrokenManifest)
    const run = await complete(workbench)
    expect(run.verdict).toBe('inconclusive')
    expect(run.steps[0]!.evidence).toHaveLength(2)
    await workbench.close()
    const restarted = new WorkbenchService(mirror, { root }); cleanups.push(() => restarted.close())
    const recovered = await restarted.get(run.id)
    expect(recovered.verdict).toBe('inconclusive')
    expect(recovered.steps[0]!.evidence).toHaveLength(2)
    expect(recovered.steps[0]!.evidence.every((f) => f.recovered)).toBe(true)
    for (const file of recovered.steps[0]!.evidence) expect((await restarted.store.readEvidence(run.id, file)).length).toBeGreaterThan(0)
  }, 15000)

  it('recovers a partial temporary and orphaned run without following a symlink', async () => {
    const { workbench, root, mirror } = await setup()
    await workbench.close()
    const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', nonce = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
    await mkdir(join(root, id))
    await writeFile(join(root, id, `.evidence-${nonce}--step-1.png.tmp`), 'partial-png')
    await symlink('/etc/hosts', join(root, id, 'step-2.xml'))
    const restarted = new WorkbenchService(mirror, { root }); cleanups.push(() => restarted.close())
    const run = await restarted.get(id)
    expect(run.verdict).toBe('inconclusive')
    expect(run.evidence).toHaveLength(1)
    expect(run.evidence[0]).toMatchObject({ recovered: true, incomplete: true })
    expect((await restarted.store.readEvidence(id, run.evidence[0]!)).toString()).toBe('partial-png')
    expect(await readdir(join(root, id))).toContain(`.evidence-${nonce}--step-1.png.tmp`)
  })

  it('recovers a structurally corrupt manifest without hiding other history or changing source bytes', async () => {
    const { workbench, root, mirror } = await setup()
    const good = await complete(workbench)
    await workbench.close()
    const id = 'cccccccc-cccc-4ccc-cccc-cccccccccccc'
    await mkdir(join(root, id))
    const corrupt = JSON.stringify({ ...good, id, steps: [null] })
    await writeFile(join(root, id, 'manifest.json'), corrupt)
    const restarted = new WorkbenchService(mirror, { root }); cleanups.push(() => restarted.close())
    expect(await restarted.list()).toHaveLength(2)
    expect((await restarted.get(good.id)).verdict).toBe('pass')
    expect((await restarted.get(id)).verdict).toBe('inconclusive')
    const backup = (await readdir(join(root, id))).find((name) => name.startsWith('manifest-before-recovery-'))!
    expect(await readFile(join(root, id, backup), 'utf8')).toBe(corrupt)
  }, 15000)

  it('avoids geometry on source/checkpoint and measures actual native waits after evidence', async () => {
    class CountGeometry extends MockProvider {
      geometries = 0
      override async screenGeometry() { this.geometries++; return super.screenGeometry() }
    }
    const provider = new CountGeometry(0)
    const { workbench } = await setup(provider)
    const run = await complete(workbench, demo.replace('- tap:', '- wait: 0.1\n- tap:'))
    expect(run.verdict).toBe('pass')
    expect(provider.geometries).toBe(3) // initialization, fresh tap bounds and before-image geometry validation
    expect(run.steps.find((s) => s.kind === 'wait')?.waitMs).toBeGreaterThanOrEqual(90)
    expect(new Set(run.timings!.map((t) => t.phase))).toEqual(new Set(['geometry', 'locate', 'action', 'png', 'xml', 'persist', 'verify']))
    expect(run.timings!.every((t) => Number.isFinite(t.durationMs) && t.durationMs >= 0)).toBe(true)
    expect(run.steps.every((s) => s.evidence.length === 2 + (s.actionEvidence?.actions.filter(action => action.before).length ?? 0) && s.captures?.length === 2)).toBe(true)
  }, 15000)
})

describe('deterministic flow validation', () => {
  it.each([
    ['natural language', demo.replace('- launchApp', '- open whatever app')],
    ['early done', demo.replace('- launchApp', '- done')],
    ['unknown header', demo.replace('platform: ios', 'env: ../../secret\nplatform: ios')],
    ['code', demo.replace('- launchApp', '- runScript: malicious.js')],
    ['unstructured selector', demo.replace('tap:\n    accessibilityId: action-card', 'tap: whatever')],
    ['interpolation', demo.replace('action-card', '${secrets.password}')],
    ['infinite wait', demo.replace('- launchApp', '- wait: .inf')],
  ])('rejects %s before any device mutation', async (_label, yaml) => {
    await expect(parseWorkbenchFlow(yaml)).rejects.toThrow()
  })
})

describe('run ownership recovery', () => {
  it('fences further control after an uncertain dispatched action until reconnect', async () => {
    class UncertainTap extends MockProvider {
      override async action(action: Parameters<MockProvider['action']>[0]) {
        await super.action(action)
        throw new Error('Transport failed after dispatch')
      }
    }
    const { mirror, workbench } = await setup(new UncertainTap(0))
    const run = await complete(workbench)
    expect(run.verdict).toBe('inconclusive')
    await expect(mirror.action({ kind: 'back' })).rejects.toThrow('uncertain')
    await expect(workbench.start(demo)).rejects.toThrow('uncertain')
    await mirror.stop()
    await mirror.start({ provider: 'mock' })
    const lease = mirror.acquireRun('new-test', new AbortController().signal)
    await lease.release()
  }, 15000)

  it('waits for dispatched controls before cancellation releases the lease', async () => {
    let started = false, finish!: () => void
    class SlowTap extends MockProvider {
      override async action(action: Parameters<MockProvider['action']>[0]) {
        started = true
        await new Promise<void>((resolve) => { finish = resolve })
        await super.action(action)
      }
    }
    const { mirror, workbench } = await setup(new SlowTap(0))
    const run = await workbench.start(demo)
    await expect.poll(() => started).toBe(true)
    await workbench.cancel(run.id)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(mirror.runOwner).toBe(run.id)
    finish(); await workbench.wait()
    expect(mirror.runOwner).toBeNull()
    expect((await workbench.get(run.id)).verdict).toBe('cancelled')
  }, 15000)

  it('does not hide corrupted manifests or leave failed setup looking active', async () => {
    class BrokenFlowStore extends WorkbenchStore {
      override async put(...args: Parameters<WorkbenchStore['put']>) {
        if (args[1] === 'flow.yaml') throw new Error('Flow disk full')
        return super.put(...args)
      }
    }
    const { workbench, root } = await setup(new MockProvider(0), BrokenFlowStore)
    await expect(workbench.start(demo)).rejects.toThrow('Flow disk full')
    const history = await workbench.list()
    expect(history[0]).toMatchObject({ phase: 'finished', verdict: 'inconclusive' })
    await writeFile(join(root, history[0]!.id, 'manifest.json'), '{invalid')
    expect((await workbench.list())[0]).toMatchObject({ verdict: 'inconclusive', name: 'Interrupted / unreadable run' })
  })
})
