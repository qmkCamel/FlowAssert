import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Browser, assertOrigin, cleanEnv, preflight } from '../../scripts/web-visual-acceptance/browser.mjs'
import { acceptance } from '../../scripts/web-visual-acceptance/results.mjs'
import { verifyGate } from '../../scripts/web-visual-acceptance/gate.mjs'
import { READY } from '../../scripts/web-visual-acceptance/collector.mjs'
import { runInNewContext } from 'node:vm'

describe('visual acceptance safety contracts', () => {
  it('waits for the selected step instead of accepting a retained old image', () => {
    const image = { complete: true, naturalWidth: 320, alt: 'Archived step 3 screenshot' }
    let pending = true
    const context = { URLSearchParams, location: { hash: '#/runs/example?step=2&tab=evidence' }, document: {
      documentElement: { lang: 'en' }, querySelector: selector => selector === '.evidence-pending' ? pending : image,
    } }
    expect(runInNewContext(READY, context)).toBe(false)
    pending = false; expect(runInNewContext(READY, context)).toBe(false)
    image.alt = 'Archived step 2 screenshot'; expect(runInNewContext(READY, context)).toBe(true)
    context.document.documentElement.lang = 'zh-CN'; expect(runInNewContext(READY, context)).toBe(false)
    image.alt = '归档步骤 2 截图'; expect(runInNewContext(READY, context)).toBe(true)
  })
  it('rejects denied, foreign, credential-bearing and non-http origins', () => {
    for (const url of ['http://127.0.0.1:3210', 'http://127.0.0.1:1235', 'https://example.com', 'file:///tmp/a', 'http://x:y@127.0.0.1:1234']) expect(() => assertOrigin(url, 'http://127.0.0.1:1234')).toThrow()
    expect(() => assertOrigin('http://127.0.0.1:1234/#/runs/test', 'http://127.0.0.1:1234')).not.toThrow()
  })
  it('never inherits profile, proxy, provider, credentials or browser attachment configuration', () => {
    expect(cleanEnv({ HOME: '/home/test', PATH: '/bin', HTTP_PROXY: 'private', AGENT_BROWSER_PROFILE: 'Default', AGENT_BROWSER_AUTO_CONNECT: '1', AI_GATEWAY_API_KEY: 'secret' })).toEqual({ HOME: '/home/test', PATH: '/bin' })
  })
  it('does not turn collection or missing evidence into pass', () => {
    const result = { execution: 'completed', checks: [{ pass: true }], evidence: [{}], visualReview: { status: 'needs-review' } }
    expect(acceptance(result)).toBe('incomplete')
    expect(acceptance({ ...result, visualReview: { status: 'pass' } })).toBe('pass')
    for (const execution of ['cancelled', 'error']) expect(acceptance({ ...result, execution, visualReview: { status: 'pass' } })).toBe('incomplete')
    expect(acceptance({ ...result, evidence: [], visualReview: { status: 'pass' } })).toBe('incomplete')
    expect(acceptance({ ...result, checks: [{ pass: false }] })).toBe('fail')
  })
  it('rejects missing tool without installing or launching a browser', async () => {
    await expect(preflight(tmpdir(), '/nonexistent/agent-browser')).rejects.toThrow()
    await expect(preflight(tmpdir(), process.execPath)).rejects.toThrow('Expected agent-browser')
  })
  it('rejects cancellation and exhausted action/time budgets before dispatch', async () => {
    const signal = AbortSignal.abort(new Error('cancelled'))
    for (const limits of [{ signal }, { maxActions: 0 }, { timeoutMs: 0 }]) {
      const browser = new Browser({ origin: 'http://127.0.0.1:1234', root: tmpdir(), ...limits })
      await expect(browser.snapshot()).rejects.toThrow()
      expect(browser.actions).toBe(0)
    }
  })
  it('accepts only registered controls and measurement conditions', async () => {
    const browser = new Browser({ origin: 'http://127.0.0.1:1234', root: tmpdir() })
    await expect(browser.click('delete')).rejects.toThrow('Unknown safe control')
    await expect(browser.wait('eval anything')).rejects.toThrow('Unknown ready state')
    await expect(browser.capture('../outside')).rejects.toThrow('Invalid evidence')
    expect(browser.actions).toBe(0)
  })
  it('independent gate rejects missing review instead of trusting a pass label', async () => {
    const root = await mkdtemp(join(tmpdir(), 'visual-gate-'))
    try {
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ acceptance: 'pass', environment: {} }))
      await writeFile(join(root, 'calibration-key.json'), '[]')
      await writeFile(join(root, 'fixture.json'), '{}')
      await expect(verifyGate(root)).rejects.toThrow()
      expect(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')).acceptance).toBe('pass')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
