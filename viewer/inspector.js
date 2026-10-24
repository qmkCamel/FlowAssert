import { queryStructure, structureIndex, containMapping, hitCandidates, parentDistances, QUERY_ROLES, REGIONS } from '/inspection-query.js'
import { selectorCandidates, readinessCandidate } from '/selector-adapter.js'

export function createInspector(t) {
  const enter = document.querySelector('#inspect-button'), panel = document.querySelector('#inspector'), live = document.querySelector('#device-area')
  const el = id => document.querySelector(`#inspection-${id}`)
  const image = el('image'), surface = el('surface'), overlay = el('overlay'), list = el('tree'), details = el('details')
  let snapshot = null, context = null, confirmed = false, controller = null, sequence = 0, selected = null, url = null, ttl = null, message = 'hint', expanded = new Set(), shown = 50, candidates = [], scale = 1, mode = 'live'
  let draftRevision = 0, draftValidation = null, chosenSelector = null, draftStatus = '', draftIssues = [], draftBinding = null
  const handoff = document.createElement('button'); handoff.type = 'button'; handoff.id = 'inspection-handoff'
  el('draft').after(handoff)
  handoff.onclick = () => {
    if (draftBinding && confirmed && context?.generationToken === draftBinding.generationToken && context?.screenEpoch === draftBinding.screenEpoch && Date.parse(draftBinding.expiresAt) > Date.now()) document.dispatchEvent(new CustomEvent('journey:inspector', { detail: { yaml: el('draft').value, ...draftBinding } }))
  }
  const addOption = (select, value, key) => { const option = document.createElement('option'); option.value = value; option.dataset.key = key; select.append(option) }
  for (const role of QUERY_ROLES) addOption(el('role'), role, `role.${role}`)
  for (const region of REGIONS) addOption(el('region'), region, `region.${region}`)
  function label(key) { return t(`inspection.${key}`) }
  function release() { clearTimeout(ttl); ttl = null; if (url) URL.revokeObjectURL(url); url = null; snapshot = null; selected = null; candidates = []; expanded.clear(); image.removeAttribute('src'); list.replaceChildren(); details.replaceChildren(); overlay.replaceChildren(); el('candidates').replaceChildren() }
  function cancel() { sequence++; controller?.abort(); controller = null; render() }
  function close(focus = false) { cancel(); release(); mode = 'live'; panel.hidden = true; live.classList.remove('inspection-hidden'); message = 'hint'; el('search').value = ''; shown = 50; render(); if (focus) enter.focus() }
  function setContext(next) {
    const previous = context
    context = next; confirmed = true
    if (!next || snapshot && snapshot.generationToken !== next.generationToken || previous && next.generationToken !== previous.generationToken) close()
    render()
  }
  function unconfirmed() { confirmed = false; cancel(); render() }
  function render() {
    enter.disabled = !context || !confirmed || !!controller
    enter.textContent = label('enter')
    panel.setAttribute('aria-label', label('title')); image.alt = label('imageAlt'); el('candidates').setAttribute('aria-label', label('candidates')); el('search').placeholder = label('search')
    for (const node of panel.querySelectorAll('[data-inspection-key]')) node.textContent = label(node.dataset.inspectionKey)
    for (const select of panel.querySelectorAll('select')) for (const option of select.options) if (option.dataset.key) option.textContent = label(option.dataset.key)
    for (const node of panel.querySelectorAll('[data-inspection-label]')) node.setAttribute('aria-label', label(node.dataset.inspectionLabel))
    el('refresh').disabled = !context || !confirmed || !!controller
    el('cancel').hidden = !controller
    const historical = snapshot && context && snapshot.screenEpoch !== context.screenEpoch
    el('status').textContent = label(!confirmed ? 'unconfirmed' : controller ? 'capturing' : message === 'error' ? snapshot ? 'retained' : 'error' : historical ? 'historical' : snapshot ? 'ready' : message)
    el('time').textContent = snapshot ? `${label('captured')} ${new Date(snapshot.captureEndedAt).toLocaleTimeString()}` : ''
    el('warning').textContent = snapshot?.structure.truncated ? label('truncated') : label('atomic')
    el('selection-status').textContent = selected ? label('selectionNotice') : ''
    if (snapshot) { renderList(); renderDetails(); layout() }
    renderDraft()
  }
  function filter() {
    const spec = { op: 'find', visibleOnly: el('visible').checked, actionableOnly: el('actionable').checked, limit: 50 }
    const text = el('search').value
    if (text) spec[el('search-mode').value] = text
    if (el('role').value) spec.role = el('role').value
    if (el('region').value) spec.region = el('region').value
    return spec
  }
  function searching() { return !!el('search').value || !!el('role').value || !!el('region').value || el('actionable').checked || el('visible').checked }
  function renderList() {
    const focusedId = document.activeElement?.dataset.nodeId
    list.replaceChildren()
    const idx = structureIndex(snapshot.structure.nodes)
    let nodes = [], total = 0
    try {
      if (searching()) {
        let offset = 0
        while (nodes.length < shown) { const page = queryStructure({ nodes: snapshot.structure.nodes, viewport: snapshot.viewport }, { ...filter(), limit: Math.min(50, shown - nodes.length), offset }); nodes.push(...page.nodes); total = page.page.totalMatches; if (page.page.nextOffset === undefined) break; offset = page.page.nextOffset }
      } else {
        function visit(n) { nodes.push(n); if (expanded.has(n.nodeId)) for (const child of idx.children.get(n.nodeId) ?? []) visit(child) }
        for (const n of snapshot.structure.nodes) if (!n.parentId || !idx.byId.has(n.parentId)) visit(n)
        total = nodes.length; nodes = nodes.slice(0, shown)
      }
    } catch { el('empty').textContent = label('invalidSearch'); el('more').hidden = true; return }
    el('empty').textContent = nodes.length ? '' : label(snapshot.structure.truncated ? 'emptyTruncated' : 'empty')
    for (const n of nodes) {
      const row = document.createElement('button'); row.type = 'button'; row.dataset.nodeId = n.nodeId; row.setAttribute('role', 'treeitem')
      row.setAttribute('aria-level', String((idx.depths.get(n.nodeId) ?? 0) + 1)); row.setAttribute('aria-selected', String(n.nodeId === selected)); row.tabIndex = n.nodeId === (focusedId ?? selected ?? nodes[0]?.nodeId) ? 0 : -1
      const children = idx.children.get(n.nodeId) ?? []
      if (children.length) row.setAttribute('aria-expanded', String(expanded.has(n.nodeId)))
      row.style.paddingInlineStart = `${10 + Math.min(idx.depths.get(n.nodeId) ?? 0, 8) * 12}px`
      row.textContent = `${children.length ? expanded.has(n.nodeId) ? '▾ ' : '▸ ' : ''}${label(`role.${n.role}`)} · ${n.sensitive ? label('sensitive') : n.name || n.text || n.identifier || n.nodeId}`
      row.onclick = () => { if (children.length) { if (expanded.has(n.nodeId)) expanded.delete(n.nodeId); else expanded.add(n.nodeId) } select(n.nodeId) }
      list.append(row)
    }
    el('more').hidden = nodes.length >= total
    if (focusedId) [...list.children].find(n => n.dataset.nodeId === focusedId)?.focus({ preventScroll: true })
  }
  function select(id) { selected = id; chosenSelector = null; renderList(); renderDetails(); renderDraft(); layout(); el('selection-status').textContent = label('selectionNotice') }
  function freshSelection() { return Boolean(confirmed && snapshot && context && selected && snapshot.screenEpoch === context.screenEpoch && Date.parse(snapshot.expiresAt) > Date.now()) }
  function renderDraft() {
    handoff.textContent = document.documentElement.lang === 'zh-CN' ? '交接到用例向导' : 'Send to case authoring'
    handoff.disabled = !draftBinding || !confirmed || context?.generationToken !== draftBinding.generationToken || context?.screenEpoch !== draftBinding.screenEpoch || Date.parse(draftBinding.expiresAt) <= Date.now() || !el('draft').value.trim()
    const options = el('selector-options'); options.replaceChildren()
    const choices = freshSelection() && ['ios', 'android'].includes(snapshot.platform) ? selectorCandidates(snapshot.structure, selected, snapshot.platform) : []
    for (const [index, candidate] of choices.entries()) {
      const button = document.createElement('button'); button.type = 'button'
      button.textContent = `${candidate.kind} · ${JSON.stringify(candidate.selector)} · ${candidate.matchCount} match(es) · ${label('selectorRisk')}: ${candidate.risk.join(', ')}`
      button.setAttribute('aria-pressed', String(chosenSelector === index))
      button.onclick = () => { chosenSelector = index; renderDraft() }
      options.append(button)
    }
    if (!choices.length) { const hint = document.createElement('p'); hint.textContent = label(freshSelection() ? 'noSelector' : 'selectorStale'); options.append(hint) }
    else { const hint = document.createElement('p'); hint.textContent = label('selectorCurrent'); options.append(hint) }
    const chosen = choices[chosenSelector ?? -1]
    el('add-tap').disabled = !chosen || chosen.matchCount !== 1
    el('add-assert').disabled = !chosen || chosen.matchCount !== 1
    const ready = freshSelection() ? readinessCandidate(snapshot.structure, selected) : null
    el('add-ready-tap').disabled = !ready
    el('add-ready-assert').disabled = !ready
    el('ready-target').textContent = ready ? JSON.stringify(ready) : ''
    el('add-wait').disabled = !snapshot || !['ios', 'android'].includes(snapshot.platform)
    el('validate').disabled = Boolean(draftValidation) || !el('draft').value.trim()
    el('copy').disabled = !el('draft').value.trim()
    el('download').disabled = !el('draft').value.trim()
    el('use-draft').disabled = !el('draft').value.trim()
    el('draft-status').textContent = draftStatus.startsWith('error:') ? draftStatus.slice(6) : draftStatus ? label(draftStatus) : ''
  }
  function appendStep(step) {
    const editor = el('draft')
    if (editor.value.trim() && draftBinding && (draftBinding.generationToken !== snapshot?.generationToken || draftBinding.screenEpoch !== snapshot?.screenEpoch)) { draftStatus = `error:${document.documentElement.lang === 'zh-CN' ? '已有草稿来自之前的快照；请先保留或导出，再创建新草稿。' : 'Existing draft belongs to an earlier snapshot; preserve/export it before creating a new draft.'}`; renderDraft(); return }
    draftBinding = { generationToken: snapshot?.generationToken, screenEpoch: snapshot?.screenEpoch, expiresAt: snapshot?.expiresAt }
    if (!editor.value.trim()) editor.value = `name: "Inspector draft"\nplatform: ${snapshot?.platform ?? 'ios'}\nappId: ${JSON.stringify(snapshot?.appId ?? '')}\n---\n- launchApp\n`
    editor.value = `${editor.value.trimEnd()}\n- ${JSON.stringify(step)}\n`
    draftRevision++; draftValidation?.abort(); draftStatus = ''; draftIssues = []; renderDraft()
  }
  function renderDetails() {
    details.replaceChildren()
    if (!selected) { details.textContent = label('select'); return }
    const node = queryStructure({ nodes: snapshot.structure.nodes, viewport: snapshot.viewport }, { op: 'get', nodeId: selected }).nodes[0]
    const line = (key, value) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label(key); dd.textContent = value === undefined || value === null ? label('unknown') : typeof value === 'boolean' ? label(value ? 'true' : 'false') : typeof value === 'object' ? JSON.stringify(value) : String(value); details.append(dt, dd) }
    for (const key of ['nodeId', 'parentId', 'role', 'platformRole', 'identifier', 'name', 'text', 'value', 'visible', 'enabled', 'actionable', 'focused', 'selected', 'checked', 'sensitive', 'bounds', 'parentAvailable', 'capturedChildCount']) line(key, node[key])
    const parent = snapshot.structure.nodes.find(n => n.nodeId === node.parentId)
    line('distances', parentDistances(node.bounds, parent?.bounds))
    for (const n of [parent, ...snapshot.structure.nodes.filter(n => n.parentId === node.nodeId)].filter(Boolean)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${n === parent ? label('parent') : label('child')} · ${n.nodeId}`; b.onclick = () => select(n.nodeId); details.append(b) }
  }
  function layout() {
    if (!snapshot) return
    const available = el('scroll').clientWidth
    surface.style.width = `${Math.max(1, available) * scale}px`
    surface.style.height = `${Math.min(660, Math.max(240, available * snapshot.image.height / snapshot.image.width)) * scale}px`
    overlay.replaceChildren()
    const mapping = containMapping(snapshot.viewport, snapshot.image, { width: surface.clientWidth, height: surface.clientHeight })
    el('geometry-warning').textContent = mapping ? '' : label('geometry')
    if (!mapping || !selected) return
    const node = snapshot.structure.nodes.find(n => n.nodeId === selected), parent = snapshot.structure.nodes.find(n => n.nodeId === node?.parentId)
    for (const [n, kind] of [[parent, 'parent'], [node, 'selected']]) {
      const r = n?.bounds && mapping.rect(n.bounds)
      if (!r) continue
      const box = document.createElement('div'); box.className = `inspection-box ${kind}`; box.dataset.nodeId = n.nodeId
      Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` }); overlay.append(box)
    }
  }
  surface.onclick = event => {
    if (!snapshot) return
    const rect = surface.getBoundingClientRect(), mapping = containMapping(snapshot.viewport, snapshot.image, { width: surface.clientWidth, height: surface.clientHeight })
    const point = mapping?.point(event.clientX - rect.left, event.clientY - rect.top)
    if (!point) return
    candidates = hitCandidates(snapshot.structure.nodes, snapshot.viewport, point, structureIndex(snapshot.structure.nodes).depths)
    el('candidates').replaceChildren()
    for (const n of candidates) { const b = document.createElement('button'); b.type = 'button'; b.textContent = `${label(`role.${n.role}`)} · ${n.sensitive ? label('sensitive') : n.name || n.identifier || n.nodeId}`; b.onclick = () => select(n.nodeId); el('candidates').append(b) }
    if (candidates[0]) select(candidates[0].nodeId)
  }
  async function capture() {
    if (!context || !confirmed || controller) return
    const request = ++sequence, generation = context.generationToken
    controller = new AbortController(); const active = controller; message = 'hint'
    panel.hidden = false; render()
    let candidateUrl = null
    const timeout = setTimeout(() => active.abort(), 10_000)
    try {
      const response = await fetch('/api/inspection/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: active.signal })
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 12 * 1024 * 1024) throw new Error('capture')
      const reader = response.body.getReader(); const chunks = []; let size = 0
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 12 * 1024 * 1024) { active.abort(); throw new Error('size') } chunks.push(part.value) }
      const data = new Uint8Array(size); let offset = 0; for (const c of chunks) { data.set(c, offset); offset += c.length }
      const candidate = JSON.parse(new TextDecoder().decode(data))
      if (!candidate.structure || candidate.structure.nodes.length > 500 || new TextEncoder().encode(JSON.stringify(candidate.structure)).length > 256 * 1024 || candidate.image?.contentType !== 'image/png' || typeof candidate.image.base64 !== 'string') throw new Error('shape')
      structureIndex(candidate.structure.nodes)
      const { width, height } = candidate.image
      if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 16384) || width * height > 16777216) throw new Error('dimensions')
      const raw = atob(candidate.image.base64)
      if (raw.length > 8 * 1024 * 1024) throw new Error('size')
      const png = Uint8Array.from(raw, c => c.charCodeAt(0)); const header = new DataView(png.buffer)
      if (png.length < 24 || header.getUint32(16) !== width || header.getUint32(20) !== height) throw new Error('header')
      candidateUrl = URL.createObjectURL(new Blob([png], { type: 'image/png' }))
      const decoded = new Image(); decoded.src = candidateUrl; await decoded.decode()
      if (decoded.naturalWidth !== width || decoded.naturalHeight !== height) throw new Error('decode')
      if (active.signal.aborted || request !== sequence || !confirmed || !context || context.generationToken !== generation || candidate.generationToken !== generation || candidate.screenEpoch !== context.screenEpoch || Date.parse(candidate.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(candidate.expiresAt))) throw new Error('context')
      release(); snapshot = candidate; delete snapshot.image.base64; url = candidateUrl; candidateUrl = null; image.src = url
      const index = structureIndex(snapshot.structure.nodes); for (const n of snapshot.structure.nodes) if ((index.depths.get(n.nodeId) ?? 0) <= 1) expanded.add(n.nodeId)
      mode = 'inspect'; live.classList.add('inspection-hidden'); message = 'ready'; shown = 50
      ttl = setTimeout(() => { release(); message = 'expired'; render() }, Math.min(60_000, Date.parse(snapshot.expiresAt) - Date.now()))
    } catch { if (request === sequence) message = active.signal.aborted ? 'cancelled' : 'error' }
    finally { clearTimeout(timeout); if (candidateUrl) URL.revokeObjectURL(candidateUrl); if (request === sequence) { controller = null; render() } }
  }
  list.onkeydown = event => {
    const rows = [...list.children], index = rows.indexOf(document.activeElement), row = rows[index]
    if (!row) return
    let next = index
    if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, index + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = rows.length - 1
    else if (event.key === 'ArrowRight') {
      if (expanded.has(row.dataset.nodeId)) { const child = snapshot.structure.nodes.find(n => n.parentId === row.dataset.nodeId); const target = rows.find(n => n.dataset.nodeId === child?.nodeId); if (target) next = rows.indexOf(target) }
      else { expanded.add(row.dataset.nodeId); renderList() }
    }
    else if (event.key === 'ArrowLeft') { if (expanded.has(row.dataset.nodeId)) { expanded.delete(row.dataset.nodeId); renderList() } else { const n = snapshot.structure.nodes.find(n => n.nodeId === row.dataset.nodeId); if (n?.parentId) { const target = rows.find(r => r.dataset.nodeId === n.parentId); if (target) next = rows.indexOf(target); select(n.parentId) } } }
    else if (event.key === 'Enter' || event.key === ' ') select(row.dataset.nodeId)
    else return
    event.preventDefault(); const targetId = rows[next]?.dataset.nodeId; const currentRows = [...list.children]; const target = currentRows.find(n => n.dataset.nodeId === targetId); if (target) { currentRows.forEach(n => { n.tabIndex = -1 }); target.tabIndex = 0; target.focus() }
  }
  let debounce
  for (const id of ['search', 'search-mode', 'role', 'region', 'visible', 'actionable']) el(id).addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { shown = 50; if (snapshot) renderList() }, 100) })
  el('more').onclick = () => { shown += 50; renderList() }
  el('add-tap').onclick = () => { const choice = freshSelection() && ['ios', 'android'].includes(snapshot.platform) ? selectorCandidates(snapshot.structure, selected, snapshot.platform)[chosenSelector ?? -1] : null; if (choice?.matchCount === 1) appendStep({ tap: choice.selector }) }
  for (const [button, operation] of [['add-ready-tap', 'tapReady'], ['add-ready-assert', 'assertReady']]) el(button).onclick = () => {
    const target = freshSelection() ? readinessCandidate(snapshot.structure, selected) : null
    if (target) appendStep({ [operation]: { target, timeoutMs: 5000 } })
  }
  el('add-assert').onclick = () => { const choice = freshSelection() && ['ios', 'android'].includes(snapshot.platform) ? selectorCandidates(snapshot.structure, selected, snapshot.platform)[chosenSelector ?? -1] : null; if (choice?.matchCount === 1) appendStep({ assertVisible: choice.selector }) }
  el('add-wait').onclick = () => appendStep({ wait: 1 })
  el('draft').addEventListener('input', () => { draftRevision++; draftValidation?.abort(); draftStatus = ''; draftIssues = []; el('draft-issues').replaceChildren(); renderDraft() })
  el('validate').onclick = async () => {
    if (draftValidation) return
    const revision = draftRevision, active = new AbortController(); draftValidation = active; draftStatus = 'validatingDraft'; renderDraft()
    try {
      const response = await fetch('/api/workbench/drafts/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yaml: el('draft').value }), signal: active.signal })
      const result = await response.json()
      if (revision !== draftRevision || active.signal.aborted) { draftStatus = 'draftChanged'; return }
      draftIssues = [...(result.blockers ?? []), ...(result.advice ?? [])]
      el('draft-issues').replaceChildren(...draftIssues.map(issue => {
        const row = document.createElement('p'); row.className = issue.severity === 'advice' ? 'wb-note' : 'wb-error'
        row.textContent = `${label(issue.severity === 'advice' ? 'draftAdvice' : 'draftError')}${issue.line ? ` · line ${issue.line}` : ''}: ${issue.message}`
        return row
      }))
      draftStatus = response.ok && result.valid ? 'draftValid' : `error:${result.error ?? result.blockers?.[0]?.message ?? result.message ?? 'Draft validation failed'}`
    } catch (error) { if (revision === draftRevision && !active.signal.aborted) draftStatus = `error:${error.message}` }
    finally { if (draftValidation === active) draftValidation = null; renderDraft() }
  }
  el('copy').onclick = async () => { try { await navigator.clipboard.writeText(el('draft').value); draftStatus = 'draftCopied' } catch (error) { draftStatus = `error:${error.message}` } renderDraft() }
  el('download').onclick = () => {
    const href = URL.createObjectURL(new Blob([el('draft').value], { type: 'text/yaml' }))
    const link = document.createElement('a'); link.href = href; link.download = 'mobile-mirror-draft.yaml'; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000)
    draftStatus = 'draftDownloaded'; renderDraft()
  }
  el('use-draft').onclick = () => { window.dispatchEvent(new CustomEvent('mobile-mirror:inspector-draft', { detail: { yaml: el('draft').value } })) }
  enter.onclick = capture; el('refresh').onclick = capture; el('cancel').onclick = () => { cancel(); message = 'cancelled'; render() }; el('live').onclick = () => close(true)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); close(true) } })
  window.addEventListener('pagehide', () => close())
  new ResizeObserver(layout).observe(el('scroll'))
  render()
  return { setContext, unconfirmed, clear: () => close(), render, setZoom(value) { scale = value; layout() } }
}
