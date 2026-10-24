## MODIFIED Requirements

### Requirement: Understandable evidence-grounded result summary
Analysis SHALL prioritize recorded verdict, current evidence, supported failures and expected/observed facts using the authoritative projection. Missing, corrupt, derived and incomplete-required limitations MUST stay visible. Technical identifiers SHALL be secondary; absent declarations MUST NOT imply success. Facts, hypotheses and re-execution SHALL remain distinct; summaries MUST NOT rewrite outcomes or claim unsupported causes.

#### Scenario: Render the complete result projection
- **WHEN** an original, legacy or derived report is rendered
- **THEN** The first analysis screen SHALL explain the recorded verdict, current evidence availability, earliest supported failure, expected versus observed facts and unverified dimensions. Internal hashes and raw codes SHALL remain inspectable in technical details rather than being primary labels. Hypotheses MUST remain distinct from confirmed facts; no deterministic summary or generated triage SHALL rewrite original outcomes or claim unsupported root cause. The first screen SHALL prioritize a concise result, failure location, expected/observed facts and evidence access. Missing or corrupt evidence, derived not-revalidated status and incomplete required verification MUST remain visible when technical details are collapsed. Runtime contract v2 declarations, temporal assertions, health/performance requirements and unsupported outcomes SHALL use the existing authoritative result projection; absent legacy fields MUST NOT imply success. Labels SHALL distinguish material-integrity verification from test re-execution.

#### Scenario: Assertion failed with no baseline
- **WHEN** recorded structure shows zero matches for an expected visible element and no comparable baseline exists
- **THEN** the summary explains the missing match and baseline limitation without declaring a product defect or locator defect as proven

#### Scenario: Evidence later unavailable
- **WHEN** a previously completed run has missing or corrupt evidence
- **THEN** the original verdict remains visible alongside current unavailable/unverified status and cannot be advertised as currently evidence-verified

#### Scenario: Required run-level gate fails without a failed step
- **WHEN** all recorded steps pass but a required run-level gate fails or lacks supported evidence
- **THEN** analysis highlights the run-level check and its limitation without inventing a failed step or displaying an overall clean pass

#### Scenario: Compact summary on an old or derived report
- **WHEN** technical detail is collapsed for a legacy or derived report
- **THEN** missing declarations, evidence limitations and not-revalidated status remain visible while raw hashes and secondary diagnostics remain inspectable in details

### Requirement: Historical step evidence linkage
Step selection SHALL coordinate registered historical evidence with bounded lazy reads, verification, leases and request identity. Analysis MUST NOT substitute live media. Readable steps, bounded search, failure navigation and image fit/zoom/original size SHALL be available. Search MUST NOT change failure counts; retained evidence SHALL keep its original identity. Run-level checks SHALL remain separate.

#### Scenario: Read or search historical evidence
- **WHEN** a historical step is selected, searched or loaded
- **THEN** Selecting a step SHALL coordinate its registered screenshot, structure, source location, available video position and diagnostics. The analysis view MUST NOT substitute current device media for missing historical evidence. Registered artifacts SHALL use existing verification and read leases; loading SHALL be bounded and lazy, with run/step request identity guarding against late responses. The analysis SHALL provide previous/next-failure navigation, readable recorded step labels, bounded step search and image fit/zoom/original-size controls. Searching SHALL not redefine the run failure count. Prior evidence retained during a new load MUST remain visibly associated with its original step. Execution failures, checkpoint errors and non-passing declared step checks SHALL participate in failure navigation; run-level checks SHALL have a separately labelled destination.

#### Scenario: Step switched during image load
- **WHEN** a slow previous-step request completes after a new step is selected
- **THEN** it cannot overwrite the new selection, image, source or evidence availability

#### Scenario: Video or snapshot not recorded
- **WHEN** a selected run has no recorded video or requested historical screenshot
- **THEN** the view clearly says it was not recorded or is unavailable rather than inventing a replay; approximate video timing is labelled when present

#### Scenario: Multiple failures and a slow next image
- **WHEN** a user moves to the next failure while its screenshot is still loading
- **THEN** the selected failure, expected/observed facts and loading state are updated, any retained image is labelled with its prior step, and a stale response cannot replace the current selection

### Requirement: Reviewed comparable investigation and replay
History and comparison SHALL use recorded identities, inputs and existing comparability rules. Baselines MUST require explicit review; unknown contexts SHALL remain incomparable. Repair SHALL use existing authorization and new drafts/runs. Compatible child follow-ups SHALL disclose input changes. Facts, suggestions, review and outcomes MUST stay distinct without rewriting original results or proving causality.

#### Scenario: Review history and authorized follow-ups
- **WHEN** history, baseline selection, investigation, repair or follow-up comparison is opened
- **THEN** Baseline suggestions SHALL apply existing comparability rules and disclose unknown or mismatched inputs. Repair SHALL retain reviewed semantic differences and create a new draft/run through existing authorization. Follow-up comparison SHALL require a compatible child run and distinguish unchanged-snapshot replay from edited-input execution. Case history MUST NOT infer identity from display names alone. History SHALL expose recorded case/revision, build and input differences before baseline confirmation. Candidate ranking MUST NOT authorize automatic baseline selection. Existing comparison services SHALL determine whether a failure is new, persistent or recovered; unknown or incompatible contexts SHALL remain explicitly incomparable. Facts, investigation suggestions, human review and child-run outcomes SHALL remain separate in the presentation.

#### Scenario: Misleading recent success
- **WHEN** the latest successful run belongs to a different App, platform or incompatible input
- **THEN** it is not silently selected as a valid baseline and the user receives an applicability explanation

#### Scenario: Proposed repair changes an assertion
- **WHEN** a proposed repair attempts to delete or weaken an expectation
- **THEN** existing repair restrictions reject it rather than making the test pass through the analysis UI

#### Scenario: Follow-up passed
- **WHEN** a reviewed compatible child run passes after the original failed
- **THEN** both outcomes and input differences remain visible without rewriting the original verdict or claiming that passing proves a root cause

#### Scenario: Incomparable pair remains readable
- **WHEN** two selected reports have incompatible or unknown comparison context
- **THEN** both reports remain readable, the incompatibility is explained and no definitive regression classification or baseline approval is inferred

### Requirement: Responsive accessible analysis and conservative sharing
Analysis SHALL support localized desktop/narrow layouts, keyboard/focus, 200 percent zoom and existing run/step/tab links. Long actions SHALL show local progress, retain identified prior results and allow independent navigation. Limitations MUST remain visible. Sharing SHALL follow the reviewed local-export contract without automatic uploads, public localhost links or expanded device/remote authorization.

#### Scenario: Read analysis or prepare a reviewed export
- **WHEN** analysis is navigated, resized, localized or used to prepare sharing
- **THEN** Analysis SHALL use desktop step/evidence/context regions and narrow-screen tabs with meaningful labels, keyboard operation and localized visible state. Long evidence/compare/triage actions SHALL retain prior usable content, expose local progress and allow independent navigation. Sharing SHALL reuse explicitly reviewed local derived exports and SHALL NOT expose localhost deep links as portable public reports or upload evidence automatically. The primary reading tasks SHALL be overview, steps/evidence, history/comparison and sharing, with previous run/step/tab deep links mapped to the corresponding region. Chinese and English labels, 200 percent zoom, visible focus, keyboard failure navigation and non-color-only statuses SHALL be supported. Impactful limitations MUST remain accessible without opening technical details. Approved offline HTML exports SHALL follow the independent reviewed-report contract and MUST NOT expand device or remote-access authorization.

#### Scenario: Failed comparison with usable prior report
- **WHEN** a new comparison fails or is cancelled after showing local progress
- **THEN** the previous report remains clearly associated with its original inputs, independent navigation stays usable and late responses cannot restore the rejected result

#### Scenario: Keyboard and narrow viewport
- **WHEN** a user opens analysis on a 390-pixel-wide viewport or uses keyboard-only navigation
- **THEN** summary, steps, evidence and technical details remain reachable with visible focus and without relying on status color alone

#### Scenario: Previous deep link after navigation update
- **WHEN** an existing link selects summary, steps, evidence, details, compare, triage or share on a valid run
- **THEN** it opens the matching current region with the recorded step selection retained and no execution or implicit export
