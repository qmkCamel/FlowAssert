export function createTrendsPanel({ $, t, node, api, onSelectRun }) {
let trends = null, trendBusy = false, trendController = null, trendRevision = 0, trendUpdatedAt = null, trendError = null, trendHydrated = false
let trendComparison = null, trendCompareBusy = false, trendCompareController = null, trendCompareRevision = 0, trendCompareStatus = ''
function renderTrends() {
  $('wb-trend-load').disabled = trendBusy
  $('wb-trend-cancel').hidden = !trendBusy
  $('wb-trend-more').hidden = !trends || trends.nextPage === null
  $('wb-trend-more').disabled = trendBusy
  $('wb-trend-status').textContent = trendBusy ? t('trendLoading') : trendError ?? (trendUpdatedAt ? `${t('trendUpdated')} · ${trendUpdatedAt.toLocaleString()}` : t('trendEmpty'))
  const root = $('wb-trend-results'); root.replaceChildren()
  if (!trends) return
  const scope = node('p', '趋势按计划套件、用例身份和输入分组；目录按执行计数。 / Trends group planned suites, case identity and inputs; the directory counts executions.', 'wb-note'); root.append(scope)
  const range = node('button', '查看此时间范围的运行 / View executions in this time range', 'text-button'); range.type = 'button'; range.onclick = () => { document.dispatchEvent(new CustomEvent('report:range', { detail: { from: trends.coverage.from, to: trends.coverage.to } })) }; root.append(range)
  const coverage = trends.coverage
  root.append(node('p', `${coverage.planned} ${t('trendPlanned')} · ${coverage.attempts} ${t('trendAttempts')} · ${coverage.corruptOrMissing} ${t('trendMissing')}`, 'wb-note'))
  root.append(node('p', `${t('trendFirstPass')}: ${coverage.firstPassRate === null ? '—' : `${(coverage.firstPassRate * 100).toFixed(1)}%`} · ${t('trendCleanPass')}: ${coverage.cleanPassRate === null ? '—' : `${(coverage.cleanPassRate * 100).toFixed(1)}%`}`, 'wb-note'))
  root.append(node('p', `${t('trendExcluded')}: ${coverage.imported} ${t('trendImported')} · ${coverage.derived ?? 0} ${t('trendDerived')} · ${coverage.unplanned} ${t('trendUnplanned')} · ${coverage.corruptSuites} ${t('trendCorruptSuites')} · ${coverage.activeSuites} ${t('trendActiveSuites')}`, 'wb-note'))
  for (const group of trends.groups) {
    const item = node('details'), summary = node('summary', `${group.registeredId} / ${group.caseId} · ${group.planned} ${t('trendPlanned')} · ${group.outcomes['first-pass']} ${t('trendFirstPass')} · ${group.outcomes.flaky} ${t('trendFlaky')}`)
    item.append(summary)
    if (!group.comparable) item.append(node('p', t('trendUnknown'), 'wb-warning'))
    item.append(node('p', `${group.environment} · ${group.inputDigest}`, 'wb-note'))
    item.append(node('p', Object.entries(group.outcomes).map(([key, count]) => `${key}: ${count}`).join(' · '), 'wb-note'))
    for (const entry of group.cases) {
      const line = node('div', `${entry.outcome} · ${entry.durationMs === null ? '—' : `${entry.durationMs} ms`} · ${entry.startedAt} · ${entry.evidenceStatus}`, 'wb-note')
      for (const id of entry.attemptIds) {
        const button = node('button', `run ${id.slice(0, 8)}`, 'text-button'); button.type = 'button'
        button.disabled = entry.evidenceStatus !== 'available'
        button.onclick = () => { document.querySelector('#journey-runs .wb-trends') ? location.hash = `#/runs/${id}` : onSelectRun(id) }
        line.append(button)
      }
      item.append(line)
    }
    root.append(item)
  }
}
function renderTrendComparison() {
  $('wb-trend-compare').disabled = trendCompareBusy
  $('wb-trend-compare-cancel').hidden = !trendCompareBusy
  $('wb-trend-compare-status').textContent = trendCompareBusy ? t('trendCompareLoading') : trendCompareStatus || t('trendCompareEmpty')
  const root = $('wb-trend-compare-results'); root.replaceChildren()
  if (!trendComparison) return
  root.append(node('p', `${t('trendPlanned')}: ${trendComparison.previous.planned} → ${trendComparison.current.planned} · ${t('trendFirstPass')}: ${trendComparison.previous.firstPassRate === null ? '—' : `${(trendComparison.previous.firstPassRate * 100).toFixed(1)}%`} → ${trendComparison.current.firstPassRate === null ? '—' : `${(trendComparison.current.firstPassRate * 100).toFixed(1)}%`}`, 'wb-note'))
  for (const group of trendComparison.groups) {
    const item = node('details'); item.append(node('summary', `${group.registeredId} / ${group.caseId} · ${group.status} · ${group.previousRunIds.length}/${group.currentRunIds.length}`))
    item.append(node('p', `${group.key} · excluded ${group.previousExcluded}/${group.currentExcluded}`, 'wb-note'))
    if (group.signal) item.append(node('p', `${group.signal.previousMedianMs ?? '—'} → ${group.signal.currentMedianMs ?? '—'} ms · Δ ${group.signal.relativeChange === null ? 'unavailable' : `${(group.signal.relativeChange * 100).toFixed(1)}%`} · budget ${group.signal.slowerByMs} ms / ${group.signal.slowerByRatio}`, 'wb-note'))
    for (const runId of [...group.previousRunIds, ...group.currentRunIds].slice(0, 60)) {
      const button = node('button', `run ${runId.slice(0, 8)}`, 'text-button'); button.type = 'button'
      button.onclick = () => document.querySelector('#journey-runs .wb-trends') ? location.hash = `#/runs/${runId}` : onSelectRun(runId)
      item.append(button)
    }
    root.append(item)
  }
}
$('wb-trend-compare').onclick = async () => {
  if (trendCompareBusy) return
  const date = id => { const value = $(id).value; if (!value) throw new Error('Four UTC window dates are required'); return `${value}T00:00:00.000Z` }
  let body
  try {
    const previous = { from: date('wb-trend-previous-from'), to: date('wb-trend-previous-to') }
    const current = { from: date('wb-trend-current-from'), to: date('wb-trend-current-to') }
    const previousBuild = $('wb-trend-previous-build').value.trim(), currentBuild = $('wb-trend-current-build').value.trim()
    if (Boolean(previousBuild) !== Boolean(currentBuild)) throw new Error('Specify both comparison builds or neither')
    const absolute = $('wb-trend-budget-ms').value, relative = $('wb-trend-budget-ratio').value
    if (Boolean(absolute) !== Boolean(relative)) throw new Error('Specify both performance budget thresholds or neither')
    body = { previous, current, ...(previousBuild ? { builds: { previous: previousBuild, current: currentBuild } } : {}), ...(absolute ? { budget: { version: 1, slowerByMs: Number(absolute), slowerByRatio: Number(relative) } } : {}) }
  } catch (error) { trendCompareStatus = error.message; renderTrendComparison(); return }
  const revision = ++trendCompareRevision, controller = new AbortController()
  trendCompareController = controller; trendCompareBusy = true; trendCompareStatus = ''; renderTrendComparison()
  try {
    const result = await api('/api/workbench/trends/compare', body, controller.signal)
    if (revision === trendCompareRevision) { trendComparison = result; trendCompareStatus = t('trendCompareReady') }
  } catch (error) { if (revision === trendCompareRevision && error.name !== 'AbortError') trendCompareStatus = error.message }
  finally { if (revision === trendCompareRevision) { trendCompareBusy = false; trendCompareController = null; renderTrendComparison() } }
}
$('wb-trend-compare-cancel').onclick = () => { trendCompareRevision++; trendCompareController?.abort(); trendCompareController = null; trendCompareBusy = false; trendCompareStatus = t('trendCompareEmpty'); renderTrendComparison() }
$('wb-trend-load').onclick = async () => {
  const revision = ++trendRevision, controller = new AbortController()
  trendController = controller; trendBusy = true; trendError = null; renderTrends()
  try {
    const from = $('wb-trend-from').value ? new Date(`${$('wb-trend-from').value}T00:00:00`).toISOString() : undefined
    const to = $('wb-trend-to').value ? new Date(new Date(`${$('wb-trend-to').value}T00:00:00`).getTime() + 86_400_000).toISOString() : undefined
    const response = await fetch('/api/workbench/trends/rebuild', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(from ? { from } : {}), ...(to ? { to } : {}) }), signal: controller.signal })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
    if (trendRevision !== revision) return
    trends = data; trendUpdatedAt = new Date()
  } catch (error) {
    if (trendRevision === revision && error.name !== 'AbortError') trendError = error.message
  } finally {
    if (trendRevision === revision) { trendBusy = false; trendController = null; renderTrends() }
  }
}
$('wb-trend-cancel').onclick = () => { trendRevision++; trendController?.abort(); trendController = null; trendBusy = false; renderTrends() }
$('wb-trend-more').onclick = async () => {
  if (!trends || trends.nextPage === null || trendBusy) return
  const revision = ++trendRevision, controller = new AbortController(), previous = trends
  trendController = controller; trendBusy = true; trendError = null; renderTrends()
  try {
    const response = await fetch(`/api/workbench/trends?page=${previous.nextPage}&generation=${encodeURIComponent(previous.generation)}&manifestSha256=${encodeURIComponent(previous.manifestSha256)}`, { signal: controller.signal })
    const page = await response.json()
    if (!response.ok) throw new Error(page.error || `HTTP ${response.status}`)
    if (trendRevision !== revision || previous.generation !== page.generation) return
    trends = { ...page, groups: [...previous.groups, ...page.groups] }
  } catch (error) { if (trendRevision === revision && error.name !== 'AbortError') trendError = error.message }
  finally { if (trendRevision === revision) { trendBusy = false; trendController = null; renderTrends() } }
}
function hydrate() {
  if (trendHydrated) return
  trendHydrated = true
  const revision = trendRevision
  void api('/api/workbench/trends').then(page => {
    if (trendRevision !== revision || trendBusy) return
    trends = page; trendUpdatedAt = new Date(page.createdAt); renderTrends()
  }).catch(() => {})
}
return { hydrate, render() { renderTrends(); renderTrendComparison() } }
}
