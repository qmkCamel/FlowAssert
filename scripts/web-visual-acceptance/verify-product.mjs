import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import sharp from 'sharp'

// Independent oracle: does not import product projection, checksFor, or scenario execution.
const required = {
  'VA-01':['overview-viewport','overview-full'], 'VA-02':['playing','paused','ended'], 'VA-03':['timeline','failure-paused'],
  'VA-04':['before-after-viewport','before-after-full','not-recorded'], 'VA-05':['missing-viewport','missing-full','recovered-viewport','recovered-full'],
  'VA-06':['loading','latest-selection'], 'VA-07':['narrow-zh','narrow-en'], 'VA-08':['zoom-200','keyboard-focus'],
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export async function inspectProduct(run, read) {
  const problems = [], check = (pass, reason) => { if (!pass) problems.push(reason) }
  check(run.executionKind === 'web' && run.phase === 'finished' && run.cleanup === 'complete' && !run.error, 'execution-not-complete')
  check(Boolean(run.resources.bOrigin && run.resources.targetRunId && run.resources.buildSha256 && run.resources.bPid !== run.resources.aPid), 'target-identity')
  check(run.steps.length === run.input.scenarios.length && run.steps.every((step,i)=>step.kind === run.input.scenarios[i]), 'scenario-coverage')
  const files = [...run.evidence, ...run.steps.flatMap(step=>step.evidence)], bytes = new Map()
  for (const file of files) {
    try {
      check(/^[a-z0-9-]+\.(png|json|txt)$/.test(file.name), 'unsafe-file')
      const data = await read(file); check(data.length === file.bytes && digest(data) === file.sha256, `hash:${file.name}`); bytes.set(file.name, data)
      if (file.contentType === 'image/png') { const m = await sharp(data).metadata(); check(m.format === 'png' && m.width === (file.name.startsWith('va-07-') ? 390 : 1280) && m.height >= 800, `image:${file.name}`) }
    } catch { problems.push(`unavailable:${file.name}`) }
  }
  try { const requests = JSON.parse(bytes.get('web-requests.json').toString()); check(requests.length > 0 && requests.every(r=>r.method === 'GET'), 'unexpected-target-write') } catch { problems.push('request-ledger-missing') }
  for (const step of run.steps) {
    const prefix = step.kind.toLowerCase()
    check(step.execution === 'completed' && step.status === 'passed' && !step.error && step.actions > 0 && step.actions <= 30, `${step.kind}:execution`)
    check(['page.json','facts.json','commands.txt'].every(name=>step.evidence.some(file=>file.name === `${prefix}-${name}`)), `${step.kind}:required-materials`)
    check((required[step.kind] ?? []).every(name=>step.evidence.some(file=>file.name === `${prefix}-${name}.png`)), `${step.kind}:required-images`)
    let facts
    try { facts = JSON.parse(bytes.get(`${prefix}-facts.json`).toString()); check(JSON.stringify(facts) === JSON.stringify(step.facts), `${step.kind}:facts-not-frozen`) }
    catch { problems.push(`${step.kind}:facts-missing`); continue }
    const at = label => facts.find(item=>item.label === label)?.value
    for (const {value} of facts) {
      try { const url = new URL(value.url); check(url.origin === run.resources.bOrigin && url.hash.startsWith(`#/runs/${run.resources.targetRunId}?`), `${step.kind}:url-identity`) } catch { problems.push(`${step.kind}:url`) }
    }
    const initial = at('initial')
    if (step.kind === 'VA-01') check(initial?.result.visible && initial.play.visible && initial.play.inViewport && initial.play.unobscured, 'VA-01:play-hidden')
    if (step.kind === 'VA-02') check(at('paused')?.playback.active === false && at('ended')?.playback.selected === '5' && at('restarted')?.playback.active, 'VA-02:playback')
    if (step.kind === 'VA-03') check(at('slider')?.playback.selected === '5' && at('thumbnail')?.playback.selected === '3' && at('failure')?.playback.selected === '4' && at('failure-paused')?.playback.active === false, 'VA-03:selection')
    if (step.kind === 'VA-04') {
      check(initial?.comparison.images.length === 2 && initial.comparison.images.every(i=>i.ready), 'VA-04:images')
      // Frozen Mock action-card center: x=195 in a 390px viewport, y=285 in 844px.
      check(initial?.comparison.marker && Math.abs(initial.comparison.marker.x - .5) < .02 && Math.abs(initial.comparison.marker.y - 285/844) < .02, 'VA-04:marker')
      check(!at('not-recorded')?.comparison.marker && /was not recorded|未记录本步/.test(at('not-recorded')?.comparison.text), 'VA-04:fabricated')
    }
    if (step.kind === 'VA-05') check(initial?.comparison.retryVisible && at('recovered')?.comparison.images.length === 2 && at('recovered').comparison.images.every(i=>i.ready) && !at('recovered').comparison.retryVisible, 'VA-05:recovery')
    if (step.kind === 'VA-06') check(at('loading')?.playback.loading && at('loading')?.playback.nextEnabled && /3/.test(at('loading')?.result.alt) && at('latest')?.playback.selected === '3' && !at('latest')?.playback.loading, 'VA-06:late-selection')
    if (step.kind === 'VA-07') for (const locale of ['zh-CN','en']) check(at(locale)?.locale === locale && at(locale)?.viewport.width === 390 && !at(locale)?.horizontalOverflow, `VA-07:overflow-${locale}`)
    if (step.kind === 'VA-08') check(at('zoom')?.playback.zoom === '2' && at('zoom')?.playback.selected === '4' && Boolean(at('keyboard')?.playback.focus), 'VA-08:keyboard-css-zoom')
    check(step.checks.length > 0 && step.checks.every(c=>c.pass === true), `${step.kind}:assertion-failed`)
  }
  return { pass: problems.length === 0, problems, imageHashes: files.filter(f=>f.contentType === 'image/png').map(f=>f.sha256).sort() }
}
export async function verifyProduct(directory) {
  const run = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  return verifyProductRecord(run, file => readFile(join(directory, file.name)))
}
export async function verifyProductRecord(run, read) {
  const inspected = await inspectProduct(run, read)
  const review = run.visualReview, reviewed = review.status === 'pass' && Boolean(review.reviewer && review.observations && review.at)
    && JSON.stringify([...review.hashes ?? []].sort()) === JSON.stringify(inspected.imageHashes)
  const reportConsistent = run.verdict !== 'pass' || (inspected.pass && reviewed && run.independentCheck === 'pass')
  return { ...inspected, reviewed, reportConsistent, pass: inspected.pass && reviewed && reportConsistent && run.verdict === 'pass' }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = await verifyProduct(process.argv[2]); console.log(JSON.stringify(result,null,2)); if (!result.pass) process.exitCode = 1
}
