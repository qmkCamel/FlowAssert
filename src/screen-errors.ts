export type ScreenErrorCode =
  | 'screen_observation_disabled'
  | 'screen_image_sharing_disabled'
  | 'screen_observation_in_progress'
  | 'screen_capture_failed'
  | 'screen_geometry_unavailable'
  | 'screen_structure_unavailable'
  | 'screen_structure_invalid'
  | 'screen_observation_too_large'
  | 'screen_observation_expired'
  | 'screen_observation_stale'
  | 'screen_observation_session_mismatch'
  | 'screen_coordinate_space_invalid'
  | 'screen_attachment_failed'
  | 'screen_query_result_too_large'
  | 'viewer_inspection_geometry_changed'
  | 'screen_node_not_found'
  | 'screen_node_not_actionable'
  | 'screen_text_input_disabled'
  | 'screen_text_input_invalid'
  | 'screen_text_input_not_focused'
  | 'screen_text_input_sensitive'
  | 'screen_text_input_target_mismatch'
  | 'screen_text_input_unsupported'
  | 'screen_text_input_failed'
  | 'screen_text_input_partial'
  | 'app_control_disabled'
  | 'app_control_attached_session_forbidden'
  | 'app_target_unavailable'
  | 'app_target_not_allowed'
  | 'app_not_installed'
  | 'app_activate_failed'
  | 'app_terminate_failed'
  | 'app_state_unverified'

const MESSAGES: Record<ScreenErrorCode, string> = {
  screen_observation_disabled: 'Agent screen observation is disabled for this provider.',
  screen_image_sharing_disabled: 'Agent screen image sharing is disabled.',
  screen_observation_in_progress: 'Another screen observation is already in progress.',
  screen_capture_failed: 'The fresh screen capture failed.',
  screen_geometry_unavailable: 'Screen geometry is unavailable.',
  screen_structure_unavailable: 'Screen structure is unavailable.',
  screen_structure_invalid: 'Screen structure is invalid or unsafe.',
  screen_observation_too_large: 'The screen observation exceeds the configured safety limit.',
  screen_observation_expired: 'The screen observation has expired.',
  screen_observation_stale: 'The screen observation is stale.',
  screen_observation_session_mismatch: 'The screen observation belongs to another session.',
  screen_coordinate_space_invalid: 'The action coordinate space is invalid for this observation.',
  screen_attachment_failed: 'The screen image could not be delivered as an attachment.',
  screen_query_result_too_large: 'The query result exceeds the response limit.',
  viewer_inspection_geometry_changed: 'Screen geometry changed during inspection capture.',
  screen_node_not_found: 'The referenced screen node was not found.',
  screen_node_not_actionable: 'The referenced screen node is not safely actionable.',
  screen_text_input_disabled: 'Agent text input is disabled for this provider.',
  screen_text_input_invalid: 'The text input request is invalid.',
  screen_text_input_not_focused: 'The referenced input is not focused.',
  screen_text_input_sensitive: 'Sensitive inputs cannot receive agent text.',
  screen_text_input_target_mismatch: 'The active input does not match the observed node.',
  screen_text_input_unsupported: 'Text input is not supported by this provider.',
  screen_text_input_failed: 'The text input operation failed.',
  screen_text_input_partial: 'The text input may have been partially applied.',
  app_control_disabled: 'Agent application control is disabled.',
  app_control_attached_session_forbidden: 'Application control is forbidden for attached sessions.',
  app_target_unavailable: 'The application target is unavailable.',
  app_target_not_allowed: 'The application target is not allowed.',
  app_not_installed: 'The application is not installed.',
  app_activate_failed: 'The application could not be activated.',
  app_terminate_failed: 'The application could not be terminated.',
  app_state_unverified: 'The application state could not be verified.',
}

const MAY_HAVE_MUTATED = new WeakSet<object>()

export class ScreenObservationError extends Error {
  readonly code: ScreenErrorCode

  constructor(code: ScreenErrorCode, options?: ErrorOptions) {
    super(`${code}: ${MESSAGES[code]}`, options)
    this.name = 'ScreenObservationError'
    this.code = code
  }
}

export function screenError(code: ScreenErrorCode, cause?: unknown): ScreenObservationError {
  return new ScreenObservationError(code, cause === undefined ? undefined : { cause })
}

export function screenErrorCode(error: unknown): ScreenErrorCode | null {
  return error instanceof ScreenObservationError ? error.code : null
}

export function markMayHaveMutated<T extends object>(error: T): T {
  MAY_HAVE_MUTATED.add(error)
  return error
}

export function mayHaveMutated(error: unknown): boolean {
  return error !== null && typeof error === 'object' && MAY_HAVE_MUTATED.has(error)
}
