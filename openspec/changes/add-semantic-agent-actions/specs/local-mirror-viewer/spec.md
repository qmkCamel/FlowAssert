## MODIFIED Requirements

### Requirement: Nonblocking long-action feedback

Every user-triggered Viewer action, agent control operation or media startup that may exceed 300 ms SHALL immediately expose operation-local progress without blocking unrelated safe interaction. Observation, control and media progress MUST remain distinct from the main mirror lifecycle and MUST NOT disable status, theme or stop after the Appium session is usable. Public progress MUST NOT include input text, node label/value, app id, element/session id or provider request/response.

#### Scenario: Connecting while changing the display theme

- **WHEN** a user starts a connection whose provider takes longer than 300 ms
- **THEN** the start area SHALL show a connecting indicator immediately
- **AND** duplicate start/stop actions SHALL be disabled
- **AND** the theme control SHALL remain operable before connection completes
- **AND** the final streaming state SHALL refresh without a manual reload

#### Scenario: Checking a device while another control remains interactive

- **WHEN** a user starts an assistant check or guided connection that takes longer than 300 ms
- **THEN** only that assistant action SHALL show busy progress and reject its duplicate submission
- **AND** theme, current status, advanced-panel expansion and any valid stop action SHALL remain operable

#### Scenario: Media starts after the control session

- **WHEN** the mirror is streaming and a Viewer media source takes longer than 300 ms to produce its first frame
- **THEN** the page SHALL show media starting while retaining the compatibility frame
- **AND** theme, status, stop and safe Appium controls SHALL remain operable

#### Scenario: Agent text input is slow

- **WHEN** a DSH/MCP input_text operation remains active longer than 300 ms
- **THEN** Viewer SHALL show a generic acting phase while retaining the last usable frame
- **AND** it MUST NOT render the text, input label/value, nodeId or active element id

#### Scenario: Agent manages an application

- **WHEN** a DSH/MCP activate or terminate operation remains active longer than 300 ms
- **THEN** Viewer SHALL show a generic managing-app phase while main lifecycle remains streaming
- **AND** status, theme and stop SHALL remain operable without exposing app id or raw Appium state
