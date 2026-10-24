# appium-provider Specification

## Purpose
Define Appium session creation, attachment, ownership and platform-specific media hints.
## Requirements
### Requirement: Create or attach to a session

The provider SHALL create a new session from W3C capabilities or attach to a supplied session identifier. It SHALL retain an internal, non-exported media context containing only the platform, target needed by the media coordinator, session ownership and verified media hints. In auto media mode, an owned iOS session SHALL honor an explicit `appium:mjpegServerPort` or plan a free loopback MJPEG port before creation; a planned port collision MAY be retried once only when the failure is classified as MJPEG forwarding.

#### Scenario: Creating a session

- WHEN Appium capabilities are supplied
- THEN the provider probes Appium status, creates a W3C session, records ownership, and exposes its session identifier.

#### Scenario: Creating an owned iOS media session

- **WHEN** auto media mode creates an iOS session and the request does not include `appium:mjpegServerPort`
- **THEN** the provider SHALL add a planned non-conflicting port to the internal effective capabilities before the W3C new-session request
- **AND** public state/logs/tool results MUST NOT expose that port, UDID or complete effective capabilities.

#### Scenario: Attaching to an existing session

- WHEN an existing session identifier is supplied
- THEN the provider verifies that session and records it as externally owned.
- AND any iOS MJPEG hint SHALL be treated as read-only and usable only when the attached capabilities explicitly provide it.

### Requirement: Preserve external session ownership

The provider SHALL delete only sessions it created. Media cleanup SHALL distinguish runtime-owned Android media resources, Appium-managed forwarding for owned iOS sessions, and read-only forwarding belonging to attached sessions.

#### Scenario: Stopping an attached session

- WHEN the mirror stops after attaching to an external Appium session
- THEN the plugin detaches
- AND it does not send a session delete request.
- AND it MUST NOT create, replace or close the attached iOS session's port forwarding.

#### Scenario: Stopping an owned iOS session with MJPEG

- **WHEN** the mirror stops after creating an iOS session with a planned MJPEG port
- **THEN** active Viewer media SHALL close before the provider deletes the session
- **AND** Appium SHALL remain responsible for releasing the WDA forwarding created for that owned session.

### Requirement: Frames and actions

The provider SHALL obtain fresh screenshots and send W3C pointer actions for taps/swipes plus the WebDriver back action. Continuous Viewer media MUST NOT replace the provider screenshot method, change action coordinates, or enable `mjpegScreenshotUrl`; media setting/stream failures MUST remain separate from screenshot/action errors once the Appium session is usable.

#### Scenario: Agent taps a streamed screen

- WHEN the mirror is streaming and the agent supplies finite tap coordinates
- THEN the provider sends a touch pointer sequence to the active Appium session
- AND status records the completed action.

#### Scenario: Agent captures while iOS MJPEG is live

- **WHEN** WDA MJPEG is live and the agent requests a fresh screenshot observation
- **THEN** the provider SHALL call the independent Appium screenshot endpoint and validate the returned PNG
- **AND** it MUST NOT return the most recently broadcast JPEG or configure `appium:mjpegScreenshotUrl`.

#### Scenario: MJPEG settings fail after session creation

- **WHEN** applying bounded MJPEG framerate, scale, quality or orientation settings fails after an iOS session is usable
- **THEN** the media coordinator SHALL report fallback while screenshot and actions remain available
- **AND** the provider MUST NOT delete or recreate the usable session solely for this media failure.
