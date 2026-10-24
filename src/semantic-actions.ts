import { screenError } from './screen-errors.js'
import type { ScreenRect, TextInputMode } from './types.js'

export function nodeTapPoint(bounds: ScreenRect | undefined, viewport: ScreenRect): { x: number; y: number } {
  const intersection = requirePositiveVisibleBounds(bounds, viewport)
  return {
    x: Math.floor(intersection.x + intersection.width / 2),
    y: Math.floor(intersection.y + intersection.height / 2),
  }
}

export function requirePositiveVisibleBounds(bounds: ScreenRect | undefined, viewport: ScreenRect): ScreenRect {
  if (!bounds || !validPositiveRect(bounds) || !validPositiveRect(viewport)) throw screenError('screen_node_not_actionable')
  const x = Math.max(bounds.x, viewport.x)
  const y = Math.max(bounds.y, viewport.y)
  const right = Math.min(bounds.x + bounds.width, viewport.x + viewport.width)
  const bottom = Math.min(bounds.y + bounds.height, viewport.y + viewport.height)
  if (![x, y, right, bottom].every(Number.isFinite) || right <= x || bottom <= y) throw screenError('screen_node_not_actionable')
  return { x, y, width: right - x, height: bottom - y }
}

export function validatePublicText(text: string, mode: TextInputMode): void {
  if ((mode === 'append' && text.length === 0)
    || [...text].length > 512
    || Buffer.byteLength(text, 'utf8') > 4 * 1024
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(text)) {
    throw screenError('screen_text_input_invalid')
  }
}

export function isSensitivePlatformRole(value: string | undefined): boolean {
  return /password|secure[-_ ]?text/i.test(value ?? '')
}

function validPositiveRect(rect: ScreenRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0
}
