const copy = {
  'zh-CN': { title: '下一步核查与复验', boundary: '均为待执行建议，不是已确认根因；复验不会改写原结果。', generate: '生成核查计划', loading: '正在核验本机材料并生成计划…', cancel: '取消', error: '核查未完成，上次结果保留', first: '最早已记录失败', facts: '已记录事实', gaps: '证据与环境缺口', proposed: '待执行', confirm: '支持该方向的现象', refute: '反证或下一步', evidence: '证据', followup: '选择已完成的关联复验', compare: '对比复验', none: '暂无关联复验；可用下方“载入此用例重跑”创建', original: '原运行', next: '复验', dimension: '维度', changed: '变化', unchanged: '未变', clean: '复验本次通过，不证明修复因果，也不覆盖原失败', notClean: '复验尚未干净通过', noFailure: '没有失败需要核查', verdict: '有效结果', reported: '原始结果', ui: 'UI', business: '业务', visual: '视觉', cleanup: '清理' },
  en: { title: 'Next checks & follow-up', boundary: 'Proposed checks, not confirmed causes. Follow-up never rewrites the original result.', generate: 'Generate investigation plan', loading: 'Verifying local evidence and preparing checks…', cancel: 'Cancel', error: 'Investigation incomplete; previous result retained', first: 'Earliest recorded failure', facts: 'Recorded facts', gaps: 'Evidence & environment gaps', proposed: 'Proposed', confirm: 'Supports this direction', refute: 'Counterevidence or next step', evidence: 'Evidence', followup: 'Select a completed child run', compare: 'Compare follow-up', none: 'No child run; use “Load flow for another run” below', original: 'Original', next: 'Follow-up', dimension: 'Dimension', changed: 'Changed', unchanged: 'Unchanged', clean: 'Follow-up passed; this does not prove causality or overwrite the original failure', notClean: 'Follow-up is not a clean pass', noFailure: 'No failure to investigate', verdict: 'Effective result', reported: 'Reported result', ui: 'UI', business: 'Business', visual: 'Visual', cleanup: 'Cleanup' },
}
const checks = {
  'zh-CN': {
    'restore-evidence': ['先恢复证据可读性或显式重新留证', '原始 PNG/XML 与登记摘要一致，缺失检查点补齐', '材料不完整时停止产品/定位器归因；导入材料须本机复验'],
    'check-environment': ['核查连接、WDA/Appium 和依赖状态', '同一时间窗的类型化连接错误与只读就绪检查一致', '环境正常再检查页面与业务；不得盲重放结果未知的写入'],
    'confirm-page': ['核对预期 App、构建、页面和前置状态', '失败检查点处于错误页面或测试数据未准备', '页面正确再检查身份和可见性；缺构建信息先补齐'],
    'inspect-locator': ['对比失败与成功证据中的目标身份', '同一控件唯一锚点仍在，仅定位字段改变；再人工审查修复草稿', '无唯一锚点或多个匹配时不自动改定位器，不弱化断言'],
    'check-readiness': ['检查可见、启用、焦点、边界稳定及作用域', '截图与结构显示控件隐藏、禁用、持续移动或焦点未落定', '已经就绪仍失败时核对驱动/窗口映射；增加等待不是原因证明'],
    'verify-business': ['独立查询本轮 correlation ID 的业务终态', '受信任查询的预期与实际确实不符，而非 UI 提示差异', '未知、超时或数据串用需保持不确定；先排除环境和准备故障'],
    'review-cleanup': ['检查本轮清理 token 与资源残留', '仅本轮登记资源仍存在，或清理有类型化失败', '删除后须查询确认；不得批量删除其他测试数据'],
    'review-expectation': ['核对原断言、输入和构建差异', '业务/页面证据与已审查预期不符且无采集冲突', '预期变化需单独审查；不能为通过而删除失败断言'],
    reproduce: ['明确载入关联草稿，审查后运行一次', '同 App/平台关联运行复现相同失败，缩小排查范围', '一次通过不能证明因果；对比参数、YAML、环境与构建变化'],
  },
  en: {
    'restore-evidence': ['Restore evidence or explicitly recapture', 'PNG/XML match registered digests and checkpoints are complete', 'Withhold product/locator attribution while incomplete; rerun imports locally'],
    'check-environment': ['Check connection, WDA/Appium and dependencies', 'Typed errors align with read-only checks in the same time window', 'If healthy, inspect page/business; never repeat an unknown write blindly'],
    'confirm-page': ['Check app, build, page and prerequisites', 'Failure checkpoint shows the wrong page or missing test data', 'If correct, inspect identity/visibility; first record missing build metadata'],
    'inspect-locator': ['Compare target identity in failed and successful evidence', 'A unique anchor remains and only locator fields changed; review repair', 'No unique anchor or duplicates: do not auto-repair or weaken assertions'],
    'check-readiness': ['Inspect visibility, enablement, focus, bounds and scope', 'Screenshot/tree show hidden, disabled, moving or unfocused target', 'If ready, check driver/window mapping; longer waits do not prove cause'],
    'verify-business': ['Independently query this run’s correlation ID', 'Trusted terminal state differs from the reviewed expected value', 'Keep timeout/mixed data inconclusive; rule out preparation/environment'],
    'review-cleanup': ['Inspect this run’s cleanup token and resource', 'Only the registered resource remains or cleanup has a typed failure', 'Confirm deletion by reading back; never bulk-delete other test data'],
    'review-expectation': ['Review original assertion, inputs and build', 'Evidence contradicts reviewed expectations without capture conflicts', 'Review changed expectations separately; do not remove assertions to pass'],
    reproduce: ['Explicitly load a child draft, review and run once', 'Same-app/platform child reproduces the failure', 'One pass is not causal proof; compare YAML, inputs, environment and build'],
  },
}
const node = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element }
export function createInvestigationPanel({ api, history, currentRunId, rerender }) {
  const states = new Map()
  const lang = () => document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'
  const t = key => copy[lang()][key] ?? key
  const repaint = id => { if (currentRunId() === id) rerender() }
  const stateFor = id => { if (!states.has(id)) states.set(id, { result: null, error: '', controller: null, generation: 0, selected: '' }); return states.get(id) }
  const request = async (id, state, followupRunId) => {
    if (state.controller || currentRunId() !== id) return
    const controller = new AbortController(), generation = ++state.generation
    state.controller = controller; state.error = ''; repaint(id)
    try {
      const result = await api('/api/workbench/investigation', { runId: id, ...(followupRunId ? { followupRunId } : {}) }, controller.signal)
      if (generation === state.generation && !controller.signal.aborted) state.result = result
    } catch (error) { if (generation === state.generation && !controller.signal.aborted) state.error = error.message }
    finally { if (state.controller === controller) state.controller = null; repaint(id) }
  }
  return { render(root, run) {
    if (run.phase !== 'finished') return
    const state = stateFor(run.id), section = node('section'); section.className = 'wb-investigation'; section.id = 'wb-investigation'; section.dataset.runId = run.id
    section.append(node('h3', t('title')), node('p', t('boundary')))
    const button = (label, handler, disabled = false) => { const b = node('button', label); b.type = 'button'; b.disabled = disabled; b.onclick = handler; section.append(b); return b }
    button(t('generate'), () => request(run.id, state), Boolean(state.controller)).dataset.investigation = 'generate'
    if (state.controller) button(t('cancel'), () => { state.generation++; state.controller.abort(); state.controller = null; repaint(run.id) })
    const status = node('p', state.controller ? t('loading') : state.error ? `${t('error')}: ${state.error}` : ''); status.setAttribute('role', 'status'); section.append(status)
    if (state.result) {
      const { plan, followup } = state.result
      section.append(node('p', `${t('original')}: ${plan.projection.reportedVerdict} → ${plan.projection.verdict}`))
      if (plan.earliestFailure) section.append(node('p', `${t('first')}: #${plan.earliestFailure.index} · line ${plan.earliestFailure.sourceLine ?? '?'} · ${plan.earliestFailure.path ?? ''}`))
      const facts = node('details'); facts.append(node('summary', t('facts')))
      for (const fact of plan.facts) facts.append(node('p', `${fact.domain} · ${fact.code} · ${fact.evidenceRefs.join(', ')}`))
      section.append(facts, node('p', `${t('gaps')}: ${plan.gaps.join(', ') || '—'}`))
      if (!plan.checks.length) section.append(node('p', t('noFailure')))
      const list = node('ol')
      for (const check of plan.checks) {
        const wording = checks[lang()][check.id]; if (!wording) continue
        const item = node('li'); item.append(node('strong', `${t('proposed')}: ${wording[0]}`), node('p', `${t('confirm')}: ${wording[1]}`), node('p', `${t('refute')}: ${wording[2]}`))
        for (const ref of check.evidenceRefs) { const a = node('a', `${t('evidence')}: ${ref}`); a.href = `/api/runs/${plan.runId}/artifacts/${encodeURIComponent(ref)}`; a.target = '_blank'; a.rel = 'noopener'; item.append(a, document.createTextNode(' ')) }
        list.append(item)
      }
      section.append(list)
      if (followup) {
        const table = node('table'); table.className = 'wb-followup'; const head = node('tr')
        for (const label of ['dimension', 'original', 'next']) head.append(node('th', t(label)))
        table.append(head)
        for (const key of ['reported', 'verdict', 'ui', 'business', 'visual', 'cleanup', 'evidence']) {
          const row = node('tr'), value = p => key === 'reported' ? p.reportedVerdict : key === 'verdict' ? p.verdict : p.verification[key].status
          row.append(node('th', t(key)), node('td', value(plan.projection)), node('td', value(followup.projection))); table.append(row)
        }
        section.append(table, node('p', followup.observation === 'followup-clean-not-causal-proof' ? t('clean') : t('notClean')))
        section.append(node('p', ['yamlChanged', 'paramsChanged', 'environmentChanged', 'appBuildChanged'].map(key => `${key}: ${t(followup[key] ? 'changed' : 'unchanged')}`).join(' · ')))
      }
    }
    const eligible = history().filter(item => item.parentRunId === run.id && item.phase === 'finished' && item.source !== 'import' && !item.derived && item.platform === run.platform && item.appId && item.appId === run.comparison?.appContext.appId)
    if (eligible.length) {
      const label = node('label', t('followup')), select = node('select'); select.dataset.investigation = 'followup'; select.append(new Option('—', ''))
      for (const item of eligible) select.append(new Option(`${item.name} · ${item.id.slice(-8)} · ${item.verdict}`, item.id))
      select.value = state.selected; select.onchange = () => { state.selected = select.value; repaint(run.id) }; select.disabled = Boolean(state.controller); label.append(select); section.append(label)
      button(t('compare'), () => request(run.id, state, state.selected), Boolean(state.controller) || !eligible.some(item => item.id === state.selected)).dataset.investigation = 'compare'
    } else section.append(node('p', t('none')))
    root.append(section)
  } }
}
