# Proposal: Implement the DeepSeek Harness mobile mirror MVP

## Why

DeepSeek Harness needs an installable, auditable way for an agent to inspect and control a phone from a Mac. Existing MCP products prove the workflow, but none simultaneously gives this project a native DSH package, explicit Appium session ownership, a loopback-only viewer, and a deterministic no-device validation path.

## What changes

- Add an installable DeepSeek Harness Cordis bundle with schema-backed configuration.
- Add compact tools for device discovery, start, status, actions, and stop.
- Add Mock and Appium W3C providers behind a reusable service.
- Add a local Viewer that displays frames and offers manual test controls.
- Add research, ADR, architecture, security, milestones, and repeatable test evidence.
- Defer high-rate scrcpy/WDA media and generic MCP/Codex support to named milestones.

## Capabilities

### New capabilities

- `flowassert`: plugin lifecycle and tool behavior.
- `local-mirror-viewer`: loopback UI and long-action feedback behavior.
- `appium-provider`: Appium session, frame, action, and ownership behavior.

### Modified capabilities

None; this is a new repository.

## Impact

- Adds a local HTTP listener restricted to loopback.
- Adds peer coupling to DeepSeek Harness preview APIs and a runtime dependency on Schemastery.
- Real devices require an independently configured Appium environment.
- Git installs run `prepare` only after explicit pnpm allowlisting; prebuilt tarballs are the safer M1 distribution path.
