## Purpose

Help a new user turn a connected mobile app and a reviewed UI expectation into a repeatable local acceptance project with inspectable results.

## ADDED Requirements

### Requirement: Continuous first acceptance
The Viewer SHALL provide a bilingual path through platform/App selection, template or Inspector draft, validation, explicit execution, result review and reusable project download. It MUST preserve user edits and use existing run consent and ownership.

#### Scenario: Inspector handoff
- **WHEN** a user sends an Inspector draft to an edited workbench
- **THEN** replacement requires confirmation and does not start device actions

#### Scenario: Validation races
- **WHEN** a user edits the draft while validation is running
- **THEN** the previous response cannot validate the new draft, existing results remain visible and unrelated controls remain usable

### Requirement: Portable project export
The system SHALL export validated standalone YAML with a project config, serial suite and setup instructions using fixed relative archive paths. It MUST reject unresolved external capabilities and never copy host paths, secrets or registered extension source.

#### Scenario: External project dependency
- **WHEN** a draft needs registered flows, business hooks, recovery or visual profiles
- **THEN** standalone export explains that those dependencies require the existing project instead of producing a misleading runnable archive

### Requirement: Discoverable business fixture lifecycle
The assistant SHALL display registered prepare/verify/cleanup capabilities and provide a self-contained fixture example whose verification is independent of the UI. It MUST identify unconfigured business verification and per-run cleanup.

#### Scenario: Business success missing
- **WHEN** a run passes its UI assertion without a verifier
- **THEN** the assistant shows business verification as not performed, without describing the run as independently verified business success
