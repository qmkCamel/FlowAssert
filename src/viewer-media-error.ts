import type { ViewerMediaErrorCode } from './types.js'

const MESSAGES: Record<ViewerMediaErrorCode, string> = {
  viewer_media_unavailable: 'Low-latency Viewer media is unavailable; screenshot polling remains active.',
  viewer_media_scrcpy_missing: 'The configured scrcpy 4.1 installation is unavailable.',
  viewer_media_scrcpy_version_unsupported: 'The configured scrcpy installation is not version 4.1.',
  viewer_media_port_unavailable: 'A loopback media port could not be reserved.',
  viewer_media_protocol_invalid: 'The device media stream did not match the expected protocol.',
  viewer_media_frame_too_large: 'The device media stream exceeded the configured frame limit.',
  viewer_media_decoder_unsupported: 'The browser could not decode the Android media stream.',
  viewer_media_stream_ended: 'The device media stream ended; screenshot polling remains active.',
}

export class ViewerMediaError extends Error {
  readonly code: ViewerMediaErrorCode

  constructor(code: ViewerMediaErrorCode, options?: ErrorOptions) {
    super(MESSAGES[code], options)
    this.name = 'ViewerMediaError'
    this.code = code
  }
}

export function viewerMediaError(code: ViewerMediaErrorCode, cause?: unknown): ViewerMediaError {
  return new ViewerMediaError(code, cause === undefined ? undefined : { cause })
}

export function viewerMediaErrorCode(error: unknown): ViewerMediaErrorCode {
  return error instanceof ViewerMediaError ? error.code : 'viewer_media_stream_ended'
}
