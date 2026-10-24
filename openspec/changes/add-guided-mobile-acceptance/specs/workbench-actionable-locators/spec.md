## Purpose

Provide explicit, maintainable semantic targets and bounded readiness checks for deterministic mobile tests without changing existing selector behavior.

## ADDED Requirements

### Requirement: Exact semantic target resolution
New readiness steps SHALL support exact test ID, normalized role, accessible name, text and a single ancestor scope. Targets MUST resolve uniquely; ambiguous, sensitive or incomplete-tree matches MUST NOT dispatch actions.

#### Scenario: Duplicate target
- **WHEN** two nodes match a requested target
- **THEN** no action is dispatched and the failure identifies ambiguous-target

#### Scenario: Ancestor scope
- **WHEN** the same label occurs in different containers and one unique ancestor is specified
- **THEN** only descendants of that ancestor are eligible

#### Scenario: Missing ancestor in a negative assertion
- **WHEN** the requested ancestor scope is absent
- **THEN** the system waits within the budget and reports scope-missing rather than claiming that the descendant is hidden

### Requirement: Bounded action readiness
Tap and fill readiness SHALL require visibility, enabled state, positive bounds and stable identity/bounds across consecutive reads. The user SHALL receive a distinct timeout reason for missing, hidden, disabled, unstable or unfocused targets. Cancellation MUST stop polling and prevent subsequent dispatch. Mutations MUST NOT be retried by the readiness mechanism.

#### Scenario: Delayed enabled state
- **WHEN** one target becomes enabled before the configured deadline
- **THEN** execution waits, confirms stability and dispatches at most once

#### Scenario: Cancellation during polling
- **WHEN** the run is cancelled while the target is not ready
- **THEN** polling terminates without a late tap or text write

### Requirement: Readiness assertions retain evidence
Positive and negative readiness assertions SHALL be recorded as original flow steps with source location, typed failure reason and normal per-step evidence. Legacy YAML MUST retain its previous execution semantics.

#### Scenario: Hidden negative assertion
- **WHEN** a negative visibility assertion sees only a hidden matching node in a complete tree
- **THEN** it can pass without treating an incomplete tree as proof of absence
