# 0015 — Shared durable acceptance, isolated authorization

Status: accepted; shared acceptance, revisioned case library and authoring/analysis integration implemented. Physical-device and independent-user acceptance remain deferred.

## Decision

`WorkbenchApplication` owns `WorkbenchAcceptance`. Its fixed Agent and Viewer channels share bounded durable journal IO, capacity admission, serialized identity lookup, recovery without replay, uncertainty fencing and shutdown coordination. The component has no provider or transport access. `WorkbenchService` / `MirrorService` remain the only execution/device owners.

Agent policy, catalog revision, registered flow/suite identifiers, project-scoped request hash, v1 `agent-executions` records, reference publication and public tools remain in the Agent adapter. Viewer consent does not register a flow or grant Agent permission. Old `POST /api/runs` remains unchanged.

`WorkbenchAuthoring` compiles and lints frozen YAML/parameters into a runtime-local ten-minute receipt bound to project, compiler, App/platform and session generation. Validation never dispatches device mutations. A new run requires explicit local-evidence consent. An accepted retry is looked up before receipt validity; a changed request digest conflicts. An unaccepted request after restart must revalidate.

Viewer v1 journals live in `authoring-executions`, independent of both run manifests and Agent journals. They store identities and bounded execution summaries, not YAML/parameters/receipt tokens. Their run dependencies publish through the existing reference ledger as `workbench:authoring`. The conservative publication/tombstone ordering remains unchanged; no consumer-specific retention scan is added.

## Failure and compatibility rules

- Durable acceptance precedes executable device work. Publication uncertainty fences that request for the current runtime; restart reads durable facts and never replays it.
- Capacity unknown/insufficient fails closed with the existing 256 MiB margin. Existing request tombstones are not evicted to admit new work.
- Directory/file symlinks, invalid identities and conflicting recovered request keys are rejected.
- Shutdown stops acceptance, drains queued acceptance and the existing execution owner, then closes storage. A receipt never bypasses the target recheck immediately before acquiring the existing run lease.
- Old Agent journals retain their paths and format; new Viewer records are not disguised as Agent records. Rollback must preserve new journals and conservatively protect referenced runs.
- Journal outcomes describe recorded execution, not perpetual evidence validity; use the existing run/result projection and artifact checks to inspect current evidence.

## Validation / remaining work

See `tests/workbench-acceptance.test.ts`, `tests/workbench-authoring.test.ts`, the unchanged Agent regression suite, frozen contract hashes, and `scripts/authoring-compatibility-probe.mjs`. The subprocess matrix kills the process at acceptance sync/rename, reference publication and terminal persistence boundaries, then asserts no repeated Mock device write.

`WorkbenchCaseLibrary` is application-owned and uses the existing store mutation gate and capacity admission. Immutable revision publication precedes a single atomic catalog-head/request-receipt commit. CAS and request digests preserve competing edits and uncertain retries. Catalog limits are 32 MiB, 1000 cases, 100 revisions per case, 10000 retained mutation receipts and 50 summaries per page; revision files are bounded to 128 KiB and public requests to 80 KiB (64 KiB YAML). Published orphan revisions count toward capacity; no implicit GC or identity eviction is allowed. A corrupt index fails explicitly rather than becoming an empty library.

Cases live in `cases/`; they are not run manifests or retention candidates. `authoringOrigin` is optional provenance only. New authoring runs verify the immutable case revision against receipt YAML, parameters, project digest, App and platform. Later edits or archive operations cannot rewrite a run. Existing run/Agent contracts and 17 host tools remain unchanged.

The Viewer uses native hash routing and separate authoring/analysis modules. Nondestructive navigation retains the mounted draft; replacing/opening another draft requires save/discard/cancel. Analysis uses verified registered artifacts, never live media as missing historical evidence. Repair hands reviewed proposals to the existing advanced editor/repair owner; it does not bypass the existing digest or silently register a new case. Investigation proposes bounded checks without executing them or rewriting outcomes.

Evidence and remaining gates are recorded in `openspec/changes/improve-workbench-authoring-and-analysis/implementation-validation.md`. Rollback to the tested previous reader preserves `cases/`, `authoring-executions/`, source manifests and protective reference orphans. Do not remove those directories to make an old reader appear compatible. Physical-device acceptance and independent user outcomes cannot be inferred from Mock or package probes.
