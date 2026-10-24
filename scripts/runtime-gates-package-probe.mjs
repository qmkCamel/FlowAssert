import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

if (!process.argv[2]) throw new Error('Usage: runtime-gates-package-probe candidate/lib/application.js')
const entry = resolve(process.argv[2]), candidate = dirname(dirname(entry))
const { LocalDeviceRuntime, Config } = await import(pathToFileURL(entry).href)
const root = await mkdtemp(join(tmpdir(), 'mirror-runtime-package-'))
const header = 'name: Packed runtime\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n'
const projectPath = join(root, 'project.json')
await writeFile(join(root, 'packed.yaml'), header + '- measure: { id: registered, maxElapsedMs: 10000, steps: [ { assertVisible: { text: "Hello, harness." } } ] }')
await writeFile(projectPath, JSON.stringify({ flows: { packed: 'packed.yaml' }, suites: { packed: { name: 'Packed runtime', cases: [{ id: 'packed', flow: 'packed' }] } } }))
const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0, mockStartupDelayMs: 0, agentAppControlPolicy: 'session-app',
  agentTestControl: { enabled: true, projectPath, allowedFlows: ['packed'], allowedSuites: ['packed'], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: ['flow', 'image', 'plan'] } }), { workbenchRoot: join(root, 'runs') })
const browser = await chromium.launch({ headless: true, ...(!existsSync(chromium.executablePath()) ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
try {
  for (const relative of ['docs/runtime-assertions.md', 'examples/runtime/project.json.example', 'examples/business-http/verify-only-once.mjs']) assert((await readFile(join(candidate, relative))).byteLength > 0)
  await runtime.listen(); await runtime.commands.execute('mobile_mirror_start', { provider: 'mock' })
  const workbench = runtime.application.workbench
  const started = await workbench.start(header + '- measure: { id: endpoint, maxElapsedMs: 10000, steps: [ { assertVisible: { text: "Hello, harness." } } ] }\n- restartApp: { timeoutMs: 5000 }\n- assertVisible: { text: "Hello, harness." }')
  await workbench.wait(); const run = await workbench.get(started.id)
  assert.equal(run.resultProjection.clean, true); assert.equal(run.productContract.contractVersion, 2)
  assert.equal(run.measurements[0].status, 'pass')
  assert.deepEqual(run.productContract.requiredFeatures, ['e2e-measure-v1', 'app-restart-v1'])
  const response = await fetch(runtime.viewer.url + '/api/runs/' + run.id), http = await response.json()
  assert.deepEqual(http.resultProjection, run.resultProjection)
  const share = runtime.application.share, options = { files: [{ name: 'step-1.xml' }] }
  const preview = await share.preview(run.id, options), archive = await share.export(run.id, options, preview.digest, true)
  assert.equal(archive.version, 4); assert(!JSON.stringify(archive).includes(run.sessionId))
  assert.equal((await workbench.store.importArchive(archive)).verdict, 'inconclusive')
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(runtime.viewer.url); await page.locator('#workbench-toggle').click(); await page.locator('[data-run-id="' + run.id + '"]').click()
  await page.locator('.wb-measurement').waitFor()
  assert((await page.locator('.wb-runtime-dimensions').textContent()).includes('Performance: Passed'))
  await page.locator('#workbench-panel').evaluate(panel => { panel.scrollTop += panel.querySelector('#wb-detail').getBoundingClientRect().top - panel.getBoundingClientRect().top - 20 })
  await mkdir('artifacts/screenshots', { recursive: true }); await page.screenshot({ path: 'artifacts/screenshots/runtime-gates-packaged.png' })
  const sensitive = await workbench.start(header + '- assertEventually: { predicate: { assertVisible: { text: "Hello, harness." } }, withinMs: 2000, pollMs: 200, maxSampleGapMs: 1000 }')
  await workbench.wait(); assert.equal((await workbench.get(sensitive.id)).verdict, 'inconclusive')
  const legacy = await workbench.start(header + '- assertVisible: { text: "Hello, harness." }')
  await workbench.wait(); assert.equal((await workbench.get(legacy.id)).productContract.contractVersion, 1)
  const health = header.replace('---', 'runtimeGates: { health: { signals: [crash] } }\n---')
  await assert.rejects(workbench.start(health + '- assertVisible: { text: "Hello, harness." }'), /health-source-unsupported/)
  const code = await new Promise((resolveCode, reject) => { const child = spawn(process.execPath, [join(candidate, 'scripts/mobile-mirror-cli.mjs'), 'health-probe', '--platform', 'ios'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''; child.stdout.on('data', value => { text += value }); child.on('error', reject); child.on('close', code => { assert(text.includes('authorized-source-unavailable')); resolveCode(code) }) })
  assert.equal(code, 2); assert.deepEqual(errors, [])
  const catalog = (await runtime.commands.execute('mobile_mirror_test_catalog', {})).value
  const accepted = (await runtime.commands.execute('mobile_mirror_run_start', { requestId: 'packed-runtime', target: { kind: 'flow', id: 'packed' }, catalogRevision: catalog.catalogRevision })).value
  let status
  const deadline = performance.now() + 20000
  do {
    assert(performance.now() < deadline, 'Shared command did not finish')
    await new Promise(resolve => setTimeout(resolve, 100))
    status = (await runtime.commands.execute('mobile_mirror_run_status', { executionId: accepted.executionId })).value
  } while (status.phase !== 'finished')
  assert.equal(status.resultProjection.contractVersion, 2); assert.equal(status.resultProjection.clean, true)
  const cli = await new Promise((resolveCli, reject) => {
    const child = spawn(process.execPath, [join(candidate, 'scripts/mobile-mirror-cli.mjs'), 'test', 'suite', 'packed', '--url', runtime.viewer.url], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''; child.stdout.on('data', bytes => { stdout += bytes }); child.stderr.on('data', bytes => { stderr += bytes })
    child.once('error', reject); child.once('close', code => resolveCli({ code, stdout, stderr }))
  })
  assert.equal(cli.code, 0, cli.stderr)
  const suite = JSON.parse(cli.stdout.trim().split('\n').at(-1))
  assert.equal(suite.cases[0].resultProjections[0].contractVersion, 2); assert.equal(suite.cases[0].resultProjections[0].clean, true)
  const { MobileMirrorMcpServer } = await import(pathToFileURL(join(candidate, 'lib/mcp.js')).href)
  const server = new MobileMirrorMcpServer({ mirror: runtime.config, mcp: { maxImageBytes: 8 * 1024 * 1024 } }, { runtime })
  const client = new Client({ name: 'runtime-package-probe', version: '1' }), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport); await client.connect(clientTransport)
    const result = await client.callTool({ name: 'mobile_mirror_run_status', arguments: { executionId: accepted.executionId } })
    assert(!result.isError); assert.deepEqual(result.structuredContent.resultProjection, status.resultProjection)
  } finally { await client.close(); await server.close() }
  console.log(JSON.stringify({ candidate: entry, scope: 'packaged-mock', runtimeV2: 'measure-restart-pass', temporal: 'sensitive-observation-rejected', legacyV1: 'pass', health: 'unsupported-before-side-effects', shareV4: 'not-revalidated', httpProjection: 'equal', commandMcpProjection: 'equal', cliSuite: 'v2-clean-exit-0', pageErrors: errors }))
} finally { await browser.close(); await runtime.close(); await rm(root, { recursive: true, force: true }) }
