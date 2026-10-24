# DeepSeek Harness mobile mirror plugin

## Purpose

Define the agent-visible lifecycle and packaging contract for mobile mirroring.

## ADDED Requirements

### Requirement: Installable DeepSeek Harness bundle

The package SHALL declare a DeepSeek Harness bundle patch that inserts one schema-validated Cordis plugin row, and the plugin SHALL register behavior only through documented effects and registries.

#### Scenario: Installing the bundle in a profile

- WHEN a user installs a prebuilt package with `dsh plugin --profile <name> add <package>`
- THEN the profile bundle list includes this package
- AND `dsh --profile <name> --dump-config` contains the `mobile-mirror` row
- AND plugin disposal closes host resources.

### Requirement: Compact agent tools

The plugin SHALL expose device discovery, start, status, action, and stop tools whose canonical results contain control/status data rather than continuous frame payloads.

#### Scenario: Running the Mock lifecycle

- WHEN the agent starts the Mock provider, reads status, sends a tap, and stops
- THEN status progresses through connecting, streaming, and idle
- AND it reports a Viewer URL, session ID, frame timestamp, and last action
- AND no physical device is required.

### Requirement: Cancellation and failure visibility

Provider calls SHALL honor the tool cancellation signal and a configured timeout, and failures SHALL remain visible in status.

#### Scenario: Provider startup fails

- WHEN the Appium server is unreachable or startup is cancelled
- THEN the start tool fails with an actionable message
- AND status becomes error rather than streaming
- AND no provider-owned session is leaked.
