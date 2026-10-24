import { api, node, button, copy, field, choose } from './journey-common.js'
import { workbenchText as t } from './workbench.js'
import { renderProvenance, renderResultDimensions } from './workbench-results.js'
import { createComparisonPanel } from './workbench-comparisons.js'
import { createTriagePanel } from './workbench-triage.js'
import { createSharePanel } from './workbench-share.js'
import { reportDetail, reportStepTitle, reportStepObservation, reportLabel } from '/report-presentation.js'
import { createRepairPanel } from './workbench-repair.js'
import { createScreenshotPlayback } from './screenshot-playback.js'
import { stepCaption, stepDuration, resultImage, createStepTimeline, createActionComparison } from './report-workbench.js'
import { renderWebReport } from './journey-web.js'

export function createAnalysis(root, navigate, edit, replaceSelection) {
  let current = null, route = null, epoch = 0, readingToken = null, abort = null, history = [], objectUrl = null
  let evidenceEpoch = 0, renderedLocale = null
  let actionComparison
  const investigations = new Map(), searchByRun = new Map()
  const heading = node('section'), tabs = node('nav'), body = node('div', undefined, 'analysis-grid'), steps = node('section'), evidence = node('section'), context = node('section'), secondary = node('section'), error = node('p', '', 'wb-error')
  heading.id = 'analysis-summary'; steps.id = 'analysis-steps'; evidence.id = 'analysis-evidence'; context.id = 'analysis-context'; secondary.id = 'analysis-secondary'; error.setAttribute('role', 'alert')
  const reading = node('p'); reading.id = 'analysis-read-progress'; reading.setAttribute('role', 'status'); reading.hidden = true
  const stage = node('section', undefined, 'replay-stage'), contextDrawer = node('details', undefined, 'replay-context')
  contextDrawer.append(node('summary', copy('步骤详情', 'Step details')), context)
  root.append(reading, heading, tabs, error, body, secondary); body.append(steps, stage, contextDrawer); stage.append(evidence)
  const webRoot=node('section');webRoot.id='web-run-report';webRoot.hidden=true;root.append(webRoot)
  const controls = node('section', undefined, 'screenshot-playback'), playbackStatus = node('p'), position = node('span'), speed = node('select')
  controls.id = 'screenshot-playback'; controls.hidden = true; playbackStatus.id = 'playback-status'; playbackStatus.setAttribute('role', 'status')
  const manual = direction => { const state = playback.state(), step = current?.steps[state.position + direction]; if (step) { playback.pause(); navigate(`#/runs/${current.id}?step=${step.index}&tab=evidence`) } }
  const previous = button('上一步', 'Previous step', () => manual(-1), 'playback-previous')
  const nextStep = button('下一步', 'Next step', () => manual(1), 'playback-next')
  const toggle = button('播放', 'Play', () => {
    if (playback.state().active) { playback.pause(); return }
    const search = steps.querySelector('input'); if (search) { search.value = ''; searchByRun.set(current.id, ''); for (const item of steps.querySelectorAll('button[data-step]')) item.hidden = false }
    for (const video of evidence.querySelectorAll('video')) video.pause()
    playback.play()
  }, 'playback-toggle')
  speed.id = 'playback-speed'; speed.setAttribute('aria-label', copy('回放速度', 'Playback speed'))
  for (const value of [.5, 1, 2]) { const option = node('option', `${value}×`); option.value = value; speed.append(option) }
  speed.value = '1'; speed.onchange = () => playback.speed(Number(speed.value))
  const retry = button('重试截图', 'Retry screenshot', () => void playback.retry(), 'playback-retry'), toolbar = node('div', undefined, 'playback-toolbar')
  toolbar.append(previous, toggle, nextStep, speed, position, retry)
  const timeline = createStepTimeline({ select: index => { playback.pause(); navigate(`#/runs/${current.id}?step=${index}&tab=evidence`) }, pause: () => playback.pause(), link: (run, file) => `/api/runs/${run.id}/artifacts/${encodeURIComponent(file.name)}` })
  controls.append(toolbar, playbackStatus, timeline.root, node('small', copy('截图序列回放 · 按阅读节奏播放，非原始执行时间；不会操作手机。', 'Screenshot sequence playback · Reading pace, not original execution timing; no device actions.'))); stage.append(controls)
  stage.prepend(toolbar)
  const playback = createScreenshotPlayback({ load: selectEvidence, change: state => {
    controls.hidden = !current || route?.tab !== 'evidence'
    toolbar.hidden = controls.hidden
    timeline.update(state.position)
    toggle.textContent = state.active ? copy('暂停', 'Pause') : state.reason === 'ended' ? copy('从头播放', 'Play from start') : state.reason === 'failure' ? copy('继续', 'Continue') : copy('播放', 'Play')
    toggle.disabled = !state.enabled || state.position < 0 || state.reason === 'unavailable'; toggle.setAttribute('aria-pressed', String(state.active))
    previous.disabled = state.position <= 0; nextStep.disabled = state.position < 0 || state.position >= state.total - 1
    position.textContent = copy(`第 ${state.position + 1} 步，共 ${state.total} 步`, `Step ${state.position + 1} of ${state.total}`); speed.value = String(state.speed)
    retry.hidden = state.reason !== 'unavailable' && !(state.reason === 'paused' && !state.ready && !state.loading); retry.disabled = state.position < 0
    const messages = { paused: ['已暂停', 'Paused'], playing: ['正在回放', 'Playing'], failure: ['已在失败步骤暂停', 'Paused at failed step'], unavailable: ['截图不可用，已暂停；可重试或手动切换步骤。', 'Screenshot unavailable; paused. Retry or select another step.'], ended: ['回放结束', 'Playback ended'] }
    playbackStatus.textContent = !state.enabled ? current?.phase !== 'finished' ? copy('运行结束后可回放', 'Playback available after the run finishes') : state.total < 2 ? copy('没有后续步骤，仅可静态浏览', 'No subsequent steps; static view only') : copy('没有已登记的完整截图', 'No complete screenshots registered') : state.loading ? copy('正在读取截图…可暂停或切换步骤', 'Loading screenshot… pause or switch steps remains available') : copy(...messages[state.reason])
  } })
  document.addEventListener('visibilitychange', () => { if (document.hidden) playback.pause() })
  const rerender = () => { if (current && route?.id === current.id) renderSecondary() }
  const comparison = createComparisonPanel({ t, node, api, selectedRunId: () => route?.id, history: () => history, currentRun: () => current, rerender, showError: message => { error.textContent = message ?? '' }, requireExplicitBaseline: true })
  const triage = createTriagePanel({ api, rerender, currentRunId: () => current?.id, currentComparison: () => comparison.current() })
  const share = createSharePanel({ node, t, api, currentRunId: () => current?.id, rerender, defaultFormat: 'html' })
  const repair = createRepairPanel({ t, node, api, currentRun: () => current, rerender, onDraft: (run, confirmed) => edit(confirmed.yaml, run.params ?? {}, { sourceRun: run, confirmed }) })
  const link = (run, file) => `/api/runs/${run.id}/artifacts/${encodeURIComponent(file.name)}`
  function renderSecondary() {
    secondary.replaceChildren()
    if (route.tab === 'compare') { const triageLink = node('a', copy('查看分诊建议与人工复核', 'View triage suggestions and human review')); triageLink.href = `#/runs/${current.id}?tab=triage`; secondary.append(node('p', copy('差异是归档事实；分诊提供检查方向；子运行记录复验结果。三者不会自动证明根因。', 'Differences are recorded facts, triage proposes checks, and child runs record follow-up outcomes. None automatically establishes a root cause.')), triageLink); comparison.render(secondary, current); renderInvestigation(secondary, current); repair.render(secondary, current) }
    if (route.tab === 'triage') triage.render(secondary, current)
    if (route.tab === 'share') { secondary.append(node('p', copy('此地址只定位当前本机记录，不是公共分享链接。派生包需单独审查。', 'This address locates a local record, not a public report. Review a derived export separately.'))); share(secondary, current) }
  }
  function renderInvestigation(root, run) {
    const state = investigations.get(run.id) ?? { busy: false, report: null, error: '', child: '' }; investigations.set(run.id, state)
    const section = node('section'); section.append(node('h3', copy('检查计划与子运行复验', 'Investigation plan and child follow-up')), node('p', copy('仅提出检查方向；不会改变原结果或自动执行。复验通过不是根因证明。', 'Proposed checks only: no outcome changes or automatic execution. A passing follow-up is not causal proof.')))
    const child = field(section, '子运行 ID（可选，必须关联原运行）', 'Child run ID (optional; must reference original)', 'analysis-followup', state.child); child.oninput = () => { state.child = child.value }
    const inspect = button('读取检查计划 / 复验对照', 'Read plan / follow-up comparison', async () => {
      if (state.busy) return
      state.busy = true; state.error = ''; state.controller = new AbortController(); rerender()
      const requested = state.child
      try { const result = await api(`/api/workbench/investigation?runId=${run.id}${requested ? `&followup=${encodeURIComponent(requested)}` : ''}`, undefined, state.controller.signal); if (!state.controller.signal.aborted) state.report = result }
      catch (failure) { if (!state.controller.signal.aborted) state.error = failure.message }
      finally { state.busy = false; rerender() }
    }); inspect.disabled = state.busy || run.phase !== 'finished'; section.append(inspect)
    if (state.busy) { const progress = node('p', copy('正在复核证据…旧计划保留，可切换页面', 'Rechecking evidence… prior plan retained; navigation remains available')); progress.setAttribute('role', 'status'); section.append(progress, button('取消读取', 'Cancel read', () => { state.controller.abort(); state.error = copy('已取消，旧计划保留', 'Cancelled; previous plan retained'); rerender() })) }
    if (state.error) section.append(node('p', state.error, 'wb-error'))
    if (state.report) {
      const labels = { 'restore-evidence': ['恢复/检查证据', 'Restore/check evidence'], 'check-environment': ['检查设备环境', 'Check environment'], 'confirm-page': ['确认页面状态', 'Confirm page'], 'inspect-locator': ['检查定位条件', 'Inspect locator'], 'check-readiness': ['检查控件就绪状态', 'Check element readiness'], 'verify-business': ['独立验证业务条件', 'Verify business'], 'review-cleanup': ['审查清理状态', 'Review cleanup'], 'review-expectation': ['审查预期而非弱化断言', 'Review expectation without weakening it'], reproduce: ['按原快照复现并留证', 'Reproduce the original snapshot'] }
      for (const check of state.report.plan.checks) section.append(node('p', copy(...(labels[check.id] ?? [check.id, check.id]))))
      const details = node('details'); details.append(node('summary', copy('计划事实和适用限制', 'Plan facts and limitations')), node('pre', JSON.stringify(state.report, null, 2))); section.append(details)
      if (state.report.followup) section.append(node('p', copy(`原结果：${state.report.plan.projection.reportedVerdict}；复验：${state.report.followup.projection.reportedVerdict}。YAML 修改：${state.report.followup.yamlChanged}；参数修改：${state.report.followup.paramsChanged}。`, `Original: ${state.report.plan.projection.reportedVerdict}; follow-up: ${state.report.followup.projection.reportedVerdict}. YAML changed: ${state.report.followup.yamlChanged}; parameters changed: ${state.report.followup.paramsChanged}.`)))
    }
    root.append(section)
  }
  async function show(next) {
    const focusedStep = document.activeElement?.closest?.('#analysis-steps button[data-step]')?.dataset.step
    // Finished-run step navigation shares the frozen manifest and stable controls.
    // Refetching/rebuilding here can reset a keyboard seek while the prior image decodes.
    if (current?.executionKind !== 'web' && readingToken === null && renderedLocale === document.documentElement.lang && current?.phase === 'finished' && current.id === next.id && route?.tab === 'evidence' && next.tab === 'evidence' && next.step !== route.step && current.steps.some(step => step.index === next.step)) {
      route = next; playback.pause(); await playback.select(next.step)
      return
    }
    playback.pause(); timeline.clear(); actionComparison?.clear(); evidenceEpoch++
    controls.hidden = true; toggle.disabled = true
    route = next; const token = ++epoch; readingToken = token; abort?.abort(); abort = new AbortController(); const signal = abort.signal
    reading.textContent = copy('正在读取运行…已有结果保留，可使用其他控件', 'Loading run… prior result retained; other controls remain available'); reading.hidden = false
    const sameRun = current?.id === next.id
    if (!sameRun) { heading.replaceChildren(node('p', copy('正在读取运行…', 'Loading run…'))); steps.replaceChildren(); evidence.replaceChildren(); context.replaceChildren(); secondary.replaceChildren(); current = null }
    error.textContent = ''
    try {
      const run = await api(`/api/runs/${next.id}`, undefined, signal)
      if (token !== epoch) return
      current = run
      const web=run.executionKind==='web';webRoot.hidden=!web;body.hidden=tabs.hidden=secondary.hidden=web
      if(web){toolbar.hidden=true;heading.replaceChildren(node('h1',run.name));renderWebReport(webRoot,run,navigate,()=>void show(route));return}
      const presentation = reportDetail(run), locale = document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'
      timeline.configure(run, presentation.failures)
      const selection = next.step ?? presentation.failures[0]?.index ?? run.steps[0]?.index
      const selected = run.steps.find(step => step.index === selection)
      if (next.step !== null && !selected) { error.textContent = copy('该步骤不存在；请从步骤列表选择。', 'Step not found; select a recorded step.'); evidence.replaceChildren(); context.replaceChildren() }
      heading.replaceChildren(node('h1', run.name), node('p', `${run.share ? copy('派生副本当前结果', 'Derived copy current verdict') : copy('原记录结果', 'Recorded verdict')}: ${t(run.resultProjection?.reportedVerdict ?? run.verdict ?? run.phase)}`))
      if (run.share) heading.append(node('p', `${copy('派生来源的原报告结果（未重新验证）', 'Source report verdict (not revalidated)')}: ${t(run.share.reportedVerdict)}`))
      heading.append(node('p', `${copy('当前证据', 'Current evidence')}: ${evidenceLabel(run.resultProjection?.evidenceAvailability)}`), node('p', `${run.platform} · ${run.deviceName} · ${new Date(run.startedAt).toLocaleString()} · ${run.comparison?.appContext.build ?? copy('构建未知', 'Unknown build')}`))
      if (presentation.projection.readState === 'unsupported') heading.append(node('p', copy('此结果契约不受支持；不能据此判定通过。', 'Unsupported result contract; a passing outcome cannot be inferred.'), 'wb-warning'))
      const failed = presentation.failures[0]
      heading.append(node('p', failed ? `${copy('首个有记录的失败', 'Earliest recorded failure')}: ${reportStepTitle(failed, locale)} · ${reportStepObservation(failed)}` : copy('未记录步骤失败；这不证明未声明的业务条件。', 'No step failure recorded; undeclared business conditions are not proven.')))
      const explanation = node('details'); explanation.append(node('summary', copy('结果如何判定', 'How this result is interpreted')), node('p', copy('以下是归档事实，不是自动根因。无可比基线时不能判定产品或定位器缺陷。', 'These are archived facts, not an automatic root cause. Without a comparable baseline, product or locator defects remain unproven.'))); heading.append(explanation)

      if (run.authoringOrigin) heading.append(node('p', `${copy('用例修订', 'Case revision')}: ${run.authoringOrigin.revisionId.slice(0, 8)} · ${copy('完整标识见技术详情', 'Full identity in technical details')}`, 'wb-note'))
      heading.append(button('载入此快照为新草稿', 'Load snapshot as new draft', () => edit(run.yaml, run.params ?? {}, null)))
      if (run.phase === 'finished' && run.source !== 'import' && !run.share) heading.append(button('按原快照复跑（新运行）', 'Replay original snapshot (new run)', async event => {
        if (await choose(copy('复跑会执行设备操作并在本机保存原始证据', 'Replay executes device actions and retains original local evidence'), [['run', '确认复跑并留证', 'Confirm replay and evidence'], ['cancel', '取消', 'Cancel']]) !== 'run') return
        event.target.disabled = true; event.target.textContent = copy('正在受理复跑…', 'Accepting replay…')
        try { const child = await api(`/api/runs/${run.id}/replay`, { localEvidence: true }); navigate(`#/runs/${child.id}`) }
        catch (failure) { error.textContent = copy(`复跑失败或响应未知，请先检查运行历史，不会自动重试：${failure.message}`, `Replay failed or response unknown; inspect history before retrying: ${failure.message}`) }
      }))
      const failures = node('div', undefined, 'analysis-failure-navigation')
      failures.append(node('strong', copy(`${presentation.failures.length} 个步骤失败`, `${presentation.failures.length} failed steps`)))
      const previousFailure = [...presentation.failures].reverse().find(step => step.index < selection), nextFailure = presentation.failures.find(step => step.index > selection)
      for (const [step, zh, en, id] of [[previousFailure, '上一个失败', 'Previous failure', 'analysis-previous-failure'], [nextFailure, '下一个失败', 'Next failure', 'analysis-next-failure']]) {
        const control = button(zh, en, () => navigate(`#/runs/${run.id}?step=${step.index}&tab=evidence`), id); control.disabled = !step; failures.append(control)
      }
      heading.append(failures)
      const checks = node('section', undefined, 'analysis-run-checks'); checks.id = 'analysis-run-checks'
      checks.append(node('h2', copy('验证范围 / 运行级检查', 'Verification scope / run-level checks')))
      for (const item of presentation.dimensions) {
        const line = node('p', `${reportLabel(item.kind, locale)}: ${reportLabel(item.status, locale)}${item.required ? copy('（必需）', ' (required)') : ''}${item.reason ? ` · ${item.reason}` : ''}`, item.required && item.status !== 'pass' ? 'wb-warning' : 'wb-note'); checks.append(line)
      }
      if (!presentation.runtimeDeclared) checks.append(node('p', copy('时间、健康与性能门禁未声明；不视为已通过。', 'Temporal, health and performance gates were not declared; no pass is inferred.'), 'wb-note'))
      for (const measure of presentation.measurements) checks.append(node('p', `${copy('观测耗时', 'Observed duration')}: ${Math.round(measure.elapsedMs)} / ${measure.maxElapsedMs} ms · ${reportLabel(measure.status, locale)} · ${measure.reason}`, 'wb-note'))
      if (presentation.health) checks.append(node('p', `${copy('健康来源覆盖', 'Health coverage')}: ${presentation.health.coverage} · ${presentation.health.gaps.join(', ')}`, 'wb-note'))
      const scope = node('details'); scope.append(node('summary', copy('完整验证范围', 'Full verification scope')), checks); scope.open = false; if (run.phase === 'finished' && presentation.runChecks.length) heading.append(node('p', copy(`${presentation.runChecks.length} 项必需检查未通过，展开完整验证范围查看。`, `${presentation.runChecks.length} required checks did not pass; expand full verification scope.`), 'wb-warning')); heading.append(scope)
      tabs.replaceChildren()
      for (const [key, zh, en] of [['summary', '概览', 'Overview'], ['evidence', '步骤与证据', 'Steps & evidence'], ['compare', '历史与比较', 'History & comparison'], ['share', '分享', 'Share']]) {
        const tab = node('a', copy(zh, en)); tab.href = `#/runs/${run.id}?${selection ? `step=${selection}&` : ''}tab=${key}`; tab.setAttribute('aria-current', key === next.tab || key === 'evidence' && ['steps', 'details'].includes(next.tab) || key === 'compare' && next.tab === 'triage' ? 'page' : 'false'); tabs.append(tab)
      }
      const advanced = node('details'); advanced.append(node('summary', copy('详细视图', 'Detailed views')))
      for (const [key, zh, en] of [['steps', '步骤', 'Steps'], ['details', '技术详情', 'Technical details'], ['triage', '分诊与复核', 'Triage & review']]) { const link = node('a', copy(zh, en)); link.href = `#/runs/${run.id}?${selection ? `step=${selection}&` : ''}tab=${key}`; advanced.append(link) }
      tabs.append(advanced)
      root.dataset.tab = next.tab
      contextDrawer.open = next.tab === 'details'
      const more = node('details', undefined, 'replay-summary-more'); more.append(node('summary', copy('运行信息与操作', 'Run information & actions')))
      for (const child of [...heading.children]) {
        if (child.tagName === 'BUTTON' || child.tagName === 'DETAILS' || child.classList.contains('analysis-failure-navigation') && !presentation.failures.length) more.append(child)
      }
      heading.append(more)
      steps.replaceChildren(node('h2', copy('归档步骤', 'Recorded steps')))
      const stepSearch = field(steps, '搜索步骤', 'Search steps', 'analysis-step-search'); stepSearch.value = searchByRun.get(run.id) ?? ''; stepSearch.maxLength = 160
      const filterSteps = () => { searchByRun.set(run.id, stepSearch.value); const query = stepSearch.value.toLocaleLowerCase(); for (const item of steps.querySelectorAll('button[data-step]')) { item.hidden = !item.textContent.toLocaleLowerCase().includes(query) && item.dataset.step !== String(route?.step ?? selection); if (query && !item.hidden && item.closest('details')) item.closest('details').open = true } }
      stepSearch.oninput = () => { playback.pause(); filterSteps() }
      let groupKey, group, waitGroup
      for (const step of run.steps) {
        const key = (step.path ?? 'root').split('/').slice(0, -1).join('/') || 'root'
        if (key !== groupKey) { groupKey = key; waitGroup = null; group = node('div', undefined, 'replay-step-group'); group.append(node('h3', key === 'root' || /^root\/\d+$/.test(key) ? copy('主流程', 'Main flow') : key)); steps.append(group) }
        let owner = group
        if (['wait', 'waitUntil'].includes(step.kind)) { if (!waitGroup) { waitGroup = node('details', undefined, 'replay-waits'); waitGroup.append(node('summary', copy('等待步骤', 'Waiting steps'))); group.append(waitGroup) }; owner = waitGroup; if (step.index === selection || presentation.failures.some(failed => failed.index === step.index)) waitGroup.open = true } else waitGroup = null
        const item = button(`${step.index}. ${stepCaption(step, 'zh-CN')}`, `${step.index}. ${stepCaption(step, 'en')}`, () => navigate(`#/runs/${run.id}?step=${step.index}&tab=evidence`))
        item.append(node('small', `${reportLabel(step.status, locale)} · ${stepDuration(step)}`)); item.dataset.failed = String(presentation.failures.some(failed => failed.index === step.index))
        item.dataset.step = step.index; item.setAttribute('aria-current', String(selection === step.index)); owner.append(item)
        item.onkeydown = event => { if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return; event.preventDefault(); const buttons = [...steps.querySelectorAll('button')].filter(button => !button.hidden), index = buttons.indexOf(item); const target = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)]; target?.focus(); target?.click() }
      }
      filterSteps()
      renderedLocale = document.documentElement.lang
      readingToken = null; reading.hidden = true
      await playback.configure({ steps: run.steps, failures: presentation.failures.map(step => step.index), index: selection, enabled: run.phase === 'finished' && run.steps.some(step => step.evidence.some(file => file.contentType === 'image/png' && !file.incomplete)) })
      if (token === epoch && focusedStep && document.activeElement === document.body) steps.querySelector(`button[data-step="${selection}"]`)?.focus({ preventScroll: true })
      if (!selected) { context.replaceChildren(); evidence.replaceChildren(node('p', copy('没有可展示的归档步骤证据', 'No recorded step evidence available'))) }
      if (token !== epoch) return
      renderSecondary()
      void api('/api/runs', undefined, signal).then(result => { if (token === epoch) history = result.runs }).catch(() => {})
    } catch (failure) { if (token === epoch && !signal.aborted) { error.textContent = copy(`无法读取；保留已有内容，请重试或回到运行记录。${failure.message}`, `Read failed; prior content retained. Retry or return to runs. ${failure.message}`); error.append(button('重试读取', 'Retry reading', () => void show(next))) } }
    finally { if (readingToken === token) { readingToken = null; reading.hidden = true } }
  }
  async function selectEvidence(selected, { signal, automatic }) {
      const run = current, token = ++evidenceEpoch, locale = document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'
      actionComparison?.clear()
      // A retained image may show its old identity, but its controls must not
      // cancel the new step's pending load or reopen stale action evidence.
      const comparisonSlot = actionComparison?.root.parentElement
      if (comparisonSlot?.classList.contains('evidence-comparison-slot')) comparisonSlot.style.minHeight = `${comparisonSlot.offsetHeight}px`
      actionComparison?.root.remove()
      actionComparison = null
      route = { ...route, step: selected.index }
      if (automatic) replaceSelection?.(`#/runs/${run.id}?step=${selected.index}&tab=evidence`)
      for (const item of steps.querySelectorAll('button[data-step]')) { const active = Number(item.dataset.step) === selected.index; item.setAttribute('aria-current', String(active)); if (active) { item.hidden = false; if (item.closest('details')) item.closest('details').open = true } }
      if (automatic) {
        const item = steps.querySelector('button[aria-current=true]')
        if (item && steps.clientHeight) {
          const box = item.getBoundingClientRect(), list = steps.getBoundingClientRect()
          if (box.bottom > list.bottom) steps.scrollTop += box.bottom - list.bottom + 8
          else if (box.top < list.top) steps.scrollTop -= list.top - box.top + 8
        }
      }
      for (const anchor of tabs.querySelectorAll('a')) { const url = new URL(anchor.href); url.hash = url.hash.replace(/(?:step=\d+&)?tab=/, `step=${selected.index}&tab=`); anchor.href = url.hash }
      const failures = reportDetail(run).failures
      for (const [id, step] of [['analysis-previous-failure', [...failures].reverse().find(item => item.index < selected.index)], ['analysis-next-failure', failures.find(item => item.index > selected.index)]]) {
        const control = heading.querySelector(`#${id}`); if (control) { control.disabled = !step; control.onclick = () => navigate(`#/runs/${run.id}?step=${step.index}&tab=evidence`) }
      }
      context.replaceChildren(node('h2', copy('步骤上下文', 'Step context')))
      const technical = node('details'); technical.append(node('summary', copy('技术详情 / 结果分项', 'Technical details / dimensions'))); renderResultDimensions(technical, run, { t, node }); renderProvenance(technical, run, { t, node }); technical.append(node('pre', JSON.stringify({ id: run.id, comparison: run.comparison, origin: run.authoringOrigin, diagnostics: run.diagnostics }, null, 2))); context.append(technical)
      if (selected) {
        context.prepend(node('p', `${copy('预期 / 定位条件', 'Expected / locator')}: ${reportLabel(selected.kind, locale)} ${selected.target ?? ''}`), node('p', `${copy('实际记录', 'Recorded observation')}: ${reportStepObservation(selected)}`), node('p', `${copy('源码位置', 'Source location')}: ${selected.path ?? '—'} · ${selected.sourceLine ?? '—'}`))
        const source = node('details'), sourceText = node('pre')
        for (const [index, line] of run.yaml.split('\n').entries()) sourceText.append(node(index + 1 === selected.sourceLine ? 'mark' : 'span', `${index + 1}  ${line}`, 'source-line'))
        source.append(node('summary', copy('冻结的 YAML', 'Frozen YAML')), sourceText); context.append(source)
        if (selected.verification?.diagnostics) { const diagnostics = node('details'); diagnostics.append(node('summary', copy('原始结构诊断', 'Raw structure diagnostics')), node('pre', JSON.stringify(selected.verification.diagnostics, null, 2))); context.append(diagnostics) }
        return loadEvidence(run, selected, token, signal)
      }
  }
  async function loadEvidence(run, step, token, signal) {
    // Keep the prior verified view while loading, clearly labelled with its own identity.
    // The slot remains in the layout even when empty: inserting/removing the
    // status paragraph above the image otherwise moves every frame twice.
    let status = evidence.querySelector('.evidence-load-status')
    if (!status) { status = node('div', undefined, 'evidence-load-status'); status.tabIndex = 0; evidence.prepend(status) }
    status.setAttribute('aria-label', copy('截图读取状态', 'Screenshot loading status'))
    const pending = node('p', copy(`正在载入步骤 ${step.index} 的历史证据…`, `Loading historical evidence for step ${step.index}…`), 'evidence-pending'); pending.setAttribute('role', 'status'); status.replaceChildren(pending)
    signal.addEventListener('abort', () => { if (token === evidenceEpoch && pending.isConnected) pending.textContent = copy(`步骤 ${step.index} 的读取已取消；可重试或切换步骤。`, `Step ${step.index} read cancelled; retry or switch steps.`) }, { once: true })
    const output = node('div'), caption = node('p', `${stepCaption(step, document.documentElement.lang)} · ${stepDuration(step)} · ${reportLabel(step.status, document.documentElement.lang)}`, 'replay-action-caption')
    caption.tabIndex = 0
    output.append(node('h2', copy(`历史证据 · 步骤 ${step.index}`, `Historical evidence · step ${step.index}`)), caption)
    const png = resultImage(step), xml = step.evidence.find(file => file.contentType.startsWith('application/xml') && !file.incomplete)
    let nextUrl = null
    try {
      if (png) {
        const response = await fetch(link(run, png), { signal }); if (!response.ok) throw new Error(copy('历史截图缺失或校验失败', 'Historical image missing or integrity failed'))
        const blob = await response.blob(); if (blob.size > 4 * 1024 * 1024) throw new Error('Evidence budget exceeded')
        if (token !== evidenceEpoch || signal.aborted) return false
        nextUrl = URL.createObjectURL(blob); const img = node('img'); img.src = nextUrl; img.alt = copy(`归档步骤 ${step.index} 截图`, `Archived step ${step.index} screenshot`); const viewport = node('div', undefined, 'report-image-viewport'), tools = node('div', undefined, 'report-image-tools'); let scale = 1; const zoom = amount => { scale = Math.max(.25, Math.min(4, amount)); img.style.maxWidth = scale === 1 ? '100%' : 'none'; img.style.maxHeight = scale === 1 ? '620px' : 'none'; img.style.width = scale === 1 ? 'auto' : `${img.naturalWidth * scale}px` }; tools.append(button('适应', 'Fit', () => zoom(1)), button('放大', 'Zoom in', () => zoom(scale + .25)), button('缩小', 'Zoom out', () => zoom(scale - .25)), button('原尺寸', 'Original size', () => { scale = 1; img.style.maxWidth = img.style.maxHeight = 'none'; img.style.width = `${img.naturalWidth}px` })); viewport.append(img); output.append(tools, viewport)
        const cancelDecode = () => { URL.revokeObjectURL(nextUrl); img.removeAttribute('src') }
        signal.addEventListener('abort', cancelDecode, { once: true })
        try { await img.decode() } finally { signal.removeEventListener('abort', cancelDecode) }
        if (token !== evidenceEpoch || signal.aborted) { URL.revokeObjectURL(nextUrl); return false }
      } else {
        pending.textContent = copy(`步骤 ${step.index} 未记录可用截图，不使用实时画面代替。`, `Step ${step.index}: no usable screenshot recorded; live media is not substituted.`)
      }
      if (png) {
        actionComparison = createActionComparison({ run, step, link, pause: () => playback.pause() })
        const comparisonSlot = node('div', undefined, 'evidence-comparison-slot'); comparisonSlot.append(actionComparison.root); output.append(comparisonSlot)
      }
      if (xml) {
        const details = node('details'); details.append(node('summary', copy('读取登记页面结构', 'Read registered hierarchy')))
        let loaded = false
        details.ontoggle = async () => {
          if (!details.open || loaded) return
          loaded = true; const progress = node('p', copy('正在读取结构…', 'Loading hierarchy…')); details.append(progress)
          try { const response = await fetch(link(run, xml), { signal }); if (!response.ok) throw new Error('Hierarchy unavailable / integrity failed'); const text = await response.text(); if (text.length > 4 * 1024 * 1024) throw new Error('Evidence budget exceeded'); if (token === evidenceEpoch) progress.replaceWith(node('pre', text)) }
          catch (failure) { if (!signal.aborted && token === evidenceEpoch) { progress.textContent = failure.message; loaded = false } }
        }; context.append(details)
      } else context.append(node('p', copy('未记录页面结构', 'Hierarchy not recorded')))
      if (run.video?.file) {
        const details = node('details'); details.append(node('summary', copy('录像（按需读取，定位为近似时间）', 'Video (on demand; approximate timing)')))
        details.ontoggle = () => {
          if (!details.open || details.querySelector('video')) return
          const player = node('video'); player.controls = true; player.preload = 'metadata'; player.src = link(run, run.video.file)
          player.onplay = () => playback.pause()
          const offset = (Date.parse(step.startedAt) - Date.parse(run.video.startedAt)) / 1000
          player.onloadedmetadata = () => { if (Number.isFinite(offset) && offset >= 0 && offset <= player.duration) player.currentTime = offset }
          player.onerror = () => details.append(node('p', copy('录像不可用或完整性校验失败', 'Video unavailable or integrity failed'))); details.append(player)
        }; (png ? output : context).append(details)
      } else context.append(node('p', copy('该运行未记录可用录像', 'No usable video recorded for this run')))
      if (token !== evidenceEpoch || signal.aborted) { if (nextUrl) URL.revokeObjectURL(nextUrl); return false }
      if (!png) return false
      if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = nextUrl
      status.replaceChildren()
      evidence.replaceChildren(status, output)
      return Boolean(png)
    } catch (failure) { if (nextUrl) URL.revokeObjectURL(nextUrl); if (token === evidenceEpoch && !signal.aborted) { pending.textContent = copy(`步骤 ${step.index}: ${failure.message}`, `Step ${step.index}: ${failure.message}`); pending.classList.add('wb-error') }; return false }
  }
  function deactivate() { playback.pause(); timeline.clear(); actionComparison?.clear(); evidenceEpoch++; epoch++; readingToken = null; reading.hidden = true; abort?.abort(); route = null; if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null }
  setInterval(() => { if (route) void comparison.poll() }, 500)
  return { show, deactivate, refreshRunning(recorded) {
    if (!recorded || readingToken !== null || route?.id !== recorded.id) return
    // Acceptance precedes manifest materialization. An early unreadable read is
    // not a frozen terminal record; refresh when authoritative identity arrives.
    // Compare source identity, not integrity-projected verdicts, so missing
    // evidence on a genuine completed record does not cause endless rereads.
    if (!current || current.phase !== 'finished' || recorded.name !== current.name || recorded.startedAt !== current.startedAt || recorded.stepCount !== current.steps.length) void show(route)
  } }
}
function evidenceLabel(value) { return ({ verified: copy('材料完整性校验通过', 'Material integrity checked'), unavailable: copy('当前不可用，原结果保留', 'Currently unavailable; original verdict retained'), 'not-checked': copy('尚未复验', 'Not checked'), 'not-revalidated': copy('派生材料未复验', 'Derived evidence not revalidated') })[value] ?? copy('未知 / 历史记录', 'Unknown / legacy record') }
