import { api, node, button, field, copy } from './journey-common.js'
import { reportLabel } from '/report-presentation.js'

const locale = () => document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'
const text = value => reportLabel(value, locale())
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale(), { hour12: false }) : text('unknown')
const duration = value => value === null ? '—' : `${(value / 1000).toFixed(1)} s`

export function createReportCatalog(root, { navigate, trends }) {
  let needsReload = false, epoch = 0, controller, last = null, view = 'all', scroll = 0, focusId = null, active = false, timer, notice = null
  const title = node('h1', copy('运行记录', 'Run history')), navigation = node('nav', undefined, 'report-tabs')
  const controls = node('div', undefined, 'report-filters'), counts = node('div', undefined, 'report-counts'), status = node('p'), list = node('div'), pagination = node('div', undefined, 'report-pagination')
  status.id = 'report-status'; status.setAttribute('role', 'status'); list.id = 'report-list'; navigation.setAttribute('aria-label', copy('报告视图', 'Report views'))
  root.append(title, navigation, controls, counts, status, list, pagination)
  const navButtons = []
  for (const [key, zh, en] of [['all', '全部运行', 'All runs'], ['case', '用例历史', 'Case history'], ['trends', '趋势', 'Trends']]) {
    const tab = button(zh, en, () => { view = key; updateView(); if (key !== 'trends') void load() }); tab.dataset.view = key; navigation.append(tab); navButtons.push(tab)
  }
  const values = {}
  function input(key, zh, en, id, type = 'text') {
    const group = node('div'); controls.append(group); const value = field(group, zh, en, id); value.type = type; values[key] = value
    value.addEventListener('input', schedule); return value
  }
  function select(key, zh, en, entries) {
    const value = input(key, zh, en, `report-${key}`); const replacement = node('select'); replacement.id = value.id; value.replaceWith(replacement); values[key] = replacement
    for (const [key, zh, en] of entries) { const option = node('option', copy(zh, en)); option.value = key; replacement.append(option) }
    replacement.onchange = schedule
  }
  input('query', '名称 / 设备 / 用例 ID', 'Name / device / case ID', 'journey-run-filter')
  select('result', '结果', 'Result', [['all', '全部', 'All'], ...['pass', 'fail', 'recovered', 'inconclusive', 'cancelled', 'interrupted', 'running', 'evidence-conflict', 'evidence-contaminated'].map(key => [key, reportLabel(key, 'zh-CN'), reportLabel(key, 'en')])])
  select('platform', '平台', 'Platform', [['all', '全部', 'All'], ['android', 'Android', 'Android'], ['ios', 'iPhone', 'iPhone'], ['web', 'Web', 'Web'], ['unknown', '未知', 'Unknown']])
  select('source', '来源', 'Source', [['all', '全部', 'All'], ['viewer', '本机', 'Local'], ['agent', 'Agent', 'Agent'], ['import', '导入', 'Imported'], ['derived', '派生副本', 'Derived'], ['mock', 'Mock', 'Mock']])
  input('from', '开始日期（本地）', 'From date (local)', 'report-from', 'date'); input('to', '截至日期（包含当天）', 'Through date (inclusive)', 'report-to', 'date')
  const caseInput = input('caseId', '用例 ID（可从用例库打开历史）', 'Case ID (or open history from the case library)', 'report-case'); const caseOptions = node('datalist'); caseOptions.id = 'report-case-options'; caseInput.setAttribute('list', caseOptions.id); root.append(caseOptions);
  const advancedFilters = node('details'); advancedFilters.append(node('summary', copy('套件用例筛选', 'Suite-case filter'))); const suiteGroup = node('div'); advancedFilters.append(suiteGroup); controls.append(advancedFilters); const suiteInput = field(suiteGroup, '登记的套件用例 ID', 'Recorded suite case ID', 'report-suite-case'); values.suiteCaseId = suiteInput; suiteInput.oninput = schedule; input('build', '构建', 'Build', 'report-build')
  const refresh = button('刷新历史', 'Refresh history', () => void load(), 'journey-run-refresh'), clear = button('清空筛选', 'Clear filters', () => { for (const [key, value] of Object.entries(values)) value.value = ['result', 'platform', 'source'].includes(key) ? 'all' : ''; view = 'all'; updateView(); void load() })
  controls.append(refresh, clear)
  const previous = button('上一页', 'Previous page', () => { if (last) void load(last.previousCursor, last.previousStack.slice(0, -1)) }), more = button('下一页', 'Next page', () => { if (last) void load(last.result.nextCursor, [...last.previousStack, last.cursor]) }, 'journey-run-more')
  pagination.append(previous, more)
  function schedule() { clearTimeout(timer); timer = setTimeout(() => void load(), 250) }
  function query(cursor) {
    const result = {}; for (const [key, input] of Object.entries(values)) if (input.value) result[key] = input.value.trim()
    for (const key of ['from', 'to']) if (result[key]) { const value = new Date(`${result[key]}T00:00:00`); if (key === 'to') value.setDate(value.getDate() + 1); result[key] = value.toISOString() }
    if (cursor) result.cursor = cursor
    return result
  }
  function updateView() {
    for (const tab of navButtons) tab.setAttribute('aria-pressed', String(tab.dataset.view === view))
    const trendView = view === 'trends'; controls.hidden = counts.hidden = status.hidden = list.hidden = pagination.hidden = trendView
    if (trends) { if (trendView && active) root.append(trends); trends.hidden = !trendView }
  }
  async function load(cursor = null, previousStack = []) {
    const token = ++epoch; controller?.abort(); controller = new AbortController(); refresh.disabled = true; more.disabled = previous.disabled = true
    notice = { kind: 'loading' }; renderStatus()
    try {
      const selection = query(cursor)
      if (view === 'case' && !selection.caseId && !selection.suiteCaseId) throw new Error(copy('请填写明确的用例 ID；同名不自动关联。', 'Enter a recorded case ID; names do not imply identity.'))
      needsReload = false
      const result = await api(`/api/workbench/reports?${new URLSearchParams(selection)}`, undefined, controller.signal)
      if (token !== epoch) return
      notice = null
      last = { result, cursor, previousStack, previousCursor: previousStack.at(-1) ?? null, updatedAt: new Date().toISOString() }
      render()
    } catch (failure) { if (token === epoch && !controller.signal.aborted) { notice = { kind: failure.message.includes('report-refresh-required') ? 'stale' : 'error', reason: failure.message }; renderStatus() } }
    finally { if (token === epoch) { refresh.disabled = false; more.disabled = !last?.result.nextCursor; previous.disabled = !last?.previousStack.length } }
  }
  function renderStatus() {
    if (notice?.kind === 'loading') status.textContent = copy('正在读取报告…上一页保留，可切换页面', 'Reading reports… previous page retained; navigation remains available')
    else if (notice?.kind === 'stale') status.textContent = copy('记录或筛选已变化，保留上一页；请点击刷新历史从第一页重新读取。', 'Records or filters changed; previous page retained. Refresh history to start a new generation.')
    else if (notice?.kind === 'error') status.textContent = copy(`读取失败，保留上一查询结果：${notice.reason}`, `Read failed; previous page retained from prior inputs: ${notice.reason}`)
    else if (last) { const { result, updatedAt } = last
    status.textContent = copy(`共 ${result.total} 次运行，本页 ${result.items.length} 条 · 更新于 ${date(updatedAt)}${result.coverage.unreadable ? ` · ${result.coverage.unreadable} 条记录不可读，统计不完整` : ''}`, `${result.total} executions, ${result.items.length} on this page · Updated ${date(updatedAt)}${result.coverage.unreadable ? ` · ${result.coverage.unreadable} unreadable records; incomplete statistics` : ''}`)
    }
    if (notice && last) status.textContent += copy(` · 上次成功读取：${date(last.updatedAt)}`, ` · Last successful read: ${date(last.updatedAt)}`)
  }
  function render() {
    const { result } = last
    counts.replaceChildren(); for (const [key, count] of Object.entries(result.counts)) counts.append(node('span', `${text(key)} ${count}`, `report-count report-${key}`))
    renderStatus()
    list.replaceChildren()
    const identities = new Map(result.items.filter(run => run.caseId).map(run => [run.caseId, run.name])); for (const [id, name] of identities) if (![...caseOptions.options].some(option => option.value === id)) { const option = node('option'); option.value = id; option.label = name; caseOptions.append(option) }
    const table = node('table', undefined, 'report-table'), head = node('thead'), row = node('tr'), body = node('tbody')
    for (const [zh, en] of [['结果', 'Result'], ['用例 / 运行', 'Case / run'], ['首个失败', 'First failure'], ['平台 / 设备', 'Platform / device'], ['构建', 'Build'], ['开始 / 耗时', 'Start / duration']]) { const th = node('th', copy(zh, en)); th.scope = 'col'; row.append(th) }
    head.append(row); table.append(head, body)
    for (const run of result.items) {
      const tr = node('tr'); tr.dataset.runId = run.id
      const cells = [text(run.status), null, run.firstFailure ? `${run.firstFailure.index}. ${run.firstFailure.observation}` : run.runChecks.length ? copy('运行级检查未通过', 'Run-level checks incomplete') : '—', run.platform==='web'?`Web · ${run.browserName}`:`${run.platform === 'unknown' ? text('unknown') : run.platform} · ${run.deviceName === 'unknown' ? text('unknown') : run.deviceName}`, run.build === 'unknown' ? text('unknown') : run.build, `${date(run.startedAt)} · ${duration(run.durationMs)}`]
      for (const [index, value] of cells.entries()) {
        const td = node('td', value ?? undefined); td.dataset.label = row.children[index].textContent
        if (index === 0) td.className = `report-verdict report-${run.status}`
        if (index === 1) {
          const link = node('a', run.unreadable ? copy('中断 / 记录不可读', 'Interrupted / unreadable record') : run.name, 'journey-run'); link.id = `report-run-${run.id}`; link.href = `#/runs/${run.id}`
          link.onclick = () => { scroll = window.scrollY; focusId = link.id }
          const details = node('details'); details.append(node('summary', copy('记录身份与范围', 'Identity and scope')), node('p', `${copy('来源', 'Source')}: ${run.provider === 'mock' ? text('mock') : text(run.source)}`), node('p', `${copy('修订 / 输入 / 构建', 'Revision / input / build')}: ${run.revisionId ?? '—'} / ${run.inputDigest ?? 'unknown'} / ${run.build}`), node('p', `${run.id} · ${run.caseId ?? run.suiteCaseId ?? '—'} · ${copy('重试序号', 'Attempt')}: ${run.attempt ?? copy('未登记', 'Not recorded')}`), node('p', text(run.evidenceAvailability)))
          td.append(link, details)
          if (run.currentVerdict && run.currentVerdict !== run.recordedVerdict) td.append(node('p', copy(`当前投影：${text(run.currentVerdict)}`, `Current projection: ${text(run.currentVerdict)}`), 'wb-warning'))
        }
        tr.append(td)
      }
      body.append(tr)
    }
    list.append(table); if (!result.items.length) list.append(node('p', copy('没有匹配的报告；调整筛选或执行用例。', 'No matching reports; adjust filters or execute a case.')))
  }
  document.addEventListener('report:range', event => {
    const scope = event.detail
    const refuse = reason => { epoch++; controller?.abort(); refresh.disabled = false; more.disabled = !last?.result.nextCursor; previous.disabled = !last?.previousStack.length; status.hidden = false; notice = { kind: 'error', reason }; renderStatus() }
    const localMidnight = value => { const at = new Date(value); return Number.isFinite(at.getTime()) && at.getHours() === 0 && at.getMinutes() === 0 && at.getSeconds() === 0 && at.getMilliseconds() === 0 }
    if (!scope.from || !scope.to) { refuse(copy('此趋势未登记明确时间边界，无法准确跳转目录。', 'This trend has no recorded time boundaries; an exact directory jump is unavailable.')); return }
    if (!localMidnight(scope.from) || !localMidnight(scope.to)) { refuse(copy('此趋势包含具体时刻，日期筛选不能准确表示该范围；请保留趋势视图。', 'This trend has time-of-day boundaries and cannot be represented by date filters; retain the trend view.')); return }
    view = 'all'
    for (const [key, input] of Object.entries(values)) input.value = ['result', 'platform', 'source'].includes(key) ? 'all' : ''
    for (const key of ['from', 'to']) values[key].value = new Date(key === 'to' ? Date.parse(scope[key]) - 1 : scope[key]).toLocaleDateString('sv-SE')
    updateView(); void load()
  })

  document.addEventListener('report:case', event => { for (const [key, input] of Object.entries(values)) input.value = ['result', 'platform', 'source'].includes(key) ? 'all' : ''; values.caseId.value = event.detail.caseId; view = 'case'; needsReload = true; updateView() })
  new MutationObserver(() => { if (active && last) render() }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  return {
    activate() { active = true; updateView(); if (last) { render(); more.disabled = !last.result.nextCursor; previous.disabled = !last.previousStack.length; window.scrollTo(0, scroll); if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true }); if (needsReload) void load() } else if (view !== 'trends') { title.tabIndex = -1; title.focus({ preventScroll: true }); void load() } },
    deactivate() { if (notice?.kind === 'loading') { notice = null; needsReload = true }; active = false; clearTimeout(timer); epoch++; controller?.abort(); refresh.disabled = false },
    refresh() { if (active && view !== 'trends') void load() },
  }
}
