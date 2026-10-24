## ADDED Requirements

### Requirement: Explicit first-test journey
The Viewer SHALL provide target selection, editable steps and expectations, revision-bound validation, and explicit execution consent as a continuous journey. Draft creation, inspection, validation and export MUST NOT execute device mutations. Missing assertions SHALL be labelled as an action-only flow rather than a verified test.

#### Scenario: Device is not ready
- **WHEN** a user creates a draft without a connected compatible device
- **THEN** the draft can be retained but execution is unavailable with a specific explanation and device navigation

#### Scenario: No test oracle
- **WHEN** a draft contains only actions
- **THEN** saving remains possible but the journey states that no result assertion exists and does not count it as a verified first test

### Requirement: Lossless reviewed Inspector handoff
The Viewer SHALL explicitly append an Inspector draft or create a new case, confirm replacement of nonempty work, and invalidate previous validation. Visual editing SHALL preserve unsupported YAML nodes and original content; unsupported edits MUST use source mode rather than silently dropping semantics. Stale, ambiguous or sensitive selections MUST NOT acquire coordinate fallbacks.

#### Scenario: Existing unsaved work
- **WHEN** a user transfers an Inspector draft into a nonempty editor
- **THEN** the user chooses append, new case or confirmed replacement and cancellation preserves both drafts

#### Scenario: Unsupported advanced step
- **WHEN** an existing flow contains unsupported visual-editor syntax or comments
- **THEN** its content is preserved and shown through a read-only card or source editor, not reduced to the supported subset

### Requirement: Validation bound to exact inputs
Authoring validation SHALL bind YAML, parameters, project digest, compiler version and selected target to a runtime-local receipt expiring after ten minutes. Authoring execution MUST recheck this binding, require local-evidence consent and use durable idempotent acceptance through the existing execution owner. Older non-authoring run APIs SHALL retain their contracts.

#### Scenario: Edit while validating
- **WHEN** an old validation completes after the draft, parameters or target changed
- **THEN** its result cannot enable execution for the new inputs and the edited draft remains intact

#### Scenario: Expired or restarted runtime
- **WHEN** a new, not previously accepted execution request uses an expired receipt or one issued before runtime restart
- **THEN** execution is rejected before device mutation and fresh validation is requested

#### Scenario: Duplicate execution request
- **WHEN** the same request identity and digest are retried after an uncertain response or restart
- **THEN** the existing acceptance or explicit interrupted/unknown outcome is returned without repeating device writes; a different digest conflicts

### Requirement: Shared durable acceptance with isolated authorization
The application SHALL own a host-neutral durable acceptance mechanism shared by Agent and Viewer adapters without granting device ownership to that mechanism. Agent policy, registered targets, request identities, v1 journals and public tool contracts MUST remain compatible. Viewer authoring MUST use a separate namespace and journal schema, with no automatic registration of draft YAML or cross-channel access. Acceptance persistence, capacity admission, reference publication and shutdown MUST fail closed before dispatch; recovery MUST NOT replay device mutations.

#### Scenario: Viewer authorization is not Agent authorization
- **WHEN** a local Viewer user validates and accepts an unregistered draft
- **THEN** the Agent catalog and allowed targets are unchanged and neither adapter can retrieve the other channel's request through its public API

#### Scenario: Interrupted acceptance publication
- **WHEN** the process exits or persistence fails after a durable acceptance write but before a successful response or dispatch
- **THEN** retry finds the existing identity or an explicit interrupted/unknown outcome, never dispatches it again, and retains any conservative evidence protection

#### Scenario: Closing or capacity constrained application
- **WHEN** a new request races application closure or durable storage capacity cannot be admitted
- **THEN** it cannot open a new execution gate, prior accepted identities remain intact, and the error is recoverable without inventing success

### Requirement: Bounded revisioned local case library
Cases SHALL reside only in application-owned storage with immutable revisions, optimistic head updates, explicit public-parameter consent, capacity admission and recoverable archive state. Runs SHALL retain frozen inputs and optional case/revision provenance independently of future case edits. First-version budgets SHALL be 1000 cases, 100 revisions per case, 50 summaries per page, 80 KiB requests and 64 KiB YAML; overflow MUST be explicit, not silently truncated or evicted.

#### Scenario: Concurrent save
- **WHEN** two editors save against the same expected revision
- **THEN** only a valid compare-and-swap updates the head and the losing editor retains its draft with a conflict and save-copy option

#### Scenario: Interrupted or capacity-rejected save
- **WHEN** save fails before or after immutable revision publication
- **THEN** the prior committed head remains readable, no uncommitted head is published, and the UI preserves unsaved text

#### Scenario: Case archived after execution
- **WHEN** a case is archived or edited after a run
- **THEN** the old run retains its original input and verdict, its evidence is not deleted, and archive can be reversed

### Requirement: Restricted reusable export
Export SHALL preview a bounded fixed-relative-path artifact containing the selected flow revision and declared reusable configuration. It MUST NOT write to arbitrary host paths, copy credentials or registered commands, or label unresolved external capabilities as standalone runnable. Existing project registration and old local drafts SHALL not be overwritten automatically.

#### Scenario: External hook dependency
- **WHEN** a draft requires a registered hook unavailable in an independent export
- **THEN** export explains the dependency and refuses a misleading self-contained package while retaining the draft

### Requirement: Nonblocking and accessible authoring actions
Save, validation, export and execution SHALL expose action-local progress, duplicate protection, appropriate cancellation and recoverable errors. Navigation and independent history reading SHALL remain usable; failed or cancelled operations SHALL preserve usable drafts and ignore late responses. Domain timestamps SHALL not change on rendering. The flow SHALL support labelled keyboard navigation and narrow layouts.

#### Scenario: Slow failed validation
- **WHEN** validation takes more than 500 ms and then fails while the user views history
- **THEN** progress is visible locally, history remains usable, the draft is preserved and execution remains correctly gated

#### Scenario: Device exclusively busy
- **WHEN** an inspection request cannot run while execution owns the device
- **THEN** the UI explains the occupied state and offers a retry path instead of presenting it as a generic capture failure
