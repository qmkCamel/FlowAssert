# Local mirror Viewer

## Purpose

Define local visual feedback, manual control, and security behavior.

## ADDED Requirements

### Requirement: Loopback-only serving

The Viewer SHALL accept only loopback bind addresses in MVP configuration and SHALL apply same-origin security headers and bounded JSON request bodies.

#### Scenario: Loading the Viewer

- WHEN the plugin starts with valid configuration
- THEN the Viewer is reachable on its loopback URL
- AND its API is not bound to a LAN address.

### Requirement: Nonblocking long-action feedback

Every user-triggered Viewer action that may exceed 300 ms SHALL immediately show action-local progress without blocking unrelated safe interaction.

#### Scenario: Connecting while changing the display theme

- WHEN a user starts a connection whose provider takes longer than 300 ms
- THEN the start area shows a connecting indicator immediately
- AND duplicate start/stop actions are disabled
- AND the theme control remains operable before connection completes
- AND the final streaming state refreshes without a manual reload.

### Requirement: Preserve useful state on failure

The Viewer SHALL present actionable errors and preserve the last usable frame when a transient frame refresh fails.

#### Scenario: Frame refresh fails after streaming

- WHEN a new frame request fails after at least one frame succeeded
- THEN the prior frame remains visible
- AND status exposes the refresh error
- AND stop or retry controls remain available.
