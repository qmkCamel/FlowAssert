import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, mkdir, readFile, statfs } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { COLLECT, READY, COMPARISON_READY, ERROR_READY } from './collector.mjs'

const exec = promisify(execFile)
const toolchain = JSON.parse(await readFile(new URL('./toolchain.json', import.meta.url), 'utf8'))
export const TOOL_VERSION = toolchain.agentBrowser
export const CHROME = toolchain.browserExecutable
const CONFIG = new URL('./config.json', import.meta.url).pathname
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function cleanEnv(source = process.env) {
  // No inherited auth, cloud provider, proxy, extension or personal profile settings.
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'SystemRoot'].filter(key => source[key]).map(key => [key, source[key]]))
}
export function assertOrigin(url, origin) {
  const target = new URL(url)
  if (target.origin !== origin || target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.port === '3210' || target.username || target.password) throw new Error('Target outside authorized synthetic origin')
}
export async function preflight(directory, binary = 'agent-browser') {
  const env = cleanEnv()
  const version = (await exec(binary, ['--version'], { env, timeout: 10000 })).stdout.trim()
  if (version !== `agent-browser ${TOOL_VERSION}`) throw new Error(`Expected agent-browser ${TOOL_VERSION}; got ${version}. No automatic installation.`)
  const browser = (await exec(CHROME, ['--version'], { env, timeout: 10000 })).stdout.trim()
  if (browser !== toolchain.browser) throw new Error(`Expected ${toolchain.browser}; got ${browser}. Review toolchain.json before changing versions.`)
  const disk = await statfs(directory)
  if (disk.bavail * disk.bsize < 256 * 1024 * 1024) throw new Error('At least 256 MiB free disk required')
  return { version, browser, node: process.version, os: process.platform, architecture: process.arch }
}

export class Browser {
  #origin; #root; #signal; #count = 0; #deadline; #session; #headed; #opened = false
  constructor({ origin, root, signal, headed = true, maxActions = 30, timeoutMs = 180000 }) {
    assertOrigin(origin, origin)
    this.#origin = origin; this.#root = resolve(root); this.#signal = signal; this.#headed = headed
    this.#deadline = Date.now() + timeoutMs; this.maxActions = maxActions; this.#session = `va-${randomUUID().slice(0, 8)}`
  }
  get session() { return this.#session }
  get actions() { return this.#count }
  async #command(args, cleanup = false) {
    if (!cleanup) {
      this.#signal?.throwIfAborted()
      if (this.#count >= this.maxActions || Date.now() >= this.#deadline) throw new Error('Browser budget exceeded')
      this.#count++
    }
    const started = Date.now()
    const flags = ['--config', CONFIG, '--session', this.#session, '--namespace', this.#session, '--json', '--executable-path', CHROME, '--headed', String(this.#headed), '--allowed-domains', '127.0.0.1', '--restore-save', 'never', '--idle-timeout', '3m']
    try {
      const { stdout } = await exec('agent-browser', [...flags, ...args], { env: { ...cleanEnv(), AGENT_BROWSER_DEFAULT_TIMEOUT: '10000' }, timeout: cleanup ? 10000 : Math.min(20000, Math.max(1, this.#deadline - Date.now())), maxBuffer: 4 * 1024 * 1024, ...(cleanup ? {} : { signal: this.#signal }) })
      const result = JSON.parse(stdout)
      if (!result.success) throw new Error(result.error ?? stdout)
      await this.#log({ args: args[0] === 'eval' ? ['collect-fixed-facts'] : args, started, durationMs: Date.now() - started, result })
      return result.data
    } catch (error) {
      const message = `${error.message ?? error}${error.stdout ? `\n${error.stdout}` : ''}${error.stderr ? `\n${error.stderr}` : ''}`
      await this.#log({ args: [args[0]], started, durationMs: Date.now() - started, error: message }); throw new Error(message)
    }
  }
  async #log(entry) { await appendFile(`${this.#root}/steps.jsonl`, `${JSON.stringify({ session: this.#session, ...entry })}\n`) }
  async open(url) { assertOrigin(url, this.#origin); this.#opened = true; await this.#command(['open', url]); await this.#command(['set', 'viewport', '1280', '800']); await this.wait('result') }
  async wait(state) {
    const expression = { result: READY, comparison: COMPARISON_READY, error: ERROR_READY,
      playing: `document.querySelector('#playback-toggle')?.getAttribute('aria-pressed') === 'true'`,
      ended: `/Playback ended|回放结束/.test(document.querySelector('#playback-status')?.textContent)`,
      failure: `/Paused at failed step|已在失败步骤暂停/.test(document.querySelector('#playback-status')?.textContent)`,
      loading: `Boolean(document.querySelector('.evidence-pending'))`,
      thumbnails: `document.querySelectorAll('.replay-frames img').length === 5 && [...document.querySelectorAll('.replay-frames img')].every(i=>i.complete && i.naturalWidth)`,
    }[state]
    if (!expression) throw new Error('Unknown ready state')
    await this.#command(['wait', '--fn', expression])
  }
  async snapshot() { return this.#command(['snapshot']) }
  async facts() { const data = await this.#command(['eval', COLLECT]); const facts = data.result; assertOrigin(facts.url, this.#origin); return facts }
  async click(control) {
    const selector = { comparison: '.action-comparison summary', retry: '.action-comparison button', previous: '#playback-previous', next: '#playback-next', play: '#playback-toggle', filmstrip: '.replay-filmstrip summary', thumbnail: '.replay-frames button[data-step="3"]', failure: '[data-failure="4"]' }[control]
    if (!selector) throw new Error('Unknown safe control')
    await this.snapshot(); await this.#command(['click', selector])
  }
  async viewport(narrow = false) { await this.#command(['set', 'viewport', ...(narrow ? ['390', '844'] : ['1280', '800'])]) }
  async select(control, value) {
    if (control === 'locale' && ['zh-CN', 'en'].includes(value)) return this.#command(['select', '#language-select', value])
    if (control === 'speed' && ['0.5', '1', '2'].includes(value)) return this.#command(['select', '#playback-speed', value])
    throw new Error('Unknown safe selection')
  }
  async key(control, key) {
    const selector = { seek: '#replay-seek', step: '#analysis-steps button[data-step="3"]', play: '#playback-toggle' }[control]
    if (!selector || !['Home', 'End', 'ArrowRight', 'ArrowDown', 'Tab', 'Enter', 'Space'].includes(key)) throw new Error('Unknown safe keyboard operation')
    await this.#command(['focus', selector]); await this.#command(['press', key])
  }
  async cssZoom200() { await this.#command(['eval', `document.documentElement.style.zoom = '2'`]) }
  async capture(name, full = false) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid evidence name')
    await mkdir(`${this.#root}/screenshots`, { recursive: true })
    const path = `${this.#root}/screenshots/${name}.png`
    await this.#command(['screenshot', ...(full ? ['--full'] : []), path])
    const bytes = await readFile(path)
    if (!bytes.subarray(1, 4).equals(Buffer.from('PNG'))) throw new Error('Screenshot is not PNG')
    return { path: `screenshots/${name}.png`, sha256: hash(bytes), bytes: bytes.length, fullPage: full }
  }
  async close() { if (this.#opened) await this.#command(['close'], true) }
}
