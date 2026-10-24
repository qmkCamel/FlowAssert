import { createRedactionEditor, parseRectangles } from './report-redaction.js'
import { copy } from './journey-common.js'
/** Isolated share-panel draft and task state. Only selected source names and masks enter requests. */
export function createSharePanel({ node, t, api, currentRunId, rerender, defaultFormat = 'json' }) {
  const drafts = new Map()
  return function renderShare(root, run) {
    const state = drafts.get(run.id) ?? { selected: new Set(), masks: {}, preview: null, loading: false, status: '', jobId: null, format: defaultFormat }
    drafts.set(run.id, state)
    const section = node('details', undefined, 'wb-share'); section.append(node('summary', t('shareTitle')))
    section.open = state.open ?? Boolean(state.loading || state.preview || state.status)
    section.addEventListener('toggle', () => { state.open = section.open })
    section.append(node('p', t('shareHint'), 'wb-note'))
    const format = node('select'); format.setAttribute('aria-label', copy('导出格式', 'Export format')); for (const [value, label] of [['html', 'HTML · 离线阅读 / Offline reading'], ['json', 'JSON · 归档交换 / Archive exchange']]) { const option = node('option', label); option.value = value; format.append(option) }; format.value = state.format; format.disabled = state.loading; section.append(format)
    const invalidate = () => { state.preview = null; state.status = ''; download.disabled = reviewed.disabled = true; output.replaceChildren(); status.textContent = ''; reviewed.checked = false }
    format.onchange = () => { state.format = format.value; invalidate(); rerender() }
    const eligible = [...run.evidence, ...run.steps.flatMap(step => step.evidence)].filter(file => ['image/png', 'application/xml; charset=utf-8'].includes(file.contentType) && !file.incomplete && !file.recovered)
    const failedFiles = new Set(run.steps.filter(step => step.status === 'failed' || step.verification && step.verification.status !== 'pass').flatMap(step => step.evidence.map(file => file.name)))
    const selectFailures = node('button', copy('仅选择失败步骤材料', 'Select failed-step materials'), 'text-button'); selectFailures.type = 'button'; selectFailures.disabled = state.loading || !failedFiles.size; selectFailures.onclick = () => { state.selected = new Set(eligible.filter(file => failedFiles.has(file.name)).map(file => file.name)); invalidate(); rerender() }; section.append(selectFailures)
    for (const file of eligible) {
      const row = node('div', undefined, 'wb-row'), label = node('label'), checkbox = node('input')
      checkbox.type = 'checkbox'; checkbox.checked = state.selected.has(file.name); checkbox.disabled = state.loading
      checkbox.onchange = () => { checkbox.checked ? state.selected.add(file.name) : state.selected.delete(file.name); state.preview = null; state.status = ''; preview.disabled = state.format !== 'html' && !state.selected.size; download.disabled = true; reviewed.disabled = true; output.replaceChildren(); status.textContent = '' }
      const step = run.steps.find(step => step.evidence.some(item => item.name === file.name)); label.append(checkbox, document.createTextNode(` ${step ? `${copy('步骤', 'Step')} ${step.index} · ` : ''}${file.name} · ${file.bytes} B`)); row.append(label)
      if (file.contentType === 'image/png') {
        const mask = node('input'); mask.type = 'text'; mask.placeholder = t('shareMaskHint'); mask.value = state.masks[file.name] ?? ''; mask.disabled = state.loading
        mask.setAttribute('aria-label', `${file.name} ${t('shareMaskHint')}`)
        mask.oninput = () => { state.masks[file.name] = mask.value; editor.sync(); state.preview = null; state.status = ''; download.disabled = true; reviewed.disabled = true; output.replaceChildren(); status.textContent = '' }
        const numeric = node('details'); numeric.append(node('summary', copy('高级：源像素坐标', 'Advanced: source-pixel coordinates')), mask); row.append(numeric)
        const editor = createRedactionEditor(row, { node, api, run, file, getValue: () => state.masks[file.name] ?? '', setValue: value => { state.masks[file.name] = value; mask.value = value; invalidate() }, disabled: () => state.loading })
      }
      section.append(row)
    }
    const controls = node('div', undefined, 'wb-row'), preview = node('button', t('sharePreview'), 'check-button'), download = node('button', state.format === 'html' ? copy('下载已审查报告', 'Download reviewed report') : t('shareDownload'), 'check-button')
    preview.type = download.type = 'button'; preview.disabled = state.loading || state.format !== 'html' && !state.selected.size; download.disabled = true
    const reviewed = node('input'); reviewed.type = 'checkbox'; reviewed.disabled = state.loading || !state.preview
    reviewed.onchange = () => { download.disabled = state.loading || !state.preview || !reviewed.checked }
    const reviewedLabel = node('label'); reviewedLabel.append(reviewed, document.createTextNode(` ${t('shareReviewed')}`))
    const cancel = node('button', t('shareCancel'), 'text-button'); cancel.type = 'button'; cancel.disabled = !state.loading || !state.jobId
    cancel.onclick = async () => { if (!state.jobId) return; cancel.disabled = true; try { await api(`/api/workbench/share/jobs/${state.jobId}/cancel`, {}); state.status = t('shareCancelling'); status.textContent = state.status } catch (error) { state.status = error.message; status.textContent = state.status } }
    controls.append(preview, reviewedLabel, download, cancel); section.append(controls)
    const status = node('p', state.status, 'wb-note'); status.setAttribute('role', 'status'); section.append(status)
    const output = node('div')
    if (state.preview) {
      output.append(node('p', state.preview.warning, 'wb-scope'))
      for (const suggestion of state.preview.suggestions ?? []) output.append(node('p', `${t('shareSuggestion')}: ${t(suggestion.kind)}${suggestion.file ? ` · ${suggestion.file}` : ''}`, 'wb-warning'))
      if (state.preview.report) { const frame = node('iframe'); frame.className = 'report-preview'; frame.title = copy('完整最终报告预览', 'Complete final report preview'); frame.setAttribute('sandbox', ''); frame.srcdoc = state.preview.report.html; output.append(node('p', `${copy('最终文件摘要', 'Final file digest')}: ${state.preview.report.sha256}`, 'wb-note'), frame) }
      for (const item of state.preview.report ? [] : state.preview.files) {
        output.append(node('p', `${item.sourceName} · ${item.bytes} B · ${item.masks} masks`, 'wb-note'))
        if (item.kind === 'image') { const image = node('img'); image.src = item.preview; image.alt = `${item.sourceName} ${t('sharePreview')}`; image.style.maxWidth = '100%'; output.append(image) }
        else output.append(node('pre', item.preview))
      }
      output.append(node('p', state.preview.withheld.join('; '), 'wb-note'))
    }
    section.append(output)
    const options = () => ({ files: [...state.selected].map(name => ({ name, ...(state.masks[name]?.trim() ? { masks: parseRectangles(state.masks[name]) } : {}) })) })
    const runJob = async (kind, extra = {}) => {
      const job = await api('/api/workbench/share/jobs', { kind, requestId: crypto.randomUUID(), runId: run.id, ...(state.format === 'html' ? { format: 'html', contractVersion: 1 } : {}), ...options(), ...extra })
      state.jobId = job.jobId; cancel.disabled = false
      while (true) {
        const current = await api(`/api/workbench/share/jobs/${job.jobId}`)
        state.status = `${current.phase} · ${current.progress}`; status.textContent = state.status
        if (current.phase === 'succeeded' || current.phase === 'awaiting-review') { state.finishedAt = current.finishedAt ?? new Date().toISOString(); return api(`/api/workbench/share/jobs/${job.jobId}/result`) }
        if (['failed', 'cancelled', 'interrupted'].includes(current.phase)) throw new Error(current.stableError || current.progress || current.phase)
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }
    preview.onclick = async () => {
      state.loading = true; for (const input of section.querySelectorAll('input')) input.disabled = true; state.status = t('sharePreparing'); preview.disabled = true; download.disabled = true; format.disabled = true; reviewed.disabled = true; status.textContent = state.status
      try { state.preview = await runJob('share-preview'); state.status = `${t('shareReady')} · ${new Date(state.finishedAt).toLocaleTimeString()}` }
      catch (error) { state.status = error.message }
      finally { state.loading = false; state.jobId = null; if (currentRunId() === run.id) rerender() }
    }
    download.onclick = async () => {
      if (state.preview && Date.parse(state.preview.expiresAt) <= Date.now()) { state.status = copy('预览已过期，请重新预览并确认。', 'Preview expired; preview and review again.'); status.textContent = state.status; download.disabled = true; return }
      if (!state.preview || !reviewed.checked) { state.status = t('shareReviewed'); status.textContent = state.status; return }
      state.loading = true; for (const input of section.querySelectorAll('input')) input.disabled = true; state.status = t('sharePreparing'); preview.disabled = true; download.disabled = true; format.disabled = true; reviewed.disabled = true; status.textContent = state.status
      try {
        const archive = await runJob('share-export', { reviewToken: state.preview.reviewToken, reviewed: true })
        const url = URL.createObjectURL(new Blob([archive.format === 'mobile-mirror-html' ? archive.html : JSON.stringify(archive)], { type: archive.format === 'mobile-mirror-html' ? 'text/html;charset=utf-8' : 'application/json' }))
        const link = document.createElement('a'); link.href = url; link.download = archive.filename ?? `mobile-mirror-share-${archive.sharing.shareId}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
        state.status = `${t('shareDownloaded')} · ${new Date(state.finishedAt).toLocaleTimeString()}`
      } catch (error) { state.status = error.message }
      finally { state.loading = false; state.jobId = null; if (currentRunId() === run.id) rerender() }
    }
    root.append(section)
  }
}
