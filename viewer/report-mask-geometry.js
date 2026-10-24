/** CSS client coordinates map to source pixels; no DPR multiplier belongs here. */
export function sourceRectangle(start, end, bounds, width, height) {
  if (!(bounds.width > 0 && bounds.height > 0 && width > 0 && height > 0)) throw new Error('Image dimensions unavailable')
  const x = value => Math.max(0, Math.min(width, (value - bounds.left) * width / bounds.width))
  const y = value => Math.max(0, Math.min(height, (value - bounds.top) * height / bounds.height))
  const left = Math.floor(Math.min(x(start.x), x(end.x))), top = Math.floor(Math.min(y(start.y), y(end.y)))
  const right = Math.ceil(Math.max(x(start.x), x(end.x))), bottom = Math.ceil(Math.max(y(start.y), y(end.y)))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
export function parseRectangles(value) {
  if (!value.trim()) return []
  const result = value.split(';').map(chunk => {
    const values = chunk.split(',').map(part => Number(part.trim()))
    if (values.length !== 4 || values.some(value => !Number.isSafeInteger(value)) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0) throw new Error('Use x,y,width,height; positive source-pixel dimensions')
    return { x: values[0], y: values[1], width: values[2], height: values[3] }
  })
  if (result.length > 64) throw new Error('Maximum 64 masks per image')
  return result
}
