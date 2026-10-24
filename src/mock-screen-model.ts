import { deflateSync } from 'node:zlib'
import { screenError } from './screen-errors.js'
import type {
  MirrorAction,
  MobileAppState,
  ProviderAppManagementRequest,
  ProviderAppManagementResult,
  ScreenGeometry,
  ScreenObservationImage,
  ScreenStructure,
  TextInputMode,
} from './types.js'

const WIDTH = 390
const HEIGHT = 844
export const MOCK_SESSION_APP_ID = 'com.example.mobilemirror.mock'
export const MOCK_SECONDARY_APP_ID = 'com.example.mobilemirror.notes'

export class MockScreenModel {
  #actionCount = 0
  #lastAction = 'Waiting for an action'
  #focusedNodeId: 'n3' | 'n4' | null = null
  #inputValue = ''
  readonly #appStates = new Map<string, MobileAppState>([
    [MOCK_SESSION_APP_ID, 'foreground'],
    [MOCK_SECONDARY_APP_ID, 'not-running'],
  ])

  get revision(): number {
    return this.#actionCount
  }

  act(action: MirrorAction): void {
    this.#actionCount += 1
    this.#lastAction = describeAction(action)
    if (action.kind === 'tap') {
      this.#focusedNodeId = pointInRect(action.x, action.y, { x: 24, y: 420, width: 342, height: 64 })
        ? 'n3'
        : pointInRect(action.x, action.y, { x: 24, y: 500, width: 342, height: 64 }) ? 'n4' : null
    }
  }

  inputText(mode: TextInputMode, text: string): void {
    if (this.#focusedNodeId !== 'n3') throw screenError('screen_text_input_target_mismatch')
    this.#inputValue = mode === 'replace' ? text : this.#inputValue + text
    this.#actionCount += 1
    this.#lastAction = `Input ${mode} (${[...text].length} code points)`
  }

  manageApp(request: ProviderAppManagementRequest): ProviderAppManagementResult {
    const beforeState = this.#appStates.get(request.appId)
    if (!beforeState) throw screenError('app_not_installed')
    if (request.operation === 'activate') {
      if (beforeState === 'foreground') return { beforeState, afterState: beforeState, outcome: 'already-foreground' }
      this.#appStates.set(request.appId, 'foreground')
      this.#actionCount += 1
      this.#lastAction = 'Application activated'
      return { beforeState, afterState: 'foreground', outcome: 'activated' }
    }
    if (beforeState === 'not-running') return { beforeState, afterState: beforeState, outcome: 'already-stopped' }
    this.#appStates.set(request.appId, 'not-running')
    this.#actionCount += 1
    this.#lastAction = 'Application terminated'
    return { beforeState, afterState: 'not-running', outcome: 'terminated' }
  }

  geometry(): ScreenGeometry {
    return {
      viewport: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
      orientation: 'portrait',
      orientationSource: 'provider',
    }
  }

  structure(): ScreenStructure {
    return {
      truncated: false,
      nodes: [
        {
          nodeId: 'n0',
          role: 'application',
          platformRole: 'mock:application',
          name: 'FlowAssert demo',
          bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
          visible: true,
          enabled: true,
          actionable: false,
        },
        {
          nodeId: 'n1',
          parentId: 'n0',
          role: 'text',
          platformRole: 'mock:text',
          text: 'Hello, harness.',
          bounds: { x: 28, y: 112, width: 260, height: 42 },
          visible: true,
          enabled: true,
          actionable: false,
        },
        {
          nodeId: 'n2',
          parentId: 'n0',
          role: 'button',
          platformRole: 'mock:button',
          identifier: 'action-card',
          name: `${this.#actionCount} actions received`,
          value: this.#lastAction,
          bounds: { x: 24, y: 178, width: 342, height: 214 },
          visible: true,
          enabled: true,
          actionable: true,
        },
        {
          nodeId: 'n3',
          parentId: 'n0',
          role: 'input',
          platformRole: 'mock:text-input',
          identifier: 'public-input',
          name: 'Public test input',
          value: this.#inputValue,
          bounds: { x: 24, y: 420, width: 342, height: 64 },
          visible: true,
          enabled: true,
          actionable: true,
          focused: this.#focusedNodeId === 'n3',
        },
        {
          nodeId: 'n4',
          parentId: 'n0',
          role: 'input',
          platformRole: 'mock:secure-text-input',
          identifier: 'secure-input',
          name: 'Sensitive input',
          sensitive: true,
          bounds: { x: 24, y: 500, width: 342, height: 64 },
          visible: true,
          enabled: true,
          actionable: true,
          focused: this.#focusedNodeId === 'n4',
        },
      ],
    }
  }

  png(): ScreenObservationImage {
    const rgba = new Uint8Array(WIDTH * HEIGHT * 4)
    fillRect(rgba, WIDTH, 0, 0, WIDTH, HEIGHT, [13, 19, 37, 255])
    fillRect(rgba, WIDTH, 24, 178, 342, 214, revisionColor(this.#actionCount))
    fillRect(rgba, WIDTH, 24, 462, 342, 94, [32, 46, 70, 255])
    fillRect(rgba, WIDTH, 50, 333, Math.min(278, 30 + this.#actionCount * 31), 8, [255, 255, 255, 255])
    fillRect(rgba, WIDTH, 48, 492, 20, 20, [118, 230, 164, 255])
    encodeCounter(rgba, WIDTH, this.#actionCount)
    return { bytes: encodePng(WIDTH, HEIGHT, rgba), contentType: 'image/png', width: WIDTH, height: HEIGHT }
  }

  svg(): Uint8Array {
    const safeAction = escapeXml(this.#lastAction)
    const accent = toHex(revisionColor(this.#actionCount))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844">
      <rect width="390" height="844" rx="48" fill="#0d1325"/>
      <rect x="139" y="13" width="112" height="32" rx="16" fill="#02050b"/>
      <text x="28" y="105" fill="#8fa2bf" font-family="sans-serif" font-size="14">FLOWASSERT</text>
      <text x="28" y="145" fill="#ffffff" font-family="sans-serif" font-size="30" font-weight="700">Hello, harness.</text>
      <rect x="24" y="178" width="342" height="214" rx="28" fill="${accent}"/>
      <text x="50" y="225" fill="#dfe6ff" font-family="sans-serif" font-size="14">LIVE SESSION</text>
      <text x="50" y="273" fill="#ffffff" font-family="sans-serif" font-size="38" font-weight="750">${this.#actionCount}</text>
      <text x="50" y="300" fill="#dfe6ff" font-family="sans-serif" font-size="14">actions received</text>
      <text x="28" y="443" fill="#8fa2bf" font-family="sans-serif" font-size="13">LAST DEVICE EVENT</text>
      <rect x="24" y="462" width="342" height="94" rx="22" fill="#202e46"/>
      <circle cx="58" cy="509" r="6" fill="#76e6a4"/>
      <text x="87" y="505" fill="#ffffff" font-family="sans-serif" font-size="15" font-weight="650">${safeAction}</text>
      <text x="87" y="528" fill="#8fa2bf" font-family="sans-serif" font-size="13">revision ${this.#actionCount}</text>
      <rect x="154" y="814" width="82" height="5" rx="3" fill="#ffffff" fill-opacity="0.75"/>
    </svg>`
    return new TextEncoder().encode(svg)
  }
}

function revisionColor(revision: number): [number, number, number, number] {
  return [49 + (revision * 29) % 90, 89 + (revision * 17) % 80, 255 - (revision * 13) % 90, 255]
}

function encodeCounter(rgba: Uint8Array, stride: number, value: number): void {
  const bits = Math.max(1, value).toString(2).slice(-12)
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] === '1') fillRect(rgba, stride, 50 + index * 14, 250, 9, 22, [255, 255, 255, 255])
  }
}

function fillRect(
  bytes: Uint8Array,
  stride: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: [number, number, number, number],
): void {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const offset = (py * stride + px) * 4
      bytes.set(color, offset)
    }
  }
}

function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const scanlines = Buffer.alloc((width * 4 + 1) * height)
  for (let row = 0; row < height; row += 1) {
    const target = row * (width * 4 + 1)
    scanlines[target] = 0
    scanlines.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), target + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.byteLength)
  chunk.writeUInt32BE(data.byteLength, 0)
  typeBytes.copy(chunk, 4)
  chunk.set(data, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.byteLength)), 8 + data.byteLength)
  return chunk
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function describeAction(action: MirrorAction): string {
  if (action.kind === 'tap') return `Tap at ${action.x}, ${action.y}`
  if (action.kind === 'swipe') return `Swipe to ${action.endX}, ${action.endY}`
  if (action.kind === 'tap_node') return 'Tap observed node'
  if (action.kind === 'input_text') return `Input ${action.mode} (${[...action.text].length} code points)`
  return 'Navigate back'
}

function pointInRect(x: number, y: number, rect: { x: number; y: number; width: number; height: number }): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function toHex(color: [number, number, number, number]): string {
  return `#${color.slice(0, 3).map((value) => value.toString(16).padStart(2, '0')).join('')}`
}
