export const SCENARIOS = ['VA-01', 'VA-04', 'VA-05']
export function checksFor(scenario, facts, expected) {
  const check = (name, pass, actual) => ({ name, pass: Boolean(pass), actual })
  const step = scenario === 'VA-01' ? 1 : 3
  const alt = facts.locale === 'zh-CN' ? `归档步骤 ${step} 截图` : `Archived step ${step} screenshot`
  // Completed before/after comparison intentionally replaces the redundant result image.
  const base = [check('selected-result', (scenario === 'VA-04' || facts.result.visible) && facts.result.alt === alt, facts.result)]
  if (scenario === 'VA-01') return [...base, check('play-in-first-viewport', facts.play.visible && facts.play.inViewport && facts.play.unobscured, facts.play)]
  if (scenario === 'VA-04') return [...base,
    check('before-after-ready', facts.comparison.images.length === 2 && facts.comparison.images.every(i => i.ready), facts.comparison.images),
    check('recorded-marker-position', facts.comparison.marker && Math.abs(facts.comparison.marker.x - expected.x) < 0.02 && Math.abs(facts.comparison.marker.y - expected.y) < 0.02, { actual: facts.comparison.marker, expected })]
  return [...base, check('recovery-control-visible', facts.comparison.retryVisible, facts.comparison)]
}
export function acceptance(result) {
  if (result.execution === 'blocked') return 'blocked'
  if (result.execution !== 'completed' || !result.evidence?.length || result.checks.length === 0) return 'incomplete'
  if (result.checks.some(check => !check.pass) || result.visualReview?.status === 'fail') return 'fail'
  if (result.visualReview?.status !== 'pass') return 'incomplete'
  return 'pass'
}
