import { checksFor } from './results.mjs'

export const ALL_SCENARIOS = ['VA-01','VA-02','VA-03','VA-04','VA-05','VA-06','VA-07','VA-08']
export const REQUIRED_IMAGES = {
  'VA-01': ['overview-viewport','overview-full'], 'VA-02': ['playing','paused','ended'], 'VA-03': ['timeline','failure-paused'],
  'VA-04': ['before-after-viewport','before-after-full','not-recorded'], 'VA-05': ['missing-viewport','missing-full'],
  'VA-06': ['loading','latest-selection'], 'VA-07': ['narrow-zh','narrow-en'], 'VA-08': ['zoom-200','keyboard-focus'],
}
/** Same finite scenario implementation for external collection and product execution. */
export async function runScenario(browser, fixture, scenario, checkpoint = async () => {}) {
  if (!ALL_SCENARIOS.includes(scenario)) throw new Error('Unregistered Web scenario')
  const evidence = [], checks = [], facts = []
  const observe = async label => { const value = await browser.facts(); facts.push({ label, value }); return value }
  const check = (name, pass, actual) => checks.push({ name, pass: Boolean(pass), actual })
  const capture = async (name, full = false) => { evidence.push(await browser.capture(name, full)); await checkpoint({ evidence, checks, facts }) }
  const step = ['VA-04','VA-05','VA-06','VA-08'].includes(scenario) ? 3 : 1
  await browser.open(`${fixture.origin}/#/runs/${fixture.id}?step=${step}&tab=evidence`)
  const snapshot = await browser.snapshot()
  if (['VA-01','VA-04','VA-05'].includes(scenario)) {
    if (scenario !== 'VA-01') { await browser.click('comparison'); await browser.wait(scenario === 'VA-05' ? 'error' : 'comparison') }
    const value = await observe('initial'); checks.push(...checksFor(scenario, value, fixture.expectedMarker))
    const names = REQUIRED_IMAGES[scenario]; await capture(names[0]); await capture(names[1], true)
    if (scenario === 'VA-04') {
      await browser.click('previous'); await browser.wait('result'); await browser.click('comparison')
      const value = await observe('not-recorded')
      check('no-fabricated-old-marker', !value.comparison.marker && /未记录本步动作前截图或位置|was not recorded/.test(value.comparison.text), value.comparison)
      await capture('not-recorded', true)
    }
    if (scenario === 'VA-05' && value.comparison.retryVisible) {
      await fixture.restoreEvidence(); await browser.click('retry'); await browser.wait('comparison')
      const recovered = await observe('recovered')
      check('recovery', !recovered.comparison.retryVisible && recovered.comparison.images.length === 2 && recovered.comparison.images.every(i=>i.ready), recovered.comparison)
      await capture('recovered-viewport'); await capture('recovered-full', true)
    }
  } else if (scenario === 'VA-02') {
    await browser.select('speed', '0.5'); await browser.click('play'); await browser.wait('playing'); await capture('playing')
    await browser.click('play'); const paused = await observe('paused'); check('paused', !paused.playback.active, paused.playback); await capture('paused')
    await browser.key('seek', 'End'); await browser.wait('result'); await browser.select('speed', '2'); await browser.click('play'); await browser.wait('ended'); await capture('ended')
    const ended = await observe('ended'); check('ended-at-last', ended.playback.selected === '5' && !ended.playback.active, ended.playback)
    await browser.click('play'); await browser.wait('playing'); const restarted = await observe('restarted'); check('restart', restarted.playback.active, restarted.playback)
  } else if (scenario === 'VA-03') {
    await browser.key('seek', 'End'); await browser.wait('result'); check('slider-last', (await observe('slider')).playback.selected === '5')
    await browser.click('filmstrip'); await browser.wait('thumbnails'); await browser.click('thumbnail'); await browser.wait('result'); await capture('timeline', true)
    check('thumbnail-selection', (await observe('thumbnail')).playback.selected === '3')
    await browser.click('failure'); await browser.wait('result'); check('failure-selection', (await observe('failure')).playback.selected === '4')
    await browser.key('seek', 'Home'); await browser.click('play'); await browser.wait('failure'); await capture('failure-paused')
    check('paused-on-failure', !(await observe('failure-paused')).playback.active)
  } else if (scenario === 'VA-06') {
    await fixture.holdSlow(); await browser.click('previous'); await browser.wait('loading'); await capture('loading')
    const loading = await observe('loading'); check('local-loading', loading.playback.loading && loading.playback.nextEnabled && /3/.test(loading.result.alt), loading)
    await browser.click('next'); await fixture.releaseSlow(); await browser.wait('result'); await capture('latest-selection')
    const latest = await observe('latest'); check('latest-selection', latest.playback.selected === '3' && /3/.test(latest.result.alt) && !latest.playback.loading, latest)
  } else if (scenario === 'VA-07') {
    await browser.viewport(true)
    for (const locale of ['zh-CN','en']) { await browser.select('locale', locale); await browser.wait('result'); await capture(locale === 'en' ? 'narrow-en' : 'narrow-zh', true)
      const value = await observe(locale); check(`no-overflow-${locale}`, !value.horizontalOverflow && value.viewport.width === 390 && value.locale === locale, value) }
  } else {
    await browser.cssZoom200(); await browser.key('step', 'ArrowDown'); await browser.wait('result'); await capture('zoom-200', true)
    const value = await observe('zoom'); check('css-zoom-keyboard-step', value.playback.zoom === '2' && value.playback.selected === '4', value)
    await browser.key('play', 'Tab'); await capture('keyboard-focus', true)
    check('keyboard-control-reachable', Boolean((await observe('keyboard')).playback.focus))
  }
  return { evidence, checks, facts, snapshot }
}
