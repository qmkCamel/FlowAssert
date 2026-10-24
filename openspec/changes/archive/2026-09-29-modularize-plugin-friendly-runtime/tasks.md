## 1. Stable boundaries

- [x] 1.1 Extract run domain types, preserve compatibility exports and migrate internal imports.
- [x] 1.2 Isolate AppClaw perception/selector imports behind an adapter without changing execution behavior.
- [x] 1.3 Move legacy reference scans behind the reference snapshot boundary; support durable namespaced consumers and owner-checked revocation.

## 2. Composition and lifecycle

- [x] 2.1 Introduce shared application/device composition and inject it across Runtime, Viewer and Coordinator.
- [x] 2.2 Implement ordered idempotent shutdown, admission-race handling, background task draining and startup rollback.

## 3. Analyzer extension

- [x] 3.1 Implement trusted startup-selected analyzer descriptor, bounded worker runner, frozen provenance and validated output with core-owned verdicts.
- [x] 3.2 Verify second/disabled/invalid/hanging analyzers and legacy report compatibility without changing core execution or retention.

## 4. Delivery verification

- [x] 4.1 Add architecture and lifecycle regression tests including durable-reference protection after restart.
- [x] 4.2 Run check, E2E, build, pack, MCP and packaged-analyzer probes; inspect runtime screenshot and report host/device limits.
- [x] 4.3 Update ADR, architecture guidance, governance TODO and implementation verification record; validate OpenSpec.
