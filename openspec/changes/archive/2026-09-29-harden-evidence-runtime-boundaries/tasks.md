## 1. Specification housekeeping

- [x] 1.1 Sync and archive modularize-plugin-friendly-runtime and repair documentation links.

## 2. Durable consumer references

- [x] 2.1 Implement protected publication, identity validation and tombstone-first retirement for comparison/share.
- [x] 2.2 Test publication/retirement failure cuts, restart, legacy records, missing references and unchanged source manifests.

## 3. Execution boundary

- [x] 3.1 Add versioned schema and sequence/state validation before native Worker events can dispatch device actions.
- [x] 3.2 Test malformed, unsupported, duplicate, invalid-transition and late/cancelled messages plus real native execution.

## 4. Measurement and validation

- [x] 4.1 Add and run reproducible 100/1,000/10,000-run query benchmarks and record optimization decisions.
- [x] 4.2 Investigate the capture failure, add deterministic regression coverage, and report whether its root cause is proven.
- [x] 4.3 Run check/E2E/build/pack and packaged runtime probes; inspect UI screenshots; discover devices and separately record physical validation or an explicit unavailable-device gap.
- [x] 4.4 Update ADR/TODO/validation docs, validate OpenSpec, and commit/push only intended changes.
