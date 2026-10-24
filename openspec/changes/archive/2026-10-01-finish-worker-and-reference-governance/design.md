## Context

The last iteration established safe comparison shutdown and a v3 durable reference ledger. Remaining Workers and suite/baseline/Agent/pin/child consumers must use the same safety ordering without a new framework.

## Goals / Non-Goals

Goals: actual Worker exit precedes lease/device release; new built-in consumer records publish durable protection and explicit retirement; fault/restart tests demonstrate fail-closed behavior.

Non-goals: physical devices (explicitly deferred), query indexes, second execution engine, plugin market, automatic dev merge, historical bulk migration or broad disk-failure certification.

## Decisions

- Extract Worker exit ownership and single-result execution helpers. Native's streaming protocol keeps its existing queue and drains in-flight device calls even when termination rejects. Preserve original errors, clear listeners and suppress late replies. No supervisor or scheduling abstraction.
- Use per-target v1 publication markers (v3 ledger entries) in a bounded map for mutable built-in consumers. Reuse existing entries, publish new entries before consumer commit, commit retired markers before revoking. Snapshot validates marker identity and the expected active target set. Source hashes identify publication-time snapshots; a running run may subsequently change, while baseline approval continues strict current hash verification.
- Suites retain attempts until existing verified frozen facts; Agent flow retains until its verified terminal projection. Accepted Agent requests precede run creation, so the existing durable request reservation protects the future target until dispatch creates the run and publishes its ledger marker before opening execution.
- Suite attempts also use an execution gate across reference publication; otherwise the executing child can change its manifest between the two source-hash reads. Publication failure cancels before draining the gate. Baseline publication callbacks include the actual durable approval write.
- Baseline approval never automatically retires source references. Pin metadata remains compatible with pins.json and is a separate bounded owner record. Child references travel with their run and cleanup journal, remaining live in trash and retiring only after purge.
- Old records keep conservative scan protection. New markers are validated, not silently downgraded when malformed. A failed commit/revocation can leave protective orphans; never guess they are safe to remove.

## Risks / Trade-offs

- Worker never exits → keep shutdown and ownership pending; operator process termination is safer than releasing a live owner.
- Interrupted multi-file commit → surplus protection or blocked cleanup, not lost evidence; retries with durable markers complete revocation.
- Prior readers reject additive strict baseline metadata → fail closed, never strip metadata to force rollback.
- Large reference sets → retain explicit record/index budgets and test bounded behavior.

## Migration Plan

Apply on the existing architecture branch. Write markers for newly created/updated consumers only; keep archived run bytes unchanged except normal producer writes. Verify current and prior-reader behavior with synthetic local stores, then run all engineering gates and packaged probes. Commit/push without merging dev.

## Open Questions

None for this bounded software iteration. Physical-device acceptance remains explicitly deferred, not marked passed.
