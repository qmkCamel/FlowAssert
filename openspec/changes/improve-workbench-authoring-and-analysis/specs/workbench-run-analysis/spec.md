## ADDED Requirements

### Requirement: Dedicated navigable run analysis
The Viewer SHALL provide separate case, run, device and management task views and a deep-linkable run analysis view. Run and step selection SHALL survive browser navigation without triggering execution. Unsaved editing SHALL require a save/discard/cancel choice before destructive navigation; leaving analysis SHALL not cancel an active run.

#### Scenario: Open a failed-run deep link
- **WHEN** a valid finished run is opened without a selected step
- **THEN** the first failed step is selected, or the first available step when none failed, and its historical identity is visible

#### Scenario: Invalid or missing deep-link target
- **WHEN** a route names an invalid UUID, missing run or nonexistent step
- **THEN** the view gives a recoverable not-found/selection explanation and does not load unrelated evidence or execute a device action

### Requirement: Understandable evidence-grounded result summary
The first analysis screen SHALL explain the recorded verdict, current evidence availability, earliest supported failure, expected versus observed facts and unverified dimensions. Internal hashes and raw codes SHALL remain inspectable in technical details rather than being primary labels. Hypotheses MUST remain distinct from confirmed facts; no deterministic summary or generated triage SHALL rewrite original outcomes or claim unsupported root cause.

#### Scenario: Assertion failed with no baseline
- **WHEN** recorded structure shows zero matches for an expected visible element and no comparable baseline exists
- **THEN** the summary explains the missing match and baseline limitation without declaring a product defect or locator defect as proven

#### Scenario: Evidence later unavailable
- **WHEN** a previously completed run has missing or corrupt evidence
- **THEN** the original verdict remains visible alongside current unavailable/unverified status and cannot be advertised as currently evidence-verified

### Requirement: Historical step evidence linkage
Selecting a step SHALL coordinate its registered screenshot, structure, source location, available video position and diagnostics. The analysis view MUST NOT substitute current device media for missing historical evidence. Registered artifacts SHALL use existing verification and read leases; loading SHALL be bounded and lazy, with run/step request identity guarding against late responses.

#### Scenario: Step switched during image load
- **WHEN** a slow previous-step request completes after a new step is selected
- **THEN** it cannot overwrite the new selection, image, source or evidence availability

#### Scenario: Video or snapshot not recorded
- **WHEN** a selected run has no recorded video or requested historical screenshot
- **THEN** the view clearly says it was not recorded or is unavailable rather than inventing a replay; approximate video timing is labelled when present

### Requirement: Reviewed comparable investigation and replay
Baseline suggestions SHALL apply existing comparability rules and disclose unknown or mismatched inputs. Repair SHALL retain reviewed semantic differences and create a new draft/run through existing authorization. Follow-up comparison SHALL require a compatible child run and distinguish unchanged-snapshot replay from edited-input execution. Case history MUST NOT infer identity from display names alone.

#### Scenario: Misleading recent success
- **WHEN** the latest successful run belongs to a different App, platform or incompatible input
- **THEN** it is not silently selected as a valid baseline and the user receives an applicability explanation

#### Scenario: Proposed repair changes an assertion
- **WHEN** a proposed repair attempts to delete or weaken an expectation
- **THEN** existing repair restrictions reject it rather than making the test pass through the analysis UI

#### Scenario: Follow-up passed
- **WHEN** a reviewed compatible child run passes after the original failed
- **THEN** both outcomes and input differences remain visible without rewriting the original verdict or claiming that passing proves a root cause

### Requirement: Responsive accessible analysis and conservative sharing
Analysis SHALL use desktop step/evidence/context regions and narrow-screen tabs with meaningful labels, keyboard operation and localized visible state. Long evidence/compare/triage actions SHALL retain prior usable content, expose local progress and allow independent navigation. Sharing SHALL reuse explicitly reviewed local derived exports and SHALL NOT expose localhost deep links as portable public reports or upload evidence automatically.

#### Scenario: Failed comparison with usable prior report
- **WHEN** a new comparison fails or is cancelled after showing local progress
- **THEN** the previous report remains clearly associated with its original inputs, independent navigation stays usable and late responses cannot restore the rejected result

#### Scenario: Keyboard and narrow viewport
- **WHEN** a user opens analysis on a 390-pixel-wide viewport or uses keyboard-only navigation
- **THEN** summary, steps, evidence and technical details remain reachable with visible focus and without relying on status color alone
