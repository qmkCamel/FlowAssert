const words = {
  'zh-CN': { title: '变更验收 / PR 摘要', boundary: '仅覆盖声明范围；提交与制品为声明关联，不证明供应链。不会自动上传或评论 PR。', repo: '仓库公开标签', commit: '完整提交摘要', pr: 'PR 编号（可选）', scope: '覆盖范围 JSON（明确每个场景、制品、环境、必需维度和运行）', review: '已审查公开标签及提交／制品声明关联', choose: '选择一条已完成运行', add: '从运行加入覆盖单元', preview: '预览验收', publish: '确认发布新修订', new: '新建验收对象', refresh: '刷新验收历史', loading: '正在处理…', cancel: '取消当前操作', failed: '操作失败，已保留上次结果', done: '完成', current: '当前核查', generated: '生成时结论', history: '验收历史', json: '下载 JSON', markdown: '下载 PR Markdown', stale: '输入已变化，请重新预览；保留上次结果供参考。', unavailable: '运行缺少来源信息，需补齐或先重新运行。', retired: '废弃并释放本对象引用', confirmRetire: '废弃本对象？保留历史摘要，不删除原始运行。', inspected: '已检查时间', source: '原始失败与复验记录', run: '运行标识' },
  en: { title: 'Change acceptance / PR summary', boundary: 'Declared scope and commit/build association only; not supply-chain verification. No automatic upload or PR comment.', repo: 'Public repository label', commit: 'Full commit digest', pr: 'PR number (optional)', scope: 'Coverage JSON (scenario, build, environment, required dimensions and run)', review: 'I reviewed public labels and declared commit/build association', choose: 'Select a finished run', add: 'Add coverage from run', preview: 'Preview acceptance', publish: 'Publish new revision', new: 'New acceptance record', refresh: 'Refresh acceptance history', loading: 'Working…', cancel: 'Cancel operation', failed: 'Operation failed; previous result retained', done: 'Complete', current: 'Current verification', generated: 'At generation', history: 'Acceptance history', json: 'Download JSON', markdown: 'Download PR Markdown', stale: 'Input changed. Preview again; previous result retained for reference.', unavailable: 'Run provenance is incomplete. Complete it or rerun first.', retired: 'Retire and release this record’s references', confirmRetire: 'Retire this record? Summaries remain and original runs are not deleted.', inspected: 'Checked at', source: 'Original failure and follow-up records', run: 'Run ID' },
}
export function createChangeAcceptancePanel({ panel, history }) {
  const root = document.createElement('details'); root.id = 'wb-change-acceptance'; root.className = 'wb-change-acceptance'
  const summary = document.createElement('summary'); root.append(summary)
  const content = document.createElement('div'); root.append(content)
  const t = key => (words[document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'])[key]
  const element = (tag, text = '') => { const e = document.createElement(tag); e.textContent = text; return e }
  const labels = []
  const translated = (tag, key) => { const e = element(tag); labels.push([e, key]); return e }
  content.append(translated('p', 'boundary'))
  const input = (id, key, type = 'text') => { const label = translated('label', key), field = element('input'); field.id = id; field.type = type; field.style.width = '100%'; label.append(field); content.append(label); return field }
  const repository = input('change-repository', 'repo'), commit = input('change-commit', 'commit'), pr = input('change-pr', 'pr', 'number')
  const runSelect = element('select'); runSelect.id = 'change-run'; content.append(runSelect)
  const button = (id, key, handler) => { const b = translated('button', key); b.type = 'button'; b.className = 'ghost'; b.id = id; b.onclick = handler; content.append(b); return b }
  const add = button('change-add-run', 'add', () => perform(async signal => {
    const run = await call(`/api/runs/${encodeURIComponent(runSelect.value)}`, undefined, signal)
    const p = run.productContract?.provenance
    if (!p || !run.comparison) throw new Error(t('unavailable'))
    const cells = JSON.parse(scope.value)
    const value = a => a?.source === 'unknown' ? '' : a?.value ?? ''
    const cell = { id: `scenario-${cells.length + 1}`, title: `Scenario ${cells.length + 1}`, platform: run.platform, appId: value(p.app.id), binarySha256: value(p.app.binarySha256), build: value(p.app.build), logicalTestKey: run.comparison.logicalTestKey,
      inputDigest: run.comparison.inputDigest, environment: { os: value(p.environment.os), provider: value(p.environment.provider), driver: value(p.environment.driver), viewport: value(p.environment.viewport), backendEnvironment: value(p.project.backendEnvironment) },
      required: ['ui', 'business', 'cleanup', 'evidence'], runId: run.id, historyRunIds: run.parentRunId ? [run.parentRunId] : [] }
    scope.value = JSON.stringify([...cells, cell], null, 2)
    if (!commit.value) commit.value = value(p.project.sourceCommit)
    preview = null
  }))
  const scopeLabel = translated('label', 'scope'), scope = element('textarea'); scope.id = 'change-scope'; scope.rows = 8; scope.value = '[]'; scope.style.width = '100%'; scopeLabel.append(scope); content.append(scopeLabel)
  const reviewLabel = element('label'), reviewed = element('input'); reviewed.type = 'checkbox'; reviewed.id = 'change-reviewed'; reviewLabel.append(reviewed, translated('span', 'review')); content.append(reviewLabel)
  let recordId = crypto.randomUUID(), revision = 0, preview = null, result = null, controller = null, jobId = null, generation = 0, publishing = false, cancelRequested = false
  const previewButton = button('change-preview', 'preview', () => perform(async signal => {
    const cells = JSON.parse(scope.value)
    const input = { contractVersion: cells.some(cell => cell.required?.some(d => ['health', 'performance'].includes(d))) ? 2 : 1, repository: repository.value, commit: commit.value, ...(pr.value ? { pullRequest: Number(pr.value) } : {}), declarationsReviewed: reviewed.checked, cells }
    preview = await call('/api/workbench/acceptance-records/preview', input, signal); result = null; show()
  }))
  const publishButton = button('change-publish', 'publish', () => perform(async signal => {
    if (!preview) throw new Error(t('stale'))
    publishing = true
    let job = await call('/api/workbench/acceptance-records', { id: recordId, expectedRevision: revision, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: crypto.randomUUID(), reviewed: true }, signal)
    jobId = job.jobId
    if (cancelRequested) await call(`/api/workbench/acceptance-records/jobs/${jobId}/cancel`, {})
    while (!['finished', 'failed', 'cancelled', 'interrupted'].includes(job.phase)) {
      status.textContent = `${t('loading')} ${job.phase}`
      await new Promise(resolve => setTimeout(resolve, 250))
      job = await call(`/api/workbench/acceptance-records/jobs/${jobId}`, undefined, signal)
    }
    if (job.phase !== 'finished') throw new Error(job.error ?? job.phase)
    revision = job.revision
    result = await call(`/api/workbench/acceptance-records/${recordId}`, undefined, signal)
    preview = null; show(); await refreshHistory(signal)
  }))
  const cancel = button('change-cancel', 'cancel', async () => {
    cancelRequested = true
    if (publishing && !jobId) { status.textContent = `${t('loading')} cancelling`; return }
    if (jobId) {
      try { const job = await call(`/api/workbench/acceptance-records/jobs/${jobId}/cancel`, {}); status.textContent = `${t('loading')} ${job.phase}` }
      catch { status.textContent = t('failed') }
    } else { generation++; controller?.abort(); controller = null; status.textContent = 'cancelled'; controls() }
  })
  const create = button('change-new', 'new', () => { recordId = crypto.randomUUID(); revision = 0; preview = null; result = null; show(); controls() })
  const list = element('select'); list.id = 'change-history'; content.append(translated('p', 'history'), list)
  const revisions = element('select'); revisions.id = 'change-revisions'; revisions.setAttribute('aria-label', 'Revision / 修订'); content.append(revisions)
  const loadRecord = async (id, selectedRevision, signal) => {
    const fetched = await call(`/api/workbench/acceptance-records/${id}${selectedRevision ? `?revision=${selectedRevision}` : ''}`, undefined, signal)
    repository.value = fetched.input.repository; commit.value = fetched.input.commit; pr.value = fetched.input.pullRequest ?? ''; scope.value = JSON.stringify(fetched.input.cells, null, 2); reviewed.checked = false
    recordId = fetched.id; revision = fetched.latestRevision; result = fetched; preview = null; show()
  }
  list.onchange = () => { if (list.value) void perform(async signal => {
    await loadRecord(list.value, undefined, signal)
  }) }
  revisions.onchange = () => { if (revisions.value) void perform(signal => loadRecord(recordId, Number(revisions.value), signal)) }
  const refresh = button('change-refresh', 'refresh', () => perform(refreshHistory))
  const download = format => perform(async signal => {
    if (!result) return
    const response = await fetch(`/api/workbench/acceptance-records/${result.id}/revisions/${result.revision}/export?format=${format}`, { signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob(); signal.throwIfAborted()
    const url = URL.createObjectURL(blob), a = element('a'); a.href = url; a.download = `acceptance-${result.id}-r${result.revision}.${format === 'json' ? 'json' : 'md'}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  const json = button('change-json', 'json', () => download('json')), markdown = button('change-markdown', 'markdown', () => download('markdown'))
  const retire = button('change-retire', 'retired', () => { if (result && confirm(t('confirmRetire'))) void perform(async signal => {
    await call(`/api/workbench/acceptance-records/${recordId}/retire`, { confirm: `RETIRE ACCEPTANCE ${recordId}` }, signal)
    result = await call(`/api/workbench/acceptance-records/${recordId}`, undefined, signal); preview = null; show(); await refreshHistory(signal)
  }) })
  const status = element('p'); status.id = 'change-status'; status.setAttribute('role', 'status'); content.append(status)
  const output = element('div'); output.id = 'change-result'; output.style.overflowX = 'auto'; content.append(output)
  async function call(path, body, signal) {
    const response = await fetch(path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ...(signal ? { signal } : {}) })
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error?.message ?? data.error ?? `HTTP ${response.status}`) }
    return response.json()
  }
  async function perform(action) {
    if (controller) return
    const current = new AbortController(), token = ++generation; controller = current; jobId = null; publishing = false; cancelRequested = false; controls(); status.textContent = t('loading')
    try { await action(current.signal); if (token === generation) status.textContent = t('done') }
    catch (error) { if (token === generation) status.textContent = `${t('failed')}: ${String(error.message ?? error).slice(0, 300)}` }
    finally { if (token === generation) { controller = null; jobId = null; publishing = false; controls() } }
  }
  function controls() {
    for (const node of [repository, commit, pr, scope, reviewed, runSelect, list, revisions, add, previewButton, create, refresh]) node.disabled = Boolean(controller)
    publishButton.disabled = Boolean(controller) || !preview || !reviewed.checked
    json.disabled = markdown.disabled = Boolean(controller) || !result
    retire.disabled = Boolean(controller) || !result || result.retired
    cancel.disabled = !controller
  }
  async function refreshHistory(signal) {
    const entries = []; let offset = 0
    do { const page = await call(`/api/workbench/acceptance-records?offset=${offset}`, undefined, signal); entries.push(...page.items); offset = page.nextOffset } while (offset !== null)
    list.replaceChildren(new Option('—', ''))
    for (const entry of entries) list.append(new Option(`${entry.repository} · r${entry.revision} · ${entry.commit.slice(0, 8)}${entry.retired ? ' (retired)' : ''}`, entry.id))
    list.value = entries.some(entry => entry.id === recordId) ? recordId : ''
  }
  function show() {
    output.replaceChildren()
    revisions.replaceChildren(new Option('—', ''))
    if (result) { for (let n = 1; n <= result.latestRevision; n++) revisions.append(new Option(`r${n}`, String(n))); revisions.value = String(result.revision) }
    const value = result?.current ?? preview?.summary
    if (!value) return
    if (result) output.append(element('p', `${t('generated')}: ${result.generated.status} · ${t('current')}: ${result.current.status} · r${result.revision}`), element('p', `${t('inspected')}: ${result.checkedAt}`))
    else output.append(element('p', `${t('preview')}: ${value.status} · ${preview.generatedAt}`))
    const table = element('table'), header = element('tr')
    const runtime = value.contractVersion === 2
    for (const key of (document.documentElement.lang === 'zh-CN' ? ['场景', '平台', '结论', 'UI', '业务', '视觉', '清理', '证据', ...(runtime ? ['健康', '性能'] : []), '缺口'] : ['Scenario', 'Platform', 'Result', 'UI', 'Business', 'Visual', 'Cleanup', 'Evidence', ...(runtime ? ['Health', 'Performance'] : []), 'Gaps'])) header.append(element('th', key))
    table.append(header)
    for (const cell of value.cells) {
      const row = element('tr')
      for (const text of [cell.title, cell.platform, `${cell.status} (${cell.outcome})`, ...['ui', 'business', 'visual', 'cleanup', 'evidence', ...(runtime ? ['health', 'performance'] : [])].map(key => cell.dimensions[key]), cell.reasons.join(', ')]) row.append(element('td', text))
      table.append(row)
    }
    output.append(table)
    const chain = element('details'); chain.append(element('summary', t('source')))
    for (const cell of value.cells) { chain.append(element('p', `${cell.id}: ${cell.runId ?? 'unselected'} · ${cell.manifestSha256 ?? 'unavailable'}`)); for (const past of cell.history) chain.append(element('p', `${past.runId}: ${past.verdict}`)) }
    for (const cell of value.cells) for (const external of cell.externalResults ?? []) chain.append(element('p', `external-result ${external.assetId}/${external.testId}: reported-${external.reportedStatus} · ${external.availability} · ${external.source}`))
    output.append(chain)
  }
  const changed = () => { preview = null; status.textContent = t('stale'); controls() }
  for (const field of [repository, commit, pr, scope, reviewed]) field.addEventListener('input', changed)
  function render() {
    summary.textContent = t('title')
    // Preserve form children and values when changing language.
    for (const [node, key] of labels) {
      if (node.tagName === 'LABEL') { const text = [...node.childNodes].find(child => child.nodeType === Node.TEXT_NODE); if (text) text.textContent = t(key); else node.prepend(document.createTextNode(t(key))) }
      else node.textContent = t(key)
    }
    const selected = runSelect.value; runSelect.replaceChildren(new Option(t('choose'), ''))
    for (const run of history().filter(run => run.phase === 'finished' && run.source !== 'import')) runSelect.append(new Option(`${run.name} · ${run.id.slice(-8)}`, run.id))
    runSelect.value = selected; controls(); show()
  }
  root.addEventListener('toggle', () => { if (root.open) render() })
  panel.append(root); render()
  return { render }
}
