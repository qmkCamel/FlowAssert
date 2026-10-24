## ADDED Requirements

### Requirement: Shared application composition
The system SHALL share one workbench application instance across Viewer and Agent adapters within a local runtime, with explicit ownership and no transport-owned business factories outside the compatibility composition entry.

#### Scenario: Multiple entry points
- **WHEN** Viewer and Agent access workbench, suite, comparison, triage or export services
- **THEN** their services use the same application and store, while standalone Viewer uses the same composition implementation

### Requirement: Ordered and complete shutdown
The system SHALL reject new jobs during close, cancel or drain accepted work before closing its store, await worker termination, cache shutdown completion, and attempt remaining cleanup if one cleanup step fails.

#### Scenario: Close during background work
- **WHEN** shutdown overlaps job admission, queued analysis or export
- **THEN** accepted jobs reach terminal states before store release and no new jobs are admitted

#### Scenario: Startup failure
- **WHEN** the Viewer listener cannot start
- **THEN** the runtime releases resources through the same idempotent close path and reports startup failure

### Requirement: Domain and persistence separation
Domain run types SHALL be independent of the concrete Store and transport adapters; the previous Store type exports SHALL remain compatible.

#### Scenario: Compile legacy consumer
- **WHEN** a consumer imports TestRun from the old Store module
- **THEN** it receives the same domain type without a data-format migration

### Requirement: Durable extension references
Retention SHALL consume a unified reference snapshot including conservative legacy adapters and versioned extension records. Closing or disabling an extension MUST NOT remove its durable references; damaged or unsupported records MUST block deletion.

#### Scenario: Unloaded consumer protects evidence
- **WHEN** a namespaced extension publishes a reference and its process closes
- **THEN** a subsequent retention scan still protects that run without loading the extension

### Requirement: Bounded replaceable triage analyzer
The system SHALL select or disable a trusted analyzer at startup, freeze its identity/version/config digest for each job/report, validate its output, and retain core authority over execution verdict and evidence commits. HTTP and agent input MUST NOT select arbitrary code.

#### Scenario: Second analyzer
- **WHEN** a different trusted analyzer is injected
- **THEN** it runs through the same bounded worker and publication path without modifying execution core or retention code

#### Scenario: Invalid or hanging analyzer
- **WHEN** the analyzer returns invalid output, exits without a response, or exceeds its budget
- **THEN** the triage job fails or is cancelled without modifying the source run or blocking ordinary device operations

#### Scenario: Disabled analysis
- **WHEN** analysis is disabled at startup
- **THEN** new analysis is rejected explicitly while existing reports and ordinary testing remain available
