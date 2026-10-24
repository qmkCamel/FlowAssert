const copy = {
  'zh-CN': { title: '本机设备矩阵', boundary: '最多两个已登记槽位。显式启动／取消／复跑；旧单设备控制不切换目标。所有失败与复验均保留。', load: '读取登记计划', plan: '计划', validate: '检查资源', consent: '允许执行已登记计划并在本机保存证据', start: '启动矩阵', refresh: '刷新矩阵历史', cancel: '取消整个矩阵', slot: '查看槽位', cancelSlot: '取消选中槽', media: '读取选中槽画面', cell: '复跑单元 ID', retry: '确认旧会话结束并安全复跑', working: '正在处理…', failed: '操作失败；保留已有结果', complete: '操作已完成', history: '矩阵历史', empty: '尚无矩阵', confirm: '仅执行已登记的计划和安全重置。确认？', late: '当前选择已变化，忽略旧响应', headers: ['单元', '槽位', '状态', '阶段', '尝试', '验证分项／原因'] },
  en: { title: 'Local device matrix', boundary: 'Up to two registered slots. Explicit start/cancel/retry; existing single-device controls never change target. All attempts remain visible.', load: 'Load registered plans', plan: 'Plan', validate: 'Validate resources', consent: 'Allow the registered plan and local evidence storage', start: 'Start matrix', refresh: 'Refresh matrix history', cancel: 'Cancel whole matrix', slot: 'Selected slot', cancelSlot: 'Cancel selected slot', media: 'Read selected slot image', cell: 'Cell ID to retry', retry: 'Confirm prior cleanup and safely retry', working: 'Working…', failed: 'Operation failed; previous result retained', complete: 'Operation complete', history: 'Matrix history', empty: 'No matrix yet', confirm: 'Run only the registered plan and safe reset. Confirm?', late: 'Selection changed; old response ignored', headers: ['Cell', 'Slot', 'Status', 'Phase', 'Attempt', 'Verification / reason'] },
}
export function createMatrixPanel({ panel }) {
  const root = document.createElement('details'); root.id = 'wb-matrix'; root.className = 'wb-change-acceptance'
  const head = document.createElement('summary'), body = document.createElement('div'); root.append(head, body); panel.append(root)
  const t = key => copy[document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'][key], labels = []
  const node = (tag, key) => { const n = document.createElement(tag); if (key) labels.push([n, key]); return n }
  const field = (id, key, tag = 'input') => { const label = node('label'), n = node(tag); n.id = `matrix-${id}`; label.append(node('span', key), n); body.append(label); return n }
  const button = (id, key, fn) => { const b = node('button', key); b.id = `matrix-${id}`; b.type = 'button'; b.className = 'ghost'; b.onclick = fn; body.append(b); return b }
  body.append(node('p', 'boundary'))
  let selected = null, generation = 0, latest = null, mutations = new Set(), poll = null, mediaGeneration = 0
  const request = async (path, value) => { const response = await fetch(`/api/workbench/matrices${path}`, { ...(value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }), signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`matrix-http-${response.status}`); return response.json() }
  const plan = field('plan', 'plan', 'select')
  button('load', 'load', () => action('load', async () => { const catalog = await request('/catalog'); plan.replaceChildren(...catalog.plans.map(p => new Option(p.id, p.id))) }))
  button('validate', 'validate', () => action('validate', async () => { await request('/validate', { planId: plan.value }) }))
  const consent = field('consent', 'consent'); consent.type = 'checkbox'
  const start = button('start', 'start', () => action('start', async () => {
    if (!consent.checked || !plan.value) throw new Error('matrix-consent-required')
    const token = generation
    const result = await request('', { planId: plan.value, confirm: `START ${plan.value}`, localEvidence: true }); if (token === generation) { select(result); status.textContent = t('complete') }; await refresh()
  }))
  button('refresh', 'refresh', () => action('refresh', refresh))
  const cancelAll = button('cancel', 'cancel', () => mutate('cancel', '/cancel', { confirm: `CANCEL ${selected}` }))
  const slots = field('slot', 'slot', 'select'); slots.onchange = () => { mediaGeneration++; image.removeAttribute('src'); image.hidden = true; controls() }
  const cancelSlot = button('cancel-slot', 'cancelSlot', () => mutate(`cancel-${slots.value}`, '/cancel', { slotId: slots.value, confirm: `CANCEL ${selected} ${slots.value}` }))
  button('media', 'media', () => action('media', async () => {
    const id = selected, slot = slots.value, token = ++mediaGeneration
    const frame = await request(`/${id}/preview?slot=${encodeURIComponent(slot)}`)
    if (id !== selected || slot !== slots.value || token !== mediaGeneration || frame.matrixId !== id || frame.slotId !== slot) return
    if (!['image/png', 'image/svg+xml', 'image/jpeg'].includes(frame.contentType) || typeof frame.base64 !== 'string' || frame.base64.length > 6 * 1024 * 1024) throw new Error('matrix-media-invalid')
    image.src = `data:${frame.contentType};base64,${frame.base64}`
    image.hidden = false
  }))
  const image = node('img'); image.id = 'matrix-image'; image.alt = 'Selected matrix slot'; image.hidden = true; image.style.maxWidth = '100%'; body.append(image)
  const cell = field('cell', 'cell')
  const retry = button('retry', 'retry', () => { if (window.confirm(t('confirm'))) void mutate('retry', '/retry', { cellId: cell.value, confirm: `RETRY ${selected} ${cell.value}` }) })
  const status = node('p'); status.id = 'matrix-status'; status.setAttribute('role', 'status'); body.append(status)
  const summary = node('p'); summary.id = 'matrix-summary'; body.append(summary)
  const table = node('table'); table.id = 'matrix-results'; const scroll = node('div'); scroll.style.overflowX = 'auto'; scroll.append(table); body.append(scroll)
  body.append(node('h4', 'history')); const history = node('div'); history.id = 'matrix-history'; body.append(history)
  function controls() {
    start.disabled = mutations.has('start') || latest && latest.phase !== 'finished'
    cancelAll.disabled = !selected || latest?.phase === 'finished' || mutations.has('cancel')
    cancelSlot.disabled = !selected || latest?.phase === 'finished' || mutations.has(`cancel-${slots.value}`)
    retry.disabled = !selected || latest?.phase !== 'finished' || mutations.has('retry')
  }
  async function action(key, fn) {
    if (mutations.has(key)) return
    const token = generation
    mutations.add(key); const b = root.querySelector(`#matrix-${key}`); if (b) b.disabled = true
    controls(); status.textContent = t('working')
    try { await fn(); if (token === generation) status.textContent = t('complete') } catch (error) { if (token === generation) status.textContent = `${t('failed')}: ${String(error.message).slice(0, 160)}` }
    finally { mutations.delete(key); if (b) b.disabled = false; controls() }
  }
  async function mutate(key, path, data) {
    const id = selected, token = generation
    await action(key, async () => { const result = await request(`/${id}${path}`, data); if (id === selected && token === generation) { latest = result; draw(); schedule() }; await refresh() })
  }
  function select(value) { generation++; mediaGeneration++; selected = value.id; latest = value; image.removeAttribute('src'); image.hidden = true; draw(); schedule() }
  function draw() {
    if (!latest) { summary.textContent = t('empty'); return }
    summary.textContent = `${latest.id} · ${latest.phase} · ${latest.exitCode ?? '—'} · ${latest.completedAt || latest.createdAt}`
    const slot = slots.value; slots.replaceChildren(...latest.slots.map(s => new Option(`${s.id} · ${s.platform} · ${s.phase}`, s.id))); if ([...slots.options].some(o => o.value === slot)) slots.value = slot
    table.replaceChildren(); const header = node('tr'); for (const label of t('headers')) { const th = node('th'); th.textContent = label; header.append(th) }; table.append(header)
    for (const c of latest.cells) for (const a of c.attempts) { const tr = node('tr'); for (const value of [c.id, c.slotId, a.status, a.phase, a.id.slice(0, 8), `${Object.entries(a.verification || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')} ${a.reason || ''}`]) { const td = node('td'); td.textContent = value; tr.append(td) }; table.append(tr) }
    controls()
  }
  async function refresh() {
    const rows = await request(''); history.replaceChildren()
    for (const row of rows.reverse()) { const b = node('button'); b.textContent = `${row.id.slice(0, 8)} · ${row.phase} · ${row.exitCode ?? '—'}`; b.onclick = async () => { const token = ++generation; mediaGeneration++; try { const current = await request(`/${row.id}`); if (token === generation) select(current) } catch { status.textContent = t('failed') } }; history.append(b) }
  }
  function schedule() {
    clearTimeout(poll); if (!selected || latest?.phase === 'finished') return
    const id = selected, token = generation
    poll = setTimeout(async () => { try { const result = await request(`/${id}`); if (id !== selected || token !== generation) return; latest = result; draw(); if (result.phase === 'finished') await refresh(); else schedule() } catch { if (id === selected && token === generation) { status.textContent = t('failed'); schedule() } } }, 300)
  }
  function render() { head.textContent = t('title'); for (const [n, key] of labels) n.textContent = t(key); draw(); controls() }
  render(); return { render }
}
