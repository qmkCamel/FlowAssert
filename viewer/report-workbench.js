import { node, button, copy } from './journey-common.js'

export function stepCaption(step, locale = 'en') {
  const zh = locale === 'zh-CN'
  const names = { tap: ['点击', 'Tap'], tapReady: ['点击就绪控件', 'Tap ready target'], assert: ['检查预期', 'Check expectation'],
    assertVisible: ['检查可见', 'Check visible'], assertNotVisible: ['检查不可见', 'Check not visible'], wait: ['等待', 'Wait'], waitUntil: ['等待就绪', 'Wait until ready'],
    launchApp: ['打开应用', 'Launch app'], launch: ['打开应用', 'Launch app'], type: ['输入文字', 'Type text'], fillReady: ['填写就绪控件', 'Fill ready target'], swipe: ['滑动', 'Swipe'], scroll: ['滚动', 'Scroll'], done: ['完成', 'Done'] }
  const name = names[step.kind]?.[zh ? 0 : 1] ?? step.kind
  // Target descriptions are recorded facts, never inferred from pixels. Do not echo input text.
  const raw = ['type', 'fillReady', 'done', 'launchApp', 'launch'].includes(step.kind) ? '' : String(step.target ?? '')
  const target = raw.match(/(?:text|accessibilityId|id)\s*[:=]\s*["']([^"']+)["']/)?.[1] ?? raw
  return `${name}${target ? ` · ${target.slice(0, 100)}` : ''}`
}
export function stepDuration(step) {
  const duration = step.executionMs ?? (Date.parse(step.endedAt) - Date.parse(step.startedAt))
  return Number.isFinite(duration) && duration >= 0 ? duration < 1000 ? `${Math.round(duration)} ms` : `${(duration / 1000).toFixed(2)} s` : '—'
}
export function resultImage(step) {
  return step.evidence.find(file => file.contentType === 'image/png' && !file.incomplete && !/-action-\d+-before\.png$/.test(file.name))
}
export function actionPoints(record, width, height) {
  const v = record?.viewport, size = record?.image
  if (!['tap', 'swipe'].includes(record?.kind) || !['settled', 'unknown'].includes(record?.dispatch) || !v || !size || size.width !== width || size.height !== height
    || ![v.x, v.y, v.width, v.height, width, height].every(Number.isFinite) || v.width <= 0 || v.height <= 0 || width <= 0 || height <= 0
    || Math.abs(width / height - v.width / v.height) > .005 || !Array.isArray(record.points) || record.points.length !== (record.kind === 'tap' ? 1 : 2)) return null
  // Only full-screen coordinate frames have a provable mapping in this contract.
  if (v.x !== 0 || v.y !== 0) return null
  if (!record.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x < v.width && p.y >= 0 && p.y < v.height)) return null
  return record.points.map(p => ({ x: 100 * p.x / v.width, y: 100 * p.y / v.height }))
}

export async function readImage(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(copy('截图缺失或校验失败', 'Image missing or integrity failed'))
  const blob = await response.blob()
  if (blob.size > 4 * 1024 * 1024) throw new Error('Evidence budget exceeded')
  signal.throwIfAborted()
  const objectUrl = URL.createObjectURL(blob), img = node('img')
  const release = () => { URL.revokeObjectURL(objectUrl); img.removeAttribute('src') }
  signal.addEventListener('abort', release, { once: true }); img.src = objectUrl
  try { await img.decode(); signal.throwIfAborted(); return { img, release } }
  catch (error) { release(); throw error }
  finally { signal.removeEventListener('abort', release) }
}

export function createStepTimeline({ select, pause, link }) {
  const root = node('div', undefined, 'replay-timeline'), slider = node('input'), caption = node('label'), markers = node('div', undefined, 'replay-markers')
  slider.type = 'range'; slider.id = 'replay-seek'; slider.min = '0'; slider.step = '1'; caption.htmlFor = slider.id
  const strip = node('details', undefined, 'replay-filmstrip'), frames = node('div', undefined, 'replay-frames')
  strip.append(node('summary', copy('缩略图时间线（按需读取）', 'Thumbnail timeline (on demand)')), frames)
  root.append(caption, slider, markers, strip)
  let run, index = 0, controller, generation = 0, releases = [], windowKey = ''
  const clear = () => { controller?.abort(); generation++; for (const release of releases) release(); releases = []; windowKey = '' }
  slider.oninput = () => { const requested = slider.value; pause(); slider.value = requested; index = Number(requested); caption.textContent = copy(`定位步骤 ${index + 1}`, `Seek to step ${index + 1}`) }
  slider.onchange = () => { const step = run?.steps[Number(slider.value)]; if (step) select(step.index) }
  strip.ontoggle = () => { if (strip.open) renderWindow(); else { clear(); frames.replaceChildren() } }
  function renderWindow() {
    if (!run || !strip.open) return
    const start = Math.max(0, Math.min(index - 2, run.steps.length - 5)), selected = run.steps.slice(start, start + 5)
    const key = `${run.id}:${start}`
    if (windowKey === key) { for (const item of frames.querySelectorAll('button')) item.setAttribute('aria-current', String(Number(item.dataset.step) === run.steps[index]?.index)); return }
    clear(); windowKey = key; controller = new AbortController(); const signal = controller.signal, token = generation; frames.replaceChildren()
    const jobs = selected.map(step => {
      const item = button('', '', () => select(step.index)), text = node('span', `${step.index}. ${stepCaption(step, document.documentElement.lang)}`)
      item.dataset.step = step.index; item.setAttribute('aria-current', String(step.index === run.steps[index]?.index)); item.append(text); frames.append(item)
      return async () => {
        const file = resultImage(step)
        if (!file) { item.append(node('small', copy('未记录截图', 'No screenshot'))); return }
        const status = node('small', copy('加载中…', 'Loading…')); item.append(status)
        try {
          const loaded = await readImage(link(run, file), signal)
          if (token !== generation || signal.aborted) { loaded.release(); return }
          releases.push(loaded.release); loaded.img.alt = copy(`步骤 ${step.index} 缩略图`, `Step ${step.index} thumbnail`); item.prepend(loaded.img); status.remove()
        } catch { if (!signal.aborted && token === generation) status.textContent = copy('截图不可用', 'Image unavailable') }
      }
    })
    let cursor = 0
    const worker = async () => { while (cursor < jobs.length && !signal.aborted) await jobs[cursor++]() }
    void Promise.all([worker(), worker()])
  }
  return { root, configure(value, failures) {
    clear(); run = value; markers.replaceChildren(); frames.replaceChildren(); slider.max = String(Math.max(0, run.steps.length - 1)); slider.disabled = run.steps.length < 2
    for (const step of failures) { const marker = button(copy(`失败 ${step.index}`, `Failure ${step.index}`), copy(`失败 ${step.index}`, `Failure ${step.index}`), () => select(step.index)); marker.dataset.failure = step.index; markers.append(marker) }
  }, update(position) { index = Math.max(0, position); slider.value = String(index); caption.textContent = copy(`步骤时间线 · ${index + 1} / ${run?.steps.length ?? 0}`, `Step timeline · ${index + 1} / ${run?.steps.length ?? 0}`); slider.setAttribute('aria-valuetext', caption.textContent); renderWindow() }, clear }
}

export function createActionComparison({ run, step, link, pause }) {
  const details = node('details', undefined, 'action-comparison'), content = node('div'), status = node('p')
  details.append(node('summary', copy('动作前后对照与位置', 'Before / after & action position')), status, content)
  let controller, releases = [], generation = 0
  const clear = () => { controller?.abort(); generation++; releases.forEach(release => release()); releases = [] }
  const actions = step.actionEvidence?.version === 1 && Array.isArray(step.actionEvidence.actions) ? step.actionEvidence.actions.slice(0, 8).filter(action => action && typeof action === 'object') : []
  const select = node('select'); select.setAttribute('aria-label', copy('选择本步动作', 'Select action in step'))
  for (const [i, action] of actions.entries()) { const option = node('option', `${i + 1}. ${action.kind}`); option.value = String(i); select.append(option) }
  if (actions.length > 1) details.insertBefore(select, status)
  async function load() {
    clear(); content.replaceChildren(); pause()
    const record = actions[Number(select.value || 0)], before = step.evidence.find(file => file.name === record?.before && file.contentType === 'image/png' && !file.incomplete), after = step.evidence.find(file => file.name === step.actionEvidence?.after && file.contentType === 'image/png' && !file.incomplete)
    if (!before || !record) { status.textContent = copy('未记录本步动作前截图或位置；不根据其他截图推测。', 'Before-image or action position was not recorded; other screenshots are not substituted.'); return }
    controller = new AbortController(); const signal = controller.signal, token = generation
    status.textContent = copy('正在读取本步动作证据…可切换步骤', 'Loading action evidence… step navigation remains available')
    try {
      for (const [file, isBefore] of [[before, true], [after, false]]) {
        if (!file) { content.append(node('p', copy('执行后截图未记录', 'After-image not recorded'))); continue }
        const loaded = await readImage(link(run, file), signal)
        if (signal.aborted || token !== generation) { loaded.release(); return }
        releases.push(loaded.release)
        const figure = node('figure'), plane = node('div', undefined, 'action-image-plane')
        plane.style.aspectRatio = `${loaded.img.naturalWidth} / ${loaded.img.naturalHeight}`
        plane.style.width = `min(100%, ${Math.round(320 * loaded.img.naturalWidth / loaded.img.naturalHeight)}px)`
        loaded.img.alt = copy(`步骤 ${step.index} ${isBefore ? '动作前' : '执行后'}`, `Step ${step.index} ${isBefore ? 'before' : 'after'}`)
        figure.append(node('figcaption', loaded.img.alt), plane); plane.append(loaded.img)
        if (isBefore) {
          const points = actionPoints(record, loaded.img.naturalWidth, loaded.img.naturalHeight)
          if (points) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-label', copy('记录的动作位置', 'Recorded action position')); svg.setAttribute('role', 'img')
            if (points.length === 2) { const line = document.createElementNS(svg.namespaceURI, 'line'); for (const [key, value] of Object.entries({ x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y })) line.setAttribute(key, String(value)); svg.append(line) }
            points.forEach((p, i) => { const circle = document.createElementNS(svg.namespaceURI, 'circle'); circle.setAttribute('cx', p.x); circle.setAttribute('cy', p.y); circle.setAttribute('r', '2'); svg.append(circle); const text = document.createElementNS(svg.namespaceURI, 'text'); text.setAttribute('x', p.x + 3); text.setAttribute('y', p.y); text.textContent = points.length === 1 ? '●' : i ? 'END' : 'START'; svg.append(text) }); plane.append(svg)
          } else figure.append(node('p', copy('位置未验证或未派发，不绘制标记', 'Position unverified or not dispatched; no marker')))
        }
        content.append(figure)
      }
      status.textContent = copy(`步骤 ${step.index} · 派发：${({ settled: '已完成', unknown: '结果未知', 'not-dispatched': '未派发' })[record.dispatch] ?? '未知'} · ${record.capturedAt}`, `Step ${step.index} · Dispatch: ${record.dispatch} · ${record.capturedAt}`)
    } catch (error) { if (!signal.aborted && token === generation) { status.textContent = error.message; status.append(button('重试对照', 'Retry comparison', load)) } }
  }
  select.onchange = load
  details.ontoggle = () => { if (details.open) void load(); else { clear(); content.replaceChildren() } }
  return { root: details, clear() { details.open = false; clear(); content.replaceChildren() } }
}
