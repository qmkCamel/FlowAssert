import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = async path => JSON.parse(await readFile(path, 'utf8'))
const names = {
  'VA-01': ['overview-viewport', 'overview-full'],
  'VA-04': ['before-after-viewport', 'before-after-full', 'not-recorded'],
  'VA-05': ['missing-viewport', 'missing-full'],
}
function inside(root, path) {
  const target = resolve(root, path), rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Evidence outside attempt')
  return target
}
/** Deliberately independent of runner verdict/projection functions. */
export async function verifyGate(root) {
  root = resolve(root)
  const manifest = await read(`${root}/manifest.json`), key = await read(`${root}/calibration-key.json`)
  const fixture = await read(`${root}/fixture.json`), reviews = await read(`${root}/review.json`)
  const extended = manifest.kind === 'external-synthetic-eight'
  const sceneNames = extended ? { ...names, 'VA-02':['playing','paused','ended'], 'VA-03':['timeline','failure-paused'], 'VA-06':['loading','latest-selection'], 'VA-07':['narrow-zh','narrow-en'], 'VA-08':['zoom-200','keyboard-focus'] } : names
  const expectedCount = extended ? 36 : 18
  const issues = [], attempts = [], findings = []
  if (manifest.environment.version !== 'agent-browser 0.33.2' || !manifest.commit || !manifest.diffSha256) issues.push('Incomplete source/tool identity')
  if (key.length !== expectedCount || new Set(key.map(row => row.id)).size !== expectedCount) issues.push(`Exactly ${expectedCount} unique attempts required`)
  if ((await read(`${root}/boundary-probe.json`)).status !== 403) issues.push('Write boundary probe failed')
  for (const scenario of Object.keys(sceneNames)) for (const variant of (['VA-01','VA-04','VA-05','VA-07'].includes(scenario) ? ['none', 'fault'] : ['none'])) for (let round = 1; round <= 3; round++) {
    if (key.filter(row => row.scenario === scenario && row.variant === variant && row.round === round).length !== 1) issues.push(`Missing/duplicate calibration cell ${scenario}/${variant}/${round}`)
  }
  for (const row of key) {
    const errors = [], dir = inside(root, row.id), r = await read(`${dir}/result.json`), review = reviews.find(item => item.id === row.id)
    if (r.id !== row.id || r.scenario !== row.scenario || r.round !== row.round) errors.push('Attempt identity mismatch')
    if (r.execution !== 'completed' || r.cleanupError || r.actions > 30 || Date.parse(r.finishedAt) - Date.parse(r.startedAt) > 180000) errors.push('Execution/budget/cleanup incomplete')
    if (!r.requests?.length || r.requests.some(q => q.method !== 'GET')) errors.push('Missing audit or forbidden write')
    const expectedStep = row.scenario === 'VA-01' ? 1 : 3
    const f = r.facts
    const expectedAlt = f?.locale === 'zh-CN' ? `归档步骤 ${expectedStep} 截图` : `Archived step ${expectedStep} screenshot`
    if (names[row.scenario] && (!f || f.origin !== fixture.origin || !f.url.endsWith(`/#/runs/${fixture.id}?step=${expectedStep}&tab=evidence`) || (row.scenario !== 'VA-04' && !f.result.visible) || f.result.alt !== expectedAlt)) errors.push('Page/step identity mismatch')
    if (!names[row.scenario] && (!r.observations?.length || r.observations.some(item => item.value.origin !== fixture.origin || !item.value.url.startsWith(`${fixture.origin}/#/runs/${fixture.id}?step=`)))) errors.push('Extended page/step identity mismatch')
    const required = [...(sceneNames[row.scenario] ?? [])]
    if (row.scenario === 'VA-05' && row.variant === 'none') required.push('recovered-viewport', 'recovered-full')
    for (const name of required) if (!r.evidence.some(e => e.path === `screenshots/${name}.png`)) errors.push(`Missing ${name}`)
    for (const evidence of r.evidence) {
      try {
        const bytes = await readFile(inside(dir, evidence.path))
        if (sha(bytes) !== evidence.sha256 || !bytes.subarray(1, 4).equals(Buffer.from('PNG'))) errors.push(`Invalid raw evidence ${evidence.path}`)
        const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
        if (metadata.format !== 'png' || metadata.width !== (row.scenario === 'VA-07' ? 390 : 1280) || (!evidence.fullPage && metadata.height !== 800)) errors.push(`Unexpected screenshot geometry ${evidence.path}`)
      } catch { errors.push(`Unreadable evidence ${evidence.path}`) }
    }
    if (!review || !['agent', 'human'].includes(review.reviewer?.type) || !review.reviewer?.identity || !Number.isFinite(Date.parse(review.reviewedAt)) || Date.parse(review.reviewedAt) > Date.now() || review.reviewer.type === 'agent' && !review.reviewer.model) errors.push('Actual visual review metadata missing')
    if (review?.status === 'pass' && review.items?.some(item => item.verdict !== 'pass')) errors.push('Review summary contradicts checklist')
    if (!review?.items?.length || !required.every(name => review.items.some(item => item.evidence === `screenshots/${name}.png` && item.observation?.length >= 12 && r.evidence.some(e => e.path === item.evidence && e.sha256 === item.sha256)))) errors.push('Image-linked visual checklist incomplete')
    if (row.variant === 'none') {
      if (review?.status !== 'pass' || !r.checks.length || r.checks.some(check => !check.pass)) errors.push('Normal control not accepted')
      if (row.scenario === 'VA-01' && (!f?.play.visible || !f?.play.inViewport || !f?.play.unobscured)) errors.push('Play entry invalid')
      if (row.scenario === 'VA-04' && (!f?.comparison.marker || Math.abs(f.comparison.marker.x - fixture.expectedMarker.x) >= 0.02 || Math.abs(f.comparison.marker.y - fixture.expectedMarker.y) >= 0.02 || f.comparison.images.length !== 2)) errors.push('Action evidence geometry mismatch')
      if (row.scenario === 'VA-05' && (!f?.comparison.retryVisible || r.recovered?.comparison.retryVisible !== false || r.recovered?.comparison.images.length !== 2)) errors.push('Recovery not demonstrated')
      if (row.scenario === 'VA-07' && r.observations.some(item=>item.value.horizontalOverflow || item.value.viewport.width !== 390)) errors.push('Narrow overflow')
    } else {
      if (review?.status !== 'fail' || !review.items.some(item => item.verdict === 'fail')) errors.push('Fault not visually detected')
      if (r.acceptance === 'pass') errors.push('False pass contradicts visual evidence')
    }
    for (const error of errors) issues.push(`${row.id}: ${error}`)
    const actualAcceptance = r.execution !== 'completed' || !r.evidence.length || !review ? 'incomplete'
      : review.status === 'fail' || r.checks.some(check => !check.pass) ? 'fail' : review.status === 'pass' ? 'pass' : 'incomplete'
    attempts.push({ id: row.id, scenario: row.scenario, variant: row.variant, durationMs: Date.parse(r.finishedAt) - Date.parse(r.startedAt), accepted: errors.length === 0, actualAcceptance, visualReview: review?.status ?? 'needs-review' })
    for (const item of review?.items ?? []) if (item.verdict === 'fail') findings.push({ attempt: row.id, scenario: row.scenario, severity: 'P1', observation: item.observation, evidence: `${row.id}/${item.evidence}`, sha256: item.sha256 })
  }
  const metrics = {
    attempts: attempts.length,
    normalAccepted: attempts.filter(a => a.variant === 'none' && a.accepted && a.actualAcceptance === 'pass').length,
    defectsDetected: attempts.filter(a => a.variant === 'fault' && a.accepted && a.actualAcceptance === 'fail').length,
    falsePositives: attempts.filter(a => a.variant === 'none' && a.actualAcceptance === 'fail').length,
    inconclusive: attempts.filter(a => a.actualAcceptance === 'incomplete').length,
    totalExecutionMs: attempts.reduce((total, a) => total + a.durationMs, 0),
    visualReview: 'Agent/human review required for every raw screenshot; not autonomous pixel regression',
  }
  return { schema: 1, status: issues.length ? 'blocked' : 'pass', checkedAt: new Date().toISOString(), checker: 'independent-file-facts-v1', metrics, attempts, findings, issues, scope: extended ? 'Eight synthetic Web scenarios; not real devices' : 'Stage A only; not product self-hosting or real devices' }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: pnpm test:visual:gate <artifact-directory>')
    const report = await verifyGate(process.argv[2])
    await writeFile(resolve(process.argv[2], 'gate.json'), JSON.stringify(report, null, 2) + '\n')
    await writeFile(resolve(process.argv[2], 'findings.json'), JSON.stringify(report.findings, null, 2) + '\n')
    await writeFile(resolve(process.argv[2], 'acceptance-report.md'), `# 三场景视觉验收\n\n阶段 A 校准门槛：${report.status}。这不是产品自举或像素回归结论。\n\n${report.attempts.map(a => `- ${a.id}：实际验收 ${a.actualAcceptance}，校准符合预期 ${a.accepted}。`).join('\n')}\n\n问题见 findings.json；原始采集状态保留在各 result.json，不倒改首次结果。\n`)
    console.log(JSON.stringify(report, null, 2)); if (report.status !== 'pass') process.exitCode = 1
  } catch (error) { console.error(`Gate blocked: ${error.message}`); process.exitCode = 1 }
}
