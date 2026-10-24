## Why

Comparison has a private queue and Worker but is absent from application shutdown. Existing local import checks do not cover the full dependency graph, so lifecycle and layering guarantees can regress unnoticed.

## What Changes

- Make comparison admission, cancellation, shutdown and Worker termination explicitly owned and awaited, including failure paths and restart recovery.
- Audit other background components and document their lifecycle owners and remaining boundaries.
- Add graph-based architecture checks covering runtime imports, re-exports, dynamic literal imports and cycles, with negative fixtures.
- Add deterministic lifecycle/fault tests and preserve source evidence and durable references.

## Capabilities

### New Capabilities
- `runtime-lifecycle-boundaries`: Owned shutdown and enforceable module dependency boundaries.

### Modified Capabilities
None.

## Impact

Comparison/application lifecycle, internal Worker handling, architecture tests, ADR and acceptance records. Android/iOS capabilities, DSH/MCP tools and device authorization are unchanged. Trusted Node workers remain execution isolation, not a third-party security sandbox. No new plugin framework, index/database migration or multi-engine API. Deliver on the existing feature branch; merging dev requires separate direction.
