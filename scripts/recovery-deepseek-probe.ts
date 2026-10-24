import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { boundedProposal, planRecovery, type RecoveryObservation, type RecoveryPolicy, type RecoveryUsage } from '../src/workbench-recovery.js'

// Only synthetic images leave this probe. Credentials remain in the environment.
const model = { endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', apiKeyEnv: 'MIRROR_DEEPSEEK_KEY', thinking: 'disabled' as const }
if (!process.env[model.apiKeyEnv]) throw new Error('Set MIRROR_DEEPSEEK_KEY in the process environment')
const root = resolve('artifacts/fixture/recovery-deepseek', new Date().toISOString().replaceAll(':', '-'))
await mkdir(root, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(!existsSync(chromium.executablePath()) ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
const results: unknown[] = []
const policy: RecoveryPolicy = { mode: 'suggest', platform: 'ios', appId: 'synthetic.fixture', intent: 'Open Search using the magnifying glass icon. Abstain if no candidate shows that icon.', modelRef: 'deepseek', navigationOnly: true, allowImageSharing: true, page: { text: 'Recovery Lab' }, allowedTargets: [{ accessibilityId: 'left' }, { accessibilityId: 'right' }] }
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 600 } })
  const search = '<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="26" cy="26" r="17" fill="none" stroke="black" stroke-width="5"/><path d="M39 39L58 58" stroke="black" stroke-width="6"/></svg>'
  const home = '<svg width="64" height="64" viewBox="0 0 64 64"><path d="M5 30L32 7L59 30M13 25V58H51V25M26 58V38H38V58" fill="none" stroke="black" stroke-width="5"/></svg>'
  for (const [name, icons, expected] of [['search-left', [search, home], 'left'], ['search-right', [home, search], 'right'], ['no-search', [home, home], null]] as const) {
    await page.setContent(`<body style="margin:0;background:white;font-family:sans-serif"><h1 style="text-align:center">Recovery Lab</h1><button style="position:absolute;left:40px;top:240px;width:120px;height:120px">${icons[0]}</button><button style="position:absolute;left:240px;top:240px;width:120px;height:120px">${icons[1]}</button></body>`)
    const image = await page.screenshot({ path: join(root, `${name}.png`) })
    // Identical metadata across variants; only image pixels can distinguish targets.
    const input = { id: 'same-observation', sessionId: 'synthetic', sessionGeneration: 1, appId: policy.appId, capturedAt: Date.now(), endedAt: Date.now(), fingerprint: '', image: image.toString('base64'), source: '', geometry: { viewport: { x: 0, y: 0, width: 400, height: 600 } }, candidates: ['left', 'right'].map((nodeId, i) => ({ nodeId, identifier: nodeId, text: '', type: 'button', center: [100 + 200 * i, 300], size: [120, 120] })) } as RecoveryObservation
    const usage: RecoveryUsage[] = [], started = Date.now()
    let result: Record<string, unknown>
    try {
      const proposal = await boundedProposal(planRecovery, input, policy, model, AbortSignal.timeout(10000), value => usage.push(value))
      result = { name, expected, proposal, passed: expected === null ? proposal.decision === 'abstain' : proposal.decision === 'propose' && proposal.action.nodeId === expected }
    } catch (error) {
      result = { name, expected, passed: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
    Object.assign(result, { elapsedMs: Date.now() - started, usage, imageSha256: createHash('sha256').update(image).digest('hex') })
    results.push(result)
    await writeFile(join(root, 'report.json'), JSON.stringify({ model, realModel: true, physicalDevice: false, deviceWrites: 0, results }, null, 2))
    console.log(JSON.stringify(result))
  }
  console.log(JSON.stringify({ root, realModel: true, physicalDevice: false }))
  if (results.some(result => !(result as { passed: boolean }).passed)) process.exitCode = 1
} finally { await browser.close() }
