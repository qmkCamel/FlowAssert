const copy = {
  'zh-CN': { title: '失败分诊（实验）', boundary: '检查方向，不是自动根因；不改变原运行结果。', generate: '生成分诊', withComparison: '使用当前已完成比较', analyzing: '正在分析本机证据，其他控件仍可使用…', cancel: '取消分析', checking: '正在复验报告材料…', saving: '正在保存复核…', retiring: '正在停用报告…', loadingEvidence: '正在复验证据…', error: '分诊未完成，旧报告已保留', retired: '报告已停用；原运行及其他引用未删除', retire: '停用此报告', retireConfirm: '停用此报告并撤销它自己的证据保护引用？', noBaseline: '无基线：仅分析单次运行。', original: '原结果', availability: '当前材料', business: '业务', focus: '最早可检查点', facts: '已记录事实', routes: '检查方向', limits: '限制与缺口', checks: '建议下一步', evidence: '查看证据', review: '人工复核（独立意见）', reviewer: '复核者别名', note: '复核说明', save: '保存复核', unknown: '证据尚不足以选择方向', notApplicable: '没有失败待分诊', hypothesis: '待核对假设', supported: '有依据的方向', undetermined: '未能判断' },
  en: { title: 'Failure triage (experimental)', boundary: 'Investigation directions, not automatic root causes; the original result is unchanged.', generate: 'Generate triage', withComparison: 'Use current completed comparison', analyzing: 'Analyzing local evidence; other controls remain available…', cancel: 'Cancel analysis', checking: 'Rechecking report evidence…', saving: 'Saving review…', retiring: 'Retiring report…', loadingEvidence: 'Rechecking evidence…', error: 'Triage did not complete; earlier report retained', retired: 'Report retired; original run and other references remain', retire: 'Retire this report', retireConfirm: 'Retire this report and revoke only its evidence reference?', noBaseline: 'No baseline: analyzing this run alone.', original: 'Original verdict', availability: 'Current evidence', business: 'Business', focus: 'Earliest checkable point', facts: 'Recorded facts', routes: 'Investigation directions', limits: 'Limits and gaps', checks: 'Suggested next checks', evidence: 'Inspect evidence', review: 'Human review (separate opinion)', reviewer: 'Reviewer alias', note: 'Review note', save: 'Save review', unknown: 'Insufficient evidence to choose a direction', notApplicable: 'No failure to triage', hypothesis: 'Hypothesis to check', supported: 'Evidence-supported direction', undetermined: 'Undetermined' },
}
const directions = {
  'zh-CN': { 'product-behavior': '产品行为待核对', 'locator-change': '定位器变化待核对', environment: '环境或依赖故障', 'evidence-gap': '证据不足' },
  en: { 'product-behavior': 'Check product behavior', 'locator-change': 'Check locator change', environment: 'Environment or dependency', 'evidence-gap': 'Evidence gap' },
}
const checks = {
  'zh-CN': { 'check-expectation': '核对预期与输入版本', 'inspect-verifier': '查看业务或断言证据', 'inspect-app-change': '核对 App 变更', 'compare-hierarchy': '并排查看旧新结构', 'check-page-build': '核对页面与构建', 'open-repair-draft': '显式检查修复草稿', 'inspect-typed-event': '查看类型化事件', 'check-host-readiness': '查看连接或签名排障', 'check-service-status': '检查依赖服务状态', 'inspect-missing-evidence': '查看材料缺口', 'check-capture-permission': '检查采集权限', 'improve-observability': '补充可测试性' },
  en: { 'check-expectation': 'Check expected result and inputs', 'inspect-verifier': 'Inspect verifier evidence', 'inspect-app-change': 'Check app changes', 'compare-hierarchy': 'Compare hierarchies', 'check-page-build': 'Check page and build', 'open-repair-draft': 'Explicitly inspect repair draft', 'inspect-typed-event': 'Inspect typed event', 'check-host-readiness': 'Read connection and signing guidance', 'check-service-status': 'Check dependency status', 'inspect-missing-evidence': 'Inspect missing evidence', 'check-capture-permission': 'Check capture permissions', 'improve-observability': 'Improve testability' },
}
const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element }

export function createTriagePanel({ api, rerender, currentRunId, currentComparison }) {
  const states = new Map()
  const stateFor = id => { if (!states.has(id)) states.set(id, { job: null, report: null, busy: false, error: '', generation: 0, reviews: [], draft: { reviewer: '', note: '', directions: [], evidenceRefs: [] } }); return states.get(id) }
  const isCurrent = (_id, state, generation) => state.generation === generation
  const language = () => document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'
  const label = key => copy[language()][key] ?? key
  const repaint = id => { if (currentRunId() === id) rerender() }
  const refreshReport = async (id, state, generation) => {
    if (!state.job?.reportId) return
    state.busy = 'checking'; repaint(id)
    try {
      const [report, reviews] = await Promise.all([api(`/api/workbench/triage-reports/${state.job.reportId}`), api(`/api/workbench/triage-reports/${state.job.reportId}/reviews`)])
      if (isCurrent(id, state, generation)) { state.report = report; state.reviews = reviews; state.error = '' }
    } catch (error) { if (isCurrent(id, state, generation)) state.error = error.message }
    finally { if (isCurrent(id, state, generation)) { state.busy = false; repaint(id) } }
  }
  const poll = async (id, state, generation) => {
    while (isCurrent(id, state, generation) && state.job && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state.job.state)) {
      await new Promise(resolve => setTimeout(resolve, 300))
      try { const job = await api(`/api/workbench/triage-jobs/${state.job.jobId}`); if (isCurrent(id, state, generation)) { state.job = job; repaint(id) } }
      catch (error) { if (isCurrent(id, state, generation)) { state.error = error.message; state.busy = false; repaint(id) }; return }
    }
    if (!isCurrent(id, state, generation)) return
    if (state.job?.state === 'succeeded') await refreshReport(id, state, generation)
    else { state.error = state.job?.errorCode ?? label('error'); state.busy = false; repaint(id) }
  }
  const start = async (id, state, useComparison) => {
    if (state.busy) return
    state.busy = 'analyzing'; state.error = ''; const generation = ++state.generation; repaint(id)
    try {
      state.job = await api('/api/workbench/triage-jobs', { requestId: crypto.randomUUID(), targetRunId: id, ...(useComparison ? { comparisonId: currentComparison().id } : {}) })
      repaint(id); await poll(id, state, generation)
    } catch (error) { if (isCurrent(id, state, generation)) { state.error = error.message; state.busy = false; repaint(id) } }
  }
  return { render(root, run) {
    if (run.phase !== 'finished') return
    const id = run.id, state = stateFor(id), section = node('section', undefined, 'wb-triage')
    section.append(node('h3', label('title')), node('p', label('boundary'), 'wb-note'))
    const row = node('div', undefined, 'wb-row'), generate = node('button', label('generate'), 'check-button'); generate.type = 'button'; generate.disabled = Boolean(state.busy)
    const available = currentComparison()?.targetRunId === id && ['completed', 'partial'].includes(currentComparison()?.state)
    const check = node('input'); check.type = 'checkbox'; check.disabled = !available; check.setAttribute('aria-label', label('withComparison'))
    const checkLabel = node('label', label('withComparison')); checkLabel.prepend(check)
    generate.onclick = () => void start(id, state, check.checked && available)
    row.append(generate, checkLabel); section.append(row)
    if (!available) section.append(node('p', label('noBaseline'), 'wb-note'))
    if (state.busy || state.job && !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state.job.state)) {
      section.append(node('p', `${label(state.busy || 'analyzing')} ${state.job?.progress ?? ''}`, 'wb-note'))
      if (state.job && !['succeeded', 'failed', 'cancelled', 'interrupted', 'committing'].includes(state.job.state)) { const cancel = node('button', label('cancel'), 'text-button'); cancel.type = 'button'; cancel.onclick = async () => { cancel.disabled = true; try { state.job = await api(`/api/workbench/triage-jobs/${state.job.jobId}/cancel`, {}); repaint(id) } catch (error) { state.error = error.message; repaint(id) } }; section.append(cancel) }
    }
    if (state.error) section.append(node('p', `${label('error')}: ${state.error}`, 'wb-error'))
    const wrapper = state.report, report = wrapper?.report
    if (report) {
      section.append(node('p', `${label('original')}: ${report.reportedVerdict ?? 'unknown'} · ${label('availability')}: ${wrapper.availability} · ${report.completedAt}`, 'wb-scope'))
      section.append(node('p', `UI ${report.verification.ui} · ${label('business')} ${report.verification.business} · visual ${report.verification.visual} · cleanup ${report.verification.cleanup} · evidence ${report.verification.evidence}`, 'wb-note'))
      if (wrapper.retired) section.append(node('p', label('retired'), 'wb-note'))
      if (report.focus) section.append(node('p', `${label('focus')}: ${report.focus.kind} · ${report.focus.stepKey ?? report.focus.stepIndex ?? ''}`, 'wb-note'))
      if (report.disposition !== 'actionable') section.append(node('p', label(report.disposition === 'unknown' ? 'unknown' : 'notApplicable'), 'wb-note'))
      if (report.routes.length) section.append(node('h4', label('routes')))
      for (const route of report.routes) {
        const card = node('details', undefined, 'wb-triage-route')
        card.append(node('summary', `${directions[language()][route.direction]} · ${label(route.basis)}`))
        card.append(node('p', `${label('facts')}: ${route.supportFactIds.map(factId => report.facts.find(fact => fact.id === factId)).filter(Boolean).map(fact => `${fact.domain}/${fact.code}${fact.stepIndex ? ` #${fact.stepIndex}` : ''}`).join(' · ') || '—'}`, 'wb-note'))
        if (route.missingRequirements.length || route.limitations.length) card.append(node('p', `${label('limits')}: ${[...route.missingRequirements, ...route.limitations].join(' · ')}`, 'wb-note'))
        card.append(node('p', `${label('checks')}: ${route.nextCheckIds.map(check => checks[language()][check] ?? check).join(' → ')}`, 'wb-note'))
        section.append(card)
      }
      if (report.limitations.length) section.append(node('p', `${label('limits')}: ${report.limitations.join(' · ')}`, 'wb-note'))
      for (const fact of report.facts.filter(fact => fact.evidenceRefs.length)) {
        for (const ref of fact.evidenceRefs) { const button = node('button', `${label('evidence')} · ${fact.stepIndex ?? fact.stepKey ?? fact.domain} · ${ref}`, 'text-button'); button.type = 'button'; button.onclick = async () => { button.disabled = true; const oldText = button.textContent; button.textContent = label('loadingEvidence'); try { const value = await api(`/api/workbench/triage-reports/${report.reportId}/evidence/${encodeURIComponent(ref)}`); if (value.availability === 'verified') window.open(`/api/runs/${value.runId}/artifacts/${encodeURIComponent(value.name)}`, '_blank', 'noopener'); else { state.error = value.availability; repaint(id) } } catch (error) { state.error = error.message; repaint(id) } finally { button.disabled = false; button.textContent = oldText } }; section.append(button) }
      }
      if (!wrapper.retired) {
        const review = node('details', undefined, 'wb-triage-review'); review.append(node('summary', label('review')))
        const alias = node('input'); alias.maxLength = 80; alias.placeholder = label('reviewer'); alias.setAttribute('aria-label', label('reviewer')); alias.value = state.draft.reviewer; alias.oninput = () => { state.draft.reviewer = alias.value }
        const note = node('textarea'); note.maxLength = 2000; note.placeholder = label('note'); note.setAttribute('aria-label', label('note')); note.value = state.draft.note; note.oninput = () => { state.draft.note = note.value }
        review.append(alias, note)
        const choices = []
        for (const direction of Object.keys(directions.en)) { const option = node('label', directions[language()][direction]); const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = state.draft.directions.includes(direction); checkbox.onchange = () => { state.draft.directions = choices.filter(([, selected]) => selected.checked).map(([name]) => name) }; option.prepend(checkbox); review.append(option); choices.push([direction, checkbox]) }
        for (const file of report.input.evidence.slice(0, 16)) { const option = node('label', `${label('evidence')} · ${file.name}`); const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = state.draft.evidenceRefs.includes(file.name); checkbox.onchange = () => { state.draft.evidenceRefs = [...review.querySelectorAll('input[data-evidence-ref]:checked')].map(input => input.dataset.evidenceRef) }; checkbox.dataset.evidenceRef = file.name; option.prepend(checkbox); review.append(option) }
        const save = node('button', label('save'), 'check-button'); save.type = 'button'; save.disabled = Boolean(state.busy); save.onclick = async () => { if (!state.draft.reviewer.trim() || state.busy) return; const submitted = { ...state.draft, directions: [...state.draft.directions], evidenceRefs: [...state.draft.evidenceRefs] }; state.busy = 'saving'; state.error = ''; repaint(id); try { const result = await api(`/api/workbench/triage-reports/${report.reportId}/reviews`, { reportId: report.reportId, reportDigest: report.digest, expectedRevision: state.reviews.length, reviewer: submitted.reviewer.trim(), note: submitted.note, directions: submitted.directions, evidenceRefs: submitted.evidenceRefs }); state.reviews.push(result); state.draft = { reviewer: '', note: '', directions: [], evidenceRefs: [] } } catch (error) { state.error = error.message } finally { state.busy = false; repaint(id) } }; review.append(save)
        section.append(review, node('p', `${state.reviews.length} review(s)`, 'wb-note'))
        for (const item of state.reviews.slice(-3)) section.append(node('p', `${item.revision}. ${item.reviewer}: ${item.directions.join(', ') || '—'} · ${item.note}`, 'wb-note'))
        const retire = node('button', label('retire'), 'text-button'); retire.type = 'button'; retire.disabled = Boolean(state.busy); retire.onclick = async () => { if (!window.confirm(label('retireConfirm')) || state.busy) return; state.busy = 'retiring'; state.error = ''; repaint(id); try { await api(`/api/workbench/triage-reports/${report.reportId}/retire`, {}); await refreshReport(id, state, state.generation) } catch (error) { state.error = error.message } finally { state.busy = false; repaint(id) } }; section.append(retire)
      }
    }
    root.append(section)
  } }
}
