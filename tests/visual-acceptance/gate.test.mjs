import { it, expect } from 'vitest'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { verifyGate } from '../../scripts/web-visual-acceptance/gate.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const json = (path, value) => writeFile(path, JSON.stringify(value))
it('independently validates a complete matrix and rejects false success, missing review and corrupted evidence', async () => {
  // Deliberately synthetic unit-test records; not a claim of actual visual acceptance.
  const root = await mkdtemp(join(tmpdir(), 'visual-gate-matrix-'))
  try {
    const png = await sharp({ create: { width: 1280, height: 800, channels: 3, background: '#123456' } }).png().toBuffer()
    const key = [], reviews = [], origin = 'http://127.0.0.1:12345', fixtureId = 'synthetic-test'
    await json(join(root, 'manifest.json'), { environment: { version: 'agent-browser 0.33.2' }, commit: 'test', diffSha256: hash('test') })
    await json(join(root, 'boundary-probe.json'), { status: 403 })
    await json(join(root, 'fixture.json'), { origin, id: fixtureId, expectedMarker: { x: 0.5, y: 0.3 } })
    for (const scenario of ['VA-01', 'VA-04', 'VA-05']) for (const variant of ['none', 'fault']) for (let round = 1; round <= 3; round++) {
      const id = `${scenario}-${variant}-${round}`, dir = join(root, id), step = scenario === 'VA-01' ? 1 : 3
      await mkdir(join(dir, 'screenshots'), { recursive: true })
      key.push({ id, scenario, variant, round })
      const names = scenario === 'VA-01' ? ['overview-viewport', 'overview-full'] : scenario === 'VA-04' ? ['before-after-viewport', 'before-after-full', 'not-recorded'] : ['missing-viewport', 'missing-full', ...(variant === 'none' ? ['recovered-viewport', 'recovered-full'] : [])]
      const evidence = names.map(name => ({ path: `screenshots/${name}.png`, sha256: hash(png), fullPage: !name.endsWith('viewport') }))
      for (const e of evidence) await writeFile(join(dir, e.path), png)
      const now = new Date().toISOString(), pass = variant === 'none'
      await json(join(dir, 'result.json'), { id, scenario, round, execution: 'completed', startedAt: now, finishedAt: now, actions: 20,
        checks: [{ name: 'fixture-check', pass }], evidence, requests: [{ method: 'GET' }], acceptance: pass ? 'incomplete' : 'fail',
        facts: { origin, url: `${origin}/#/runs/${fixtureId}?step=${step}&tab=evidence`, locale: 'en', result: { visible: true, alt: `Archived step ${step} screenshot` }, play: { visible: true, inViewport: true, unobscured: true }, comparison: { marker: { x: 0.5, y: 0.3 }, images: [{ ready: true }, { ready: true }], retryVisible: true } },
        recovered: { comparison: { retryVisible: false, images: [{ ready: true }, { ready: true }] } } })
      reviews.push({ id, status: pass ? 'pass' : 'fail', reviewedAt: now, reviewer: { type: 'human', identity: 'synthetic unit-test reviewer, not a real review' },
        items: evidence.map(e => ({ evidence: e.path, sha256: e.sha256, verdict: pass ? 'pass' : 'fail', observation: 'Synthetic fixture observation solely for contract testing.' })) })
    }
    await json(join(root, 'calibration-key.json'), key); await json(join(root, 'review.json'), reviews)
    expect((await verifyGate(root)).status).toBe('pass')
    const fault = key.find(r => r.variant === 'fault'), path = join(root, fault.id, 'result.json'), result = JSON.parse(await readFile(path, 'utf8'))
    await json(path, { ...result, acceptance: 'pass' })
    expect((await verifyGate(root)).issues).toContain(`${fault.id}: False pass contradicts visual evidence`)
    await json(path, result)
    await json(join(root, 'review.json'), [])
    expect((await verifyGate(root)).status).toBe('blocked')
    await json(join(root, 'review.json'), reviews)
    const missing = join(root, key[0].id, 'screenshots/overview-viewport.png')
    await rm(missing)
    expect((await verifyGate(root)).status).toBe('blocked')
    await writeFile(missing, png)
    // A PNG signature alone is not a decodable image, even with a matching digest.
    const invalid = Buffer.from('\x89PNG\r\ninvalid')
    await writeFile(missing, invalid)
    const normalPath = join(root, key[0].id, 'result.json'), normal = JSON.parse(await readFile(normalPath, 'utf8'))
    normal.evidence[0].sha256 = hash(invalid); reviews[0].items[0].sha256 = hash(invalid)
    await json(normalPath, normal); await json(join(root, 'review.json'), reviews)
    expect((await verifyGate(root)).status).toBe('blocked')
  } finally { await rm(root, { recursive: true, force: true }) }
})
