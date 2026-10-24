## Purpose

Make comparison shutdown, Worker ownership and failure recovery explicit, and prevent regressions through source dependency graph checks.

## ADDED Requirements

### Requirement: Owned comparison shutdown
The application SHALL stop comparison admission and await queued cancellation, admitted publication, running work and actual Worker exit before releasing the Store owner. Repeated close SHALL share one outcome. Shutdown MUST NOT revoke durable evidence references.

#### Scenario: Close during admission and execution
- **WHEN** close overlaps an admitted publication and another running comparison
- **THEN** no subsequent comparison starts, admitted work is settled, workers exit and read leases release before close completes

#### Scenario: Late Worker result
- **WHEN** a Worker emits a result after cancellation wins
- **THEN** no successful report or artifact is published from that result

### Requirement: Failure-aware lifecycle recovery
Comparison SHALL surface shutdown persistence and termination errors without unhandled background rejections. Unknown live Worker state MUST NOT be treated as safe termination. Source manifests and completed historical reports MUST remain unchanged.

#### Scenario: Termination failure
- **WHEN** terminate rejects before the Worker exit event
- **THEN** its read lease remains held until exit and the failure is reported rather than silently ignored

#### Scenario: Interrupted terminal write
- **WHEN** terminal persistence fails and the application later restarts with a new Store owner
- **THEN** unfinished comparison records become interrupted, durable references remain protective and no comparison automatically re-executes

### Requirement: Enforced source dependency graph
CI SHALL analyze all source modules, including re-exports and literal dynamic module loads, reject runtime cycles and forbidden layer reachability, and distinguish runtime from type-only edges. Exceptional dynamic loading MUST be narrowly identified and tested.

#### Scenario: Indirect boundary violation
- **WHEN** a domain module reaches storage or a host adapter through an intermediate barrel or dynamic literal import
- **THEN** the architecture gate fails and identifies the dependency path

#### Scenario: Runtime cycle
- **WHEN** value imports form a cycle but type-only imports do not
- **THEN** the runtime cycle fails the gate and type-only cycles alone do not
