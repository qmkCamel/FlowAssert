## MODIFIED Requirements

### Requirement: Loopback-only serving

The Viewer SHALL accept only loopback bind addresses in configuration and SHALL apply same-origin security headers, bounded JSON request bodies, and bounded continuous-media responses. Media routes MUST NOT accept an arbitrary upstream URL/port, and browser requests with a mismatched Origin or Referer MUST be rejected before a device media source is opened.

#### Scenario: Loading the Viewer

- WHEN the plugin starts with valid configuration
- THEN the Viewer is reachable on its loopback URL
- AND its API is not bound to a LAN address.

#### Scenario: Loading continuous media

- WHEN the current loopback Viewer requests its media stream
- THEN the response uses the same origin, no-store and existing CSP/nosniff/frame-denial policy
- AND no upstream device address, local forwarding port, UDID or machine path is exposed to the page or response metadata.

### Requirement: Nonblocking long-action feedback

Every user-triggered Viewer action or media startup that may exceed 300 ms SHALL immediately show action-local progress without blocking unrelated safe interaction. Media progress MUST be independent from the main mirror lifecycle and MUST NOT disable stop after the Appium session is usable.

#### Scenario: Connecting while changing the display theme

- WHEN a user starts a connection whose provider takes longer than 300 ms
- THEN the start area shows a connecting indicator immediately
- AND duplicate start/stop actions are disabled
- AND the theme control remains operable before connection completes
- AND the final streaming state refreshes without a manual reload.

#### Scenario: Media starts after the control session

- WHEN the mirror is streaming and a Viewer media source takes longer than 300 ms to produce its first frame
- THEN the page shows media starting while retaining the compatibility frame
- AND theme, status, stop and safe Appium controls remain operable.

### Requirement: Preserve useful state on failure

The Viewer SHALL present actionable errors and preserve the last usable frame when a transient polling, media-source, parser or browser-decoder refresh fails. A low-latency media failure MUST automatically resume screenshot polling without changing a usable main session to error.

#### Scenario: Frame refresh fails after streaming

- WHEN a new polling frame request fails after at least one frame succeeded
- THEN the prior frame remains visible
- AND status exposes the refresh error
- AND stop or retry controls remain available.

#### Scenario: Continuous media fails after its first frame

- WHEN scrcpy H.264 or WDA MJPEG ends, becomes invalid or cannot be rendered after at least one media frame succeeded
- THEN the last rendered frame remains visible until a new screenshot polling frame loads
- AND the page shows a stable fallback reason, resumes polling within 2 seconds, and keeps action/stop controls available.

## ADDED Requirements

### Requirement: Viewer must select a renderer by negotiated media transport

The Viewer SHALL use a WebCodecs/canvas renderer only for a supported Android H.264 transport, a same-origin image renderer for iOS MJPEG, and the existing image polling renderer for Mock/fallback. It MUST NOT start Android media before runtime H.264 decoder support is confirmed and MUST close decoded `VideoFrame` objects after painting.

#### Scenario: Android WebCodecs is supported

- **WHEN** media state offers scrcpy H.264 and `VideoDecoder.isConfigSupported` accepts the advertised codec
- **THEN** the Viewer SHALL open the framed stream, decode config/key/delta packets and paint the current frame to canvas
- **AND** it SHALL switch away from polling only after the first frame is painted.

#### Scenario: Android WebCodecs is unsupported

- **WHEN** `VideoDecoder` is absent or the advertised H.264 config is unsupported
- **THEN** the Viewer SHALL remain on screenshot polling and explain the compatibility fallback
- **AND** it MUST NOT request the Android continuous stream or load a hidden software decoder.
