# Appium provider

## Purpose

Define the real-device provider contract over W3C WebDriver/Appium.

## ADDED Requirements

### Requirement: Create or attach to a session

The provider SHALL create a new session from W3C capabilities or attach to a supplied session identifier.

#### Scenario: Creating a session

- WHEN Appium capabilities are supplied
- THEN the provider probes Appium status, creates a W3C session, records ownership, and exposes its session identifier.

#### Scenario: Attaching to an existing session

- WHEN an existing session identifier is supplied
- THEN the provider verifies that session and records it as externally owned.

### Requirement: Preserve external session ownership

The provider SHALL delete only sessions it created.

#### Scenario: Stopping an attached session

- WHEN the mirror stops after attaching to an external Appium session
- THEN the plugin detaches
- AND it does not send a session delete request.

### Requirement: Frames and actions

The provider SHALL obtain screenshots and send W3C pointer actions for taps/swipes plus the WebDriver back action.

#### Scenario: Agent taps a streamed screen

- WHEN the mirror is streaming and the agent supplies finite tap coordinates
- THEN the provider sends a touch pointer sequence to the active Appium session
- AND status records the completed action.
