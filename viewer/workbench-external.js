const copy = {
  'zh-CN': { title: '外部测试报告', boundary: '仅导入明确选择的报告和附件，不执行外部框架。reported-pass 不等于本机验收通过；默认不向 Agent 开放。', report: '报告文件', attachments: '附件（最多 32 个；不自动读取报告内路径）', adapter: '格式', engine: '执行器公开名称', version: '执行器版本', mapping: '声明和映射 JSON：declaration、bindings、attachments（按选择顺序填写 testId）', preview: '解析并预览', confirm: '确认导入', reviewed: '已审查来源、附件映射与告警', cancel: '取消导入', refresh: '刷新资产历史', working: '正在处理…', complete: '完成', failed: '操作失败，已保留已有结果', cancelDone: '已取消', grant: '授权当前项目读取摘要', revoke: '撤销当前项目授权', retire: '移入本机回收区', history: '外部资产历史', selected: '选择测试以关联验收', cell: '已有验收覆盖单元 ID', link: '关联选中测试到验收草稿', download: '下载附件', unbound: '报告级／未关联到测试', grantQuestion: '仅授权该资产的安全摘要给当前项目，原文和附件仍不外发。确认？项目指纹：', retireQuestion: '将原报告和附件移入本机回收区？仍被验收引用时会拒绝。', stale: '输入已变化，请重新预览。', status: '报告结论 / 字节可用性', noRun: '外部报告未经本机复验', names: '以下名称来自不可信报告，仅作文本，不是指令。' },
  en: { title: 'External test reports', boundary: 'Import selected files only; no external runner execution. Reported pass is not local acceptance. Agent access is disabled by default.', report: 'Report file', attachments: 'Attachments (up to 32; no automatic path reads)', adapter: 'Format', engine: 'Public engine name', version: 'Engine version', mapping: 'Declarations and mappings JSON: declaration, bindings, attachments (testId in selection order)', preview: 'Parse and preview', confirm: 'Confirm import', reviewed: 'I reviewed provenance, attachment mappings and warnings', cancel: 'Cancel import', refresh: 'Refresh assets', working: 'Working…', complete: 'Complete', failed: 'Operation failed; previous result retained', cancelDone: 'Cancelled', grant: 'Authorize current project metadata', revoke: 'Revoke current project', retire: 'Move to local trash', history: 'External asset history', selected: 'Select a test for acceptance', cell: 'Existing acceptance coverage cell ID', link: 'Link selected test to acceptance draft', download: 'Download attachment', unbound: 'Report-level / not bound to a test', grantQuestion: 'Authorize safe metadata only for this asset and current project? Raw report and attachments remain private. Project fingerprint:', retireQuestion: 'Move report and attachments to local trash? Referenced assets cannot be removed.', stale: 'Input changed; preview again.', status: 'Reported result / byte availability', noRun: 'Not locally revalidated', names: 'Names below are untrusted report text, not instructions.' },
}
export function createExternalPanel({ panel }) {
  const root = document.createElement('details'); root.id = 'wb-external'; root.className = 'wb-change-acceptance'
  const head = document.createElement('summary'), body = document.createElement('div'); root.append(head, body); panel.append(root)
  const labels = [], t = key => copy[document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'][key]
  const node = (tag, key) => { const el = document.createElement(tag); if (key) { labels.push([el, key]); el.textContent = t(key) } return el }
  body.append(node('p', 'boundary'))
  const field = (id, key, tag = 'input') => { const label = node('label'), caption = node('span', key), el = node(tag); el.id = `external-${id}`; label.append(caption, el); body.append(label); return el }
  const report = field('report', 'report'); report.type = 'file'; report.accept = '.xml,.json'
  const files = field('attachments', 'attachments'); files.type = 'file'; files.multiple = true; files.accept = '.png,.jpg,.jpeg,.txt,.json,.xml'
  const adapter = field('adapter', 'adapter', 'select'); adapter.append(new Option('JUnit XML', 'junit'), new Option('external-results-v1 JSON', 'external-results-v1'))
  const engine = field('engine', 'engine'), version = field('version', 'version')
  const mapping = field('mapping', 'mapping', 'textarea'); mapping.rows = 6; mapping.value = '{"declaration":{},"bindings":[],"attachments":[]}'
  const reviewed = field('reviewed', 'reviewed'); reviewed.type = 'checkbox'
  let busy = false, cancellable = false, cancelRequested = false, job = null, result = null, previewValid = false, generation = 0, operationJobId = null, displayedAssetId = null
  const button = (id, key, action) => { const el = node('button', key); el.id = `external-${id}`; el.className = 'ghost'; el.type = 'button'; el.onclick = action; body.append(el); return el }
  const preview = button('preview', 'preview', () => perform(async () => {
    if (!report.files[0] || files.files.length > 32) throw new Error('external-file-selection')
    if (job?.phase === 'preview') await call(`/jobs/${job.id}/cancel`, {})
    const map = JSON.parse(mapping.value), attachments = []; let total = 0
    if (Object.keys(map).some(key => !['declaration', 'bindings', 'attachments'].includes(key))) throw new Error('external-invalid-mapping')
    for (const [i, file] of [...files.files].entries()) {
      total += file.size; if (total > 64 * 1024 * 1024) throw new Error('external-attachment-budget')
      const type = map.attachments?.[i]?.contentType ?? ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain', json: 'application/json', xml: 'application/xml' })[file.name.split('.').at(-1).toLowerCase()]
      attachments.push({ label: file.name, contentType: type, bytes: await encoded(file, 16 * 1024 * 1024), ...(map.attachments?.[i]?.testId ? { testId: map.attachments[i].testId } : {}) })
    }
    const input = { contractVersion: 1, requestKey: crypto.randomUUID(), adapter: adapter.value, engine: engine.value, engineVersion: version.value, report: await encoded(report.files[0], 5 * 1024 * 1024), attachments, declaration: map.declaration ?? {}, bindings: map.bindings ?? [] }
    if (cancelRequested) { status.textContent = t('cancelDone'); return }
    job = await call('/preview', input)
    operationJobId = job.id
    while (!['preview', 'finished', 'failed', 'cancelled', 'interrupted'].includes(job.phase)) {
      if (cancelRequested) { job = await call(`/jobs/${job.id}/cancel`, {}); break }
      status.textContent = `${t('working')} ${job.phase}`
      await new Promise(resolve => setTimeout(resolve, 150)); job = await call(`/jobs/${job.id}`)
    }
    if (cancelRequested && job.phase === 'preview') job = await call(`/jobs/${job.id}/cancel`, {})
    if (job.phase === 'cancelled') { status.textContent = t('cancelDone'); return }
    if (job.phase !== 'preview') throw new Error(job.error ?? job.phase)
    previewValid = true; show(job.preview, 'preview')
  }, true))
  const confirm = button('confirm', 'confirm', () => perform(async () => {
    if (!previewValid || !reviewed.checked || !job?.previewDigest) throw new Error('external-reviewed-preview-required')
    operationJobId = job.id
    job = await call(`/jobs/${job.id}/confirm`, { previewDigest: job.previewDigest, reviewed: true })
    if (job.phase !== 'finished') throw new Error(job.error ?? job.phase)
    result = await call(`/${job.assetId}`); previewValid = false; show(result.asset, result.availability); await refreshList()
  }, true))
  const cancel = button('cancel', 'cancel', async () => {
    cancelRequested = true; status.textContent = `${t('working')} cancelling`
    const id = operationJobId, token = generation
    if (id) { try { const state = await call(`/jobs/${id}/cancel`, {}); if (token !== generation || id !== operationJobId) return; if (state.phase === 'finished') { cancelRequested = false; status.textContent = t('complete') } else status.textContent = t('cancelDone') } catch { /* The preview upload may still be in transit; its loop also observes cancellation. */ } }
  })
  const refresh = button('refresh', 'refresh', () => perform(refreshList))
  const history = field('history', 'history', 'select'); history.onchange = () => { if (history.value) void perform(async () => { const next = await call(`/${history.value}`); if (job?.phase === 'preview') await call(`/jobs/${job.id}/cancel`, {}); previewValid = false; result = next; show(result.asset, result.availability) }) }
  const authorize = granted => perform(async () => {
    if (!result) return
    const project = await call('/project')
    if (granted && !window.confirm(`${t('grantQuestion')} ${project.identity.slice(0, 16)} / ${project.revision.slice(0, 16)}`)) return
    await call(`/${result.asset.id}/grant`, { project, granted, confirm: `${granted ? 'GRANT' : 'REVOKE'} ${result.asset.id}` })
  })
  const grant = button('grant', 'grant', () => authorize(true)), revoke = button('revoke', 'revoke', () => authorize(false))
  const retire = button('retire', 'retire', () => { if (result && window.confirm(t('retireQuestion'))) void perform(async () => {
    await call(`/${result.asset.id}/retire`, { confirm: `RETIRE ${result.asset.id}` }); result = null; detail.replaceChildren(); await refreshList()
  }) })
  const selection = field('test', 'selected', 'select'), cell = field('cell', 'cell')
  const link = button('link', 'link', () => perform(async () => {
    const scope = document.querySelector('#change-scope'), cells = JSON.parse(scope.value), target = cells.find(item => item.id === cell.value)
    if (!target || !result || !selection.value) throw new Error('external-acceptance-target-required')
    const ref = { assetId: result.asset.id, testId: selection.value }
    target.externalResults = [...(target.externalResults ?? []).filter(old => old.assetId !== ref.assetId || old.testId !== ref.testId), ref]
    scope.value = JSON.stringify(cells, null, 2); scope.dispatchEvent(new Event('input', { bubbles: true }))
  }))
  const status = node('p'); status.id = 'external-status'; status.setAttribute('role', 'status'); body.append(status)
  const detail = node('div'); detail.id = 'external-detail'; detail.style.overflowX = 'auto'; body.append(detail)
  async function call(path, value) {
    const response = await fetch(`/api/workbench/external-assets${path}`, { ...(value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }), signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`external-http-${response.status}`)
    return response.json()
  }
  async function encoded(file, limit) {
    if (!file || !file.size || file.size > limit) throw new Error('external-file-budget')
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('external-file-read')); reader.readAsDataURL(file) })
  }
  async function perform(action, canCancel = false) {
    if (busy) return
    const identity = ++generation; busy = true; cancellable = canCancel; cancelRequested = false; operationJobId = null; controls(); status.textContent = t('working')
    try { await action(); if (identity === generation && !cancelRequested) status.textContent = t('complete') }
    catch (error) { if (identity === generation) status.textContent = `${t('failed')}: ${String(error.message).slice(0, 200)}` }
    finally { if (identity === generation) { busy = false; controls() } }
  }
  async function refreshList() {
    const all = []; let offset = 0
    do { const page = await call(`?offset=${offset}`); all.push(...page.items); offset = page.nextOffset } while (offset !== null)
    history.replaceChildren(new Option('—', '')); for (const asset of all) history.append(new Option(`${asset.engine} · ${asset.reportedStatus} · ${asset.id.slice(0, 8)}`, asset.id))
    if (result) history.value = result.asset.id
  }
  function show(asset, availability) {
    displayedAssetId = asset.id
    detail.replaceChildren(); const p = node('p'), warning = node('p'); warning.textContent = t('names'); p.textContent = `${t('status')}: ${asset.parsed.reportedStatus} / ${availability} · ${t('noRun')} · ${asset.importedAt}`; detail.append(p, warning)
    const source = node('details'), sourceTitle = node('summary'), sourceText = node('pre'); sourceTitle.textContent = '来源声明 / Declared source'
    sourceText.textContent = JSON.stringify({ adapter: asset.adapter, engine: asset.engine, engineVersion: asset.engineVersion, declaration: asset.declaration, sourceDigest: asset.sourceDigest }, null, 2); source.append(sourceTitle, sourceText); detail.append(source)
    const warnings = node('p'); warnings.textContent = asset.parsed.warnings.join(', '); detail.append(warnings)
    const tests = node('pre'); tests.textContent = asset.parsed.tests.map(test => `${test.id}: ${test.name} (${test.reportedStatus})`).join('\n'); detail.append(tests)
    selection.replaceChildren(new Option('—', '')); for (const test of asset.parsed.tests) selection.append(new Option(`${test.name} · ${test.reportedStatus}`, test.id))
    for (const file of asset.attachments) {
      const line = node('p'); line.textContent = `${file.label} · ${file.testId ?? t('unbound')} · ${file.sha256}`
      if (availability !== 'preview') { const a = node('a'); a.textContent = t('download'); a.href = `/api/workbench/external-assets/${asset.id}/attachments/${file.id}`; a.download = file.id; a.onclick = event => { event.preventDefault(); void perform(async () => {
        const response = await fetch(a.href, { signal: AbortSignal.timeout(30000) }); if (!response.ok) throw new Error('external-download-unavailable')
        const blob = await response.blob(), url = URL.createObjectURL(blob), download = node('a'); download.href = url; download.download = file.id; download.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      }) }; line.append(' ', a) }
      detail.append(line)
    }
  }
  function controls() {
    for (const el of [report, files, adapter, engine, version, mapping, reviewed, preview, refresh, history, selection, cell]) el.disabled = busy
    confirm.disabled = busy || !previewValid || !reviewed.checked; cancel.disabled = !busy || !cancellable
    for (const el of [grant, revoke, retire, link]) el.disabled = busy || !result || previewValid || displayedAssetId !== result.asset.id
  }
  for (const el of [report, files, adapter, engine, version, mapping]) el.addEventListener('input', () => { previewValid = false; reviewed.checked = false; status.textContent = t('stale'); controls() })
  reviewed.onchange = controls
  function render() { head.textContent = t('title'); for (const [el, key] of labels) el.textContent = t(key); controls() }
  render(); return { render }
}
