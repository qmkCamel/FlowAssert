## Purpose

Protect built-in evidence consumers through durable publication, explicit retirement and conservative mixed-version retention.

## ADDED Requirements

### Requirement: Built-in durable consumer publication
New suite attempts, run-backed baselines, dispatched Agent flows, pins and child-run relationships SHALL publish matching ledger references before committing their consumer metadata, within the Store mutation gate. Accepted Agent requests with no run yet SHALL retain their durable future-target reservation until dispatch publication. Failed publication MUST leave protection or fail closed.

#### Scenario: Publication interrupted
- **WHEN** a consumer write fails after reference publication
- **THEN** the orphan reference continues to protect the source and historical source evidence is unchanged

#### Scenario: Agent dispatch publication fails
- **WHEN** reference-bearing Agent journal publication fails before the execution gate opens
- **THEN** the run is cancelled before dispatch, and terminal persistence failure is reported without an unhandled rejection or loss of protection

#### Scenario: Slow suite attempt publication
- **WHEN** suite reference publication is delayed after its child run is created
- **THEN** the execution gate remains closed and the child manifest does not advance until the reference and suite record are durable; failure cancels the child before dispatch

### Requirement: Explicit reference retirement
Suite freezing, verified Agent terminal projection, unpin and child purge SHALL durably record retirement before revoking owned references. Run-backed baselines SHALL remain protective. Child references SHALL survive move to trash and restore until purge.

#### Scenario: Retirement interrupted
- **WHEN** revocation fails after the retirement marker is committed
- **THEN** remaining references continue protecting sources and a retry can finish without deleting another consumer's references

### Requirement: Conservative mixed-version retention
Retention SHALL validate new publication identity and expected active targets, block missing/corrupt/conflicting references, and retain the legacy scanner for unmarked historical consumers. Migration SHALL NOT bulk rewrite old evidence or weaken existing frozen-fact requirements.

#### Scenario: Missing new ledger entry
- **WHEN** a live marked consumer has a missing or mismatched ledger reference
- **THEN** cleanup fails closed rather than treating the record as an unreferenced legacy consumer

#### Scenario: Legacy records after upgrade
- **WHEN** historical consumer records lack new markers
- **THEN** their existing conservative protection and release conditions remain in effect
