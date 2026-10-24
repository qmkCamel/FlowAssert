import { copy } from './journey-common.js'

import { sourceRectangle, parseRectangles } from './report-mask-geometry.js'
export { sourceRectangle, parseRectangles } from './report-mask-geometry.js'
export function createRedactionEditor(root, { node, api, run, file, getValue, setValue, disabled }) {
  const details = node('details'), summary = node('summary', copy('打开图片并画框遮蔽', 'Open image and draw masks'))
  details.append(summary); root.append(details)
  let loaded = false, image, plane, selected = -1, rectangles = [], history = [], start, dragIndex, dragOriginal
  const status = node('p', undefined, 'wb-note'); status.setAttribute('role', 'status')
  const tools = node('div', undefined, 'wb-row'), list = node('select'), numbers = ['x', 'y', 'width', 'height'].map(key => {
    const input = node('input'); input.type = 'number'; input.min = key === 'x' || key === 'y' ? '0' : '1'; input.setAttribute('aria-label', `${key} ${copy('源像素', 'source pixels')}`); return input
  })
  list.setAttribute('aria-label', copy('选择遮罩', 'Select mask'))
  const control = (zh, en, fn) => { const value = node('button', copy(zh, en), 'text-button'); value.type = 'button'; value.onclick = fn; tools.append(value); return value }
  const save = (next, index = selected) => {
    if (disabled()) return
    if (next.length > 64 || next.some(r => r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > image.naturalWidth || r.y + r.height > image.naturalHeight)) { status.textContent = copy('遮罩超出图像或超过 64 个。', 'Masks exceed image bounds or the 64-mask limit.'); return }
    history.push(rectangles.map(r => ({ ...r }))); rectangles = next; selected = index
    setValue(rectangles.map(r => `${r.x},${r.y},${r.width},${r.height}`).join(';')); paint()
    status.textContent = copy(`${rectangles.length} 个遮罩；预览前不会改动原图。`, `${rectangles.length} masks; original image is preserved.`)
  }
  function paint() {
    for (const mask of plane.querySelectorAll('.redaction-mask')) mask.remove()
    list.replaceChildren()
    rectangles.forEach((rect, index) => {
      const option = node('option', `${index + 1}: ${rect.x},${rect.y},${rect.width},${rect.height}`); option.value = String(index); option.selected = index === selected; list.append(option)
      const mask = node('div', undefined, `redaction-mask${index === selected ? ' selected' : ''}`); mask.dataset.index = String(index)
      Object.assign(mask.style, { left: `${rect.x / image.naturalWidth * 100}%`, top: `${rect.y / image.naturalHeight * 100}%`, width: `${rect.width / image.naturalWidth * 100}%`, height: `${rect.height / image.naturalHeight * 100}%` }); plane.append(mask)
    })
    numbers.forEach((input, index) => { input.value = rectangles[selected]?.[['x', 'y', 'width', 'height'][index]] ?? ''; input.disabled = selected < 0 || disabled() })
  }
  list.onchange = () => { selected = Number(list.value); paint() }
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded || disabled()) return
    loaded = true; status.textContent = copy('正在读取图片，可继续操作其他页面…', 'Reading image; other navigation remains available…'); details.append(status)
    try {
      const response = await fetch(`/api/runs/${run.id}/artifacts/${encodeURIComponent(file.name)}`)
      if (!response.ok) throw new Error(`Image ${response.status}`)
      const blob = await response.blob(); if (blob.size > 4 * 1024 * 1024) throw new Error('Image exceeds budget'); const url = URL.createObjectURL(blob)
      image = node('img'); image.alt = copy('原始截图，仅供本机遮蔽审查', 'Original screenshot for local redaction review'); image.src = url
      try { await image.decode() } finally { URL.revokeObjectURL(url) }
      plane = node('div', undefined, 'redaction-plane'); plane.style.width = `${Math.min(600, image.naturalWidth * 600 / image.naturalHeight)}px`; plane.tabIndex = 0; plane.setAttribute('role', 'group'); plane.setAttribute('aria-label', copy('拖动画框；选中遮罩后用方向键移动，Delete 删除', 'Drag to draw; arrow keys move selected mask, Delete removes it')); plane.append(image)
      rectangles = parseRectangles(getValue()); selected = rectangles.length ? 0 : -1
      tools.append(list, ...numbers)
      control('添加遮罩', 'Add mask', () => save([...rectangles, { x: 0, y: 0, width: Math.min(100, image.naturalWidth), height: Math.min(100, image.naturalHeight) }], rectangles.length))
      control('应用坐标', 'Apply coordinates', () => { if (selected < 0) return; const rect = Object.fromEntries(['x','y','width','height'].map((key, i) => [key, Number(numbers[i].value)])); if (Object.values(rect).some(value => !Number.isSafeInteger(value))) return; save(rectangles.map((r, i) => i === selected ? rect : r)) })
      control('删除', 'Remove', () => { if (selected >= 0) save(rectangles.filter((_, i) => i !== selected), -1) })
      control('撤销', 'Undo', () => { const previous = history.pop(); if (!previous || disabled()) return; rectangles = previous; selected = rectangles.length ? 0 : -1; setValue(rectangles.map(r => `${r.x},${r.y},${r.width},${r.height}`).join(';')); paint() })
      plane.onpointerdown = event => { if (disabled() || event.button !== 0) return; event.preventDefault(); start = { x: event.clientX, y: event.clientY }; dragIndex = event.target.dataset.index === undefined ? -1 : Number(event.target.dataset.index); if (dragIndex >= 0) { selected = dragIndex; dragOriginal = { ...rectangles[selected] }; paint() }; plane.setPointerCapture(event.pointerId) }
      plane.onpointerup = event => {
        if (!start || disabled()) return
        const end = { x: event.clientX, y: event.clientY }, bounds = image.getBoundingClientRect()
        if (dragIndex >= 0) {
          const x = Math.max(0, Math.min(image.naturalWidth - dragOriginal.width, Math.round(dragOriginal.x + (end.x - start.x) * image.naturalWidth / bounds.width)))
          const y = Math.max(0, Math.min(image.naturalHeight - dragOriginal.height, Math.round(dragOriginal.y + (end.y - start.y) * image.naturalHeight / bounds.height)))
          save(rectangles.map((r, i) => i === dragIndex ? { ...r, x, y } : r))
        } else { const rect = sourceRectangle(start, end, bounds, image.naturalWidth, image.naturalHeight); if (rect.width && rect.height) save([...rectangles, rect], rectangles.length) }
        start = undefined
      }
      plane.onpointercancel = () => { start = undefined }
      plane.onkeydown = event => {
        if (selected < 0 || disabled()) return
        if (event.key === 'Delete') { event.preventDefault(); save(rectangles.filter((_, i) => i !== selected), -1); return }
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
        if (!delta) return; event.preventDefault(); const r = rectangles[selected], amount = event.shiftKey ? 10 : 1
        save(rectangles.map((rect, i) => i === selected ? { ...r, x: r.x + delta[0] * amount, y: r.y + delta[1] * amount } : rect))
      }
      details.append(tools, plane); paint(); status.textContent = copy('拖动画框，或添加遮罩后编辑源像素坐标。', 'Drag to draw, or add a mask and edit source-pixel coordinates.')
    } catch (error) { loaded = false; status.textContent = copy(`图片不可用：${error.message}；可重新打开重试。`, `Image unavailable: ${error.message}; reopen to retry.`) }
  })
  return { sync() { if (!image || !plane) return; try { rectangles = parseRectangles(getValue()); selected = rectangles.length ? 0 : -1; paint() } catch (error) { status.textContent = error.message } } }
}
