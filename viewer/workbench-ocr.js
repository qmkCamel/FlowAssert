const copy = {
  'zh-CN': { title: '本机区域文字识别', boundary: '仅识别本机 PNG，不执行图片中的指令。预览始终是候选，不批准生产断言。拖动图片可框选区域；旧结果保留并显示原始来源。', image: '选择 PNG 截图', config: '区域配置 JSON（需明确 App、构建、页面、语言和版本）', identity: '读取本机 OCR 能力', profiles: '读取已登记配置', preview: '识别候选区域', cancel: '取消并等待回收', save: '保存配置草稿', working: '正在识别…', cancelling: '正在取消并回收…', cancelled: '已取消；保留上次结果', failed: '识别失败；保留上次结果', changed: '输入已变化；旧任务结果不会应用到新图片', result: '上次完整候选结果（非生产结论）', missing: '先选择截图并填写配置', ready: '已读取本机信息；不会自动准备或批准', complete: '候选识别完成', unapproved: '候选 / 未批准', unavailable: '本机帮助程序不可用；请显式运行 ocr prepare' },
  en: { title: 'Local region OCR', boundary: 'Local PNG only; image text never triggers actions. Previews are candidates, not production approvals. Drag to select a region; previous results retain their source.', image: 'Select PNG screenshot', config: 'Region profile JSON (explicit App, build, page, language and version)', identity: 'Read local OCR capabilities', profiles: 'Read registered profiles', preview: 'Preview region', cancel: 'Cancel and await cleanup', save: 'Save profile draft', working: 'Recognizing…', cancelling: 'Cancelling and cleaning up…', cancelled: 'Cancelled; previous result retained', failed: 'Recognition failed; previous result retained', changed: 'Input changed; old responses cannot update the new image', result: 'Last complete candidate (not production verification)', missing: 'Select a screenshot and enter a profile first', ready: 'Local metadata loaded; no implicit preparation or approval', complete: 'Candidate recognition complete', unapproved: 'Candidate / unapproved', unavailable: 'Local helper unavailable; explicitly run ocr prepare' },
}
export function createOcrPanel({ panel }) {
  const root = document.createElement('details'); root.id = 'wb-ocr'; root.className = 'wb-change-acceptance'
  const head = document.createElement('summary'), body = document.createElement('div'); root.append(head, body); panel.append(root)
  const t = key => copy[document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'][key], labels = []
  const el = (tag, key) => { const n = document.createElement(tag); if (key) labels.push([n, key]); return n }
  body.append(el('p', 'boundary'))
  const field = (id, key, tag = 'input') => { const l = el('label'), n = el(tag); n.id = `ocr-${id}`; l.append(el('span', key), n); body.append(l); return n }
  const file = field('image', 'image'); file.type = 'file'; file.accept = 'image/png'
  const canvas = el('canvas'); canvas.id = 'ocr-canvas'; canvas.style.cssText = 'max-width:100%;height:auto;touch-action:none;display:none'; body.append(canvas)
  const config = field('config', 'config', 'textarea'); config.rows = 8; config.value = '{}'
  const approval = el('p'); approval.id = 'ocr-approval'; body.append(approval)
  const button = (id, key, fn) => {
    const b = el('button', key); b.id = `ocr-${id}`; b.type = 'button'; b.className = 'ghost'
    b.onclick = ['identity', 'profiles'].includes(id) ? async () => {
      if (b.disabled) return
      b.disabled = true; b.textContent = `${t(key)}…`; status.textContent = `${t(key)}…`
      try { await fn() } finally { b.disabled = false; b.textContent = t(key) }
    } : fn
    body.append(b); return b
  }
  let generation = 0, operation = null, bitmap = null, imageData = null, drag = null, lastResult = null, approvalText = null
  const status = el('p'); status.id = 'ocr-status'; status.setAttribute('role', 'status')
  const display = el('pre'); display.id = 'ocr-result'; display.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'
  const api = async (path, value) => { const response = await fetch(`/api/workbench/ocr${path}`, { ...(value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }), signal: AbortSignal.timeout(30000) }); if (!response.ok) throw new Error('ocr-unavailable'); return response.json() }
  const showError = () => { status.textContent = t('failed') }
  const controls = () => { preview.disabled = Boolean(operation); cancel.disabled = !operation || operation.cancelled; approval.textContent = approvalText || t('unapproved') }
  async function cancelOperation(op) {
    if (!op) return
    op.cancelled = true; controls(); status.textContent = t('cancelling')
    if (op.id) await api(`/jobs/${op.id}/cancel`, {})
    // If POST is in flight its completion path sends the cancellation and awaits cleanup.
  }
  const changed = () => { generation++; approvalText = null; if (operation) void cancelOperation(operation).catch(showError); status.textContent = t('changed'); controls(); draw() }
  button('identity', 'identity', async () => {
    const version = generation
    try {
      const data = await api('/identity'); if (version !== generation) return
      const identity = data.identity, revision = identity.capabilities.revisions.at(-1)
      const current = JSON.parse(config.value)
      const width = bitmap?.width || 390, height = bitmap?.height || 844
      config.value = JSON.stringify({ contractVersion: 1, id: 'region', revision: 1, appId: 'com.example.app', platform: 'ios', builds: ['REPLACE_BUILD'], pageKey: 'REPLACE_PAGE', width, height, orientation: height >= width ? 'portrait' : 'landscape', region: { x: 0, y: 0, width, height }, expected: 'REPLACE_EXPECTED', blockers: [], normalization: { nfc: true, trim: true }, minimumConfidence: .9, ...current, identity, requestRevision: revision.revision, languages: [revision.languages.includes('en-US') ? 'en-US' : revision.languages[0]] }, null, 2)
      changed(); status.textContent = t('ready')
    } catch { if (version === generation) status.textContent = t('unavailable') }
  })
  const registered = field('registered', 'profiles', 'select'); registered.append(new Option('—', ''))
  let registeredProfiles = []
  button('profiles', 'profiles', async () => { const version = generation; try { const data = await api('/profiles'); if (version !== generation) return; registeredProfiles = data.profiles; registered.replaceChildren(new Option('—', ''), ...data.profiles.map(p => new Option(p.id, p.id))); status.textContent = t('ready') } catch { if (version === generation) showError() } })
  registered.onchange = () => { const item = registeredProfiles.find(p => p.id === registered.value); if (item) { config.value = JSON.stringify(item.profile, null, 2); changed(); approvalText = item.approvalStatus; controls() } }
  const preview = button('preview', 'preview', async () => {
    if (operation) return
    if (!imageData) { status.textContent = t('missing'); return }
    const op = { generation, id: null, cancelled: false }; operation = op; controls(); status.textContent = t('working')
    try {
      let job = await api('/preview', { profile: JSON.parse(config.value), image: imageData, localOnly: true }); op.id = job.id
      if (op.cancelled || op.generation !== generation) job = await api(`/jobs/${op.id}/cancel`, {})
      while (['running', 'cancelling'].includes(job.phase)) { await new Promise(resolve => setTimeout(resolve, 150)); job = await api(`/jobs/${job.id}`) }
      if (op.generation === generation) {
        if (job.phase === 'succeeded' && !op.cancelled) { lastResult = job.result; renderResult(); status.textContent = t('complete') }
        else status.textContent = t(job.phase === 'cancelled' || op.cancelled ? 'cancelled' : 'failed')
      }
    } catch { if (op.generation === generation) showError() }
    finally { if (operation === op) { operation = null; controls() } }
  })
  const cancel = button('cancel', 'cancel', () => { void cancelOperation(operation).catch(showError) })
  button('save', 'save', () => { try { const draft = JSON.parse(config.value); const url = URL.createObjectURL(new Blob([JSON.stringify({ profile: draft, productionEnabled: false }, null, 2)], { type: 'application/json' })); const a = el('a'); a.href = url; a.download = 'ocr-profile-draft.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) } catch { showError() } })
  body.append(status, el('h4', 'result'), display)
  function renderResult() { display.textContent = lastResult ? JSON.stringify(lastResult, null, 2) : '' }
  function draw() {
    if (!bitmap) return
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0)
    try { const r = JSON.parse(config.value).region; if (r) { ctx.strokeStyle = '#f97316'; ctx.lineWidth = Math.max(2, canvas.width / 150); ctx.strokeRect(r.x, r.y, r.width, r.height) } } catch { /* incomplete JSON remains editable */ }
  }
  file.onchange = async () => {
    changed(); const version = generation; imageData = null; bitmap?.close(); bitmap = null; canvas.style.display = 'none'
    try {
      const input = file.files[0]; if (!input || input.size > 16 * 1024 * 1024 || input.type !== 'image/png') throw new Error('png-required')
      const image = await createImageBitmap(input)
      if (version !== generation) { image.close(); return }
      if (image.width > 4096 || image.height > 4096) { image.close(); throw new Error('image-budget') }
      const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(input) })
      if (version !== generation) { image.close(); return }
      bitmap = image; imageData = base64; canvas.width = image.width; canvas.height = image.height; canvas.style.display = 'block'; draw()
    } catch { if (version === generation) showError() }
  }
  config.oninput = changed
  const point = event => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(canvas.width, Math.round((event.clientX - r.left) * canvas.width / r.width))), y: Math.max(0, Math.min(canvas.height, Math.round((event.clientY - r.top) * canvas.height / r.height))) } }
  canvas.onpointerdown = event => { drag = point(event); canvas.setPointerCapture(event.pointerId) }
  canvas.onpointerup = event => {
    if (!drag) return
    const end = point(event), start = drag; drag = null
    try { const p = JSON.parse(config.value), region = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }; if (!region.width || !region.height) return; config.value = JSON.stringify({ ...p, region }, null, 2); changed() } catch { showError() }
  }
  canvas.onpointercancel = () => { drag = null }
  function render() { head.textContent = t('title'); for (const [n, key] of labels) n.textContent = t(key); renderResult(); controls() }
  render(); return { render }
}
