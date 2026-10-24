## Why

Comparison now owns its Worker through actual exit, but native/analyzer/visual/share-image paths still differ on termination failure. Remaining built-in evidence consumers rely on bespoke scans instead of the durable ledger.

## What Changes

- Share a small Worker exit-ownership primitive, not a scheduler; cover success, failure, cancellation, timeout and rejected termination.
- Publish suite, run-backed baseline, Agent flow, pin and child-run references through the existing ledger. Persist retirement before revocation and preserve conservative legacy readers.
- Add fault/restart/ownership regression tests and update architecture acceptance records.
- Defer physical-device acceptance explicitly; no device operations, dynamic plugin container, query index or new execution engine.

## Capabilities

### New Capabilities

- `builtin-reference-governance`: Built-in consumer publication, retirement and legacy protection.

### Modified Capabilities

- `runtime-lifecycle-boundaries`: Extend actual-exit ownership to remaining Workers.

## Impact

Local Node runtime on supported Android/iOS hosts; software/mock acceptance only. No new host permissions, network listeners or agent-loop patches. Additive local metadata must remain conservatively protective for prior readers; source evidence and historical records are not bulk rewritten.
