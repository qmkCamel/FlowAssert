## ADDED Requirements

### Requirement: Structured bounded report discovery
The Viewer SHALL provide result, platform, source, date range, case identity, build and bounded text filters through a versioned report-summary query. Each page SHALL contain at most 50 items from at most 10,000 run summaries, ordered by start time descending with a stable run-identity tie break. List loading MUST NOT fetch image, hierarchy or full source artifacts. Existing run and history APIs SHALL retain their contracts.

#### Scenario: Filter failed iOS runs
- **WHEN** a user selects failed, iOS and a local date interval
- **THEN** the query returns matching run summaries with an explicit time-zone interpretation and exclusive interval end, while unrelated runs and artifact payloads are excluded

#### Scenario: Query budget exceeded
- **WHEN** a report query exceeds the supported summary budget
- **THEN** the query reports the budget error and preserves the last usable list rather than silently truncating a successful result

### Requirement: Consistent counts and stable navigation
Result counts SHALL describe the entire filtered run-summary set in the same generation as the displayed page, explicitly distinguish execution counts from planned-suite rates, and disclose unreadable records. Cursor identity SHALL include query and generation. Refresh and browser navigation SHALL retain recoverable filter, page, scroll and focus context without joining incompatible generations. Private filter text MUST NOT be added to portable share links.

#### Scenario: New run arrives between pages
- **WHEN** the user requests the next page after the underlying generation changes
- **THEN** the UI requests a refresh, retains the prior page with its identity and does not append inconsistent results

#### Scenario: Return from analysis
- **WHEN** a user opens a report and returns to the directory
- **THEN** the prior filter and position are restored or an explicit stale-generation refresh is offered, without executing a device action

### Requirement: Scannable and truthful report summaries
Each result row or narrow-screen card SHALL prioritize localized result, readable name, recorded failure summary, platform/device alias, build, start time and duration. Raw identities and digests SHALL be secondary. Running, cancelled, interrupted, recovered and inconclusive states MUST NOT be relabelled as clean passes or product failures. Unknown fields and unverified current evidence availability SHALL be explicit.

#### Scenario: Old record lacks build and runtime data
- **WHEN** an older report has no recorded build or declared runtime features
- **THEN** the row shows unknown build and does not infer either a recent build or successful runtime checks

#### Scenario: Historical pass with missing evidence
- **WHEN** a recorded pass has unavailable or not recently checked evidence
- **THEN** the historical result and current evidence state are displayed separately and the row does not claim fresh evidence verification

### Requirement: Identity-based history and qualified trends
Case history SHALL associate runs only through recorded case or suite-case identities. Trends SHALL reuse existing planned-case and attempt denominators, comparability, first-pass, clean-pass, flaky and exclusion rules. Every trend SHALL disclose sample scope and excluded or unreadable records; drill-down SHALL preserve that scope or explain why it cannot be represented by the directory query.

#### Scenario: Same name with different identities
- **WHEN** two runs share a display name but have different or missing case identities
- **THEN** history does not merge them into a single case lineage

#### Scenario: Imported runs in selected time range
- **WHEN** a selected period includes imported or derived runs alongside planned suite attempts
- **THEN** trends retain their existing exclusion policy and denominators rather than calculating quality rates directly from directory run counts

### Requirement: Responsive report-directory actions
Search, refresh and pagination SHALL provide action-local feedback, prevent unsafe duplicate work, ignore stale responses and preserve prior usable content on error. Independent navigation SHALL remain interactive. Displayed update times SHALL represent completed domain operations, not rendering. Controls SHALL support keyboard navigation, meaningful labels, visible focus, narrow layouts and non-color status identification.

#### Scenario: Slow search replaced by a newer query
- **WHEN** a query takes at least 500 ms and the user changes filters or opens another report
- **THEN** local progress remains visible while relevant, the navigation is usable and the older result cannot overwrite the current query or selection

#### Scenario: Refresh fails
- **WHEN** a directory refresh fails after a usable list was displayed
- **THEN** that list remains labelled with its prior query and update time alongside a recoverable error
