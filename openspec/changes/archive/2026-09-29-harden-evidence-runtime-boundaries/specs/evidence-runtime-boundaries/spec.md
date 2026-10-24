## Purpose

Make comparison/share reference lifecycles durable, validate the deterministic execution boundary, and provide repeatable local scale evidence without changing device ownership or historical verdicts.

## ADDED Requirements

### Requirement: Protected consumer publication
New comparison and share consumers SHALL durably publish owned versioned references before exposing their records under the Store mutation gate. Legacy records MUST remain conservatively protected.

#### Scenario: Publication interruption
- **WHEN** publication fails between reference writes and consumer commit
- **THEN** no unprotected consumer is visible and already written references remain protective after restart

#### Scenario: Missing or corrupt reference
- **WHEN** a new consumer names a missing, mismatched or invalid reference
- **THEN** retention refuses deletion rather than treating the consumer as unreferenced

### Requirement: Explicit durable retirement
Retirement SHALL persist a consumer tombstone before revoking owned references and SHALL be idempotent. Process shutdown MUST NOT retire consumers.

#### Scenario: Interrupted retirement
- **WHEN** shutdown occurs after the tombstone but before revocation completes
- **THEN** remaining references keep protecting evidence and a retry can complete retirement without changing source runs

### Requirement: Versioned executor messages
The native execution boundary SHALL validate message version, structure, sequence and legal step transitions before taking a device action or accepting completion. Invalid messages MUST fail the execution without replaying device writes.

#### Scenario: Invalid or out of order event
- **WHEN** a Worker sends an unsupported version, duplicate message, malformed tool event or terminal step without a start
- **THEN** the host rejects the event, terminates the Worker and preserves failure evidence

#### Scenario: Late message after cancellation
- **WHEN** a cancelled or completed Worker emits a late message
- **THEN** no new device action is dispatched and the existing terminal result is retained

### Requirement: Repeatable scale and acceptance evidence
The repository SHALL provide an executable temporary-data benchmark at 100, 1000 and 10000 runs, recording query cost and dataset shape. Validation reports MUST distinguish software checks from actual device checks and unresolved intermittent failures.

#### Scenario: Benchmark execution
- **WHEN** the benchmark runs on a developer host
- **THEN** it measures list, status, detail and consumer/reference queries without accessing user archives or weakening evidence verification
