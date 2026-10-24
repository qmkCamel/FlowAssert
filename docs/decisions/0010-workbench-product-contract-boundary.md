# ADR 0010: Workbench product contract boundary

- Status: accepted
- Date: 2026-09-25
- Owners: Workbench core (`src/workbench-contracts.ts`), with adapters owned by their existing Viewer, CLI, MCP/DSH, provider, and store modules

## Context

The three active productization changes deliberately overlap at the reporting boundary:

| Change | Owns | Depends on |
| --- | --- | --- |
| `harden-workbench-adoption` | Product contract, provenance, managed execution, evidence delivery, retention, trial gates | Existing Workbench execution and provider boundaries |
| `add-workbench-authoring-and-visual-validation` | Authoring, validation, selector assistance, explicit visual assertions | The shared product contract and evidence references |
| `add-workbench-long-term-operations` | Scheduling, trends, quarantine, remote workers, governance | The shared product contract and managed-job records |

The pre-existing `add-workbench-*` changes remain capability-specific. None of them may introduce another definition of provenance, verification dimensions, evidence lineage, result/exit semantics, or background-task status.

## Decision

`src/workbench-contracts.ts` is the only source of truth for the shared product contract. It owns:

- versioned attributed provenance (`observed`, `declared`, or `unknown`);
- verification dimensions and evidence references;
- original/derived evidence lineage;
- background-task status shape;
- legacy/future-version read projection;
- clean, recovered, failed, cancelled, and inconclusive result projection.

The storage manifest may embed this contract, but `workbench-store.ts` does not reinterpret it. Providers expose only bounded, already-collected public metadata through `MirrorProvider.runProvenance`; they do not read arbitrary environment variables or reveal device identifiers. The Viewer, CLI, MCP/DSH, suites, comparisons, and later scheduling/remote-worker adapters consume the shared projection rather than maintaining their own verdict tables.

## Compatibility rules

- A legacy manifest without the contract remains readable and is projected with unknown/not-performed fields. It is not rewritten merely because it was read.
- A supported contract is parsed strictly. Unknown fields or invalid source attribution fail validation.
- A future contract version is metadata-readable but is not interpreted or rewritten by an older build.
- New writes with an unsupported contract version are rejected.
- `recovered` and `flaky` remain non-clean outcomes with a non-zero CI result.
- Evidence byte hashes prove integrity only. A public derivative has a separate identity and an explicit source reference.

## Consequences

Later changes extend capabilities around this boundary. A schema change requires a product-contract version decision and compatibility fixtures, not an adapter-local field. Provider/transport changes continue to follow the existing `MirrorService` boundary and, when material, require their own ADR update.

## 2026-09-25: Derived sharing and local retention

The v1 archive remains readable. A v2 reviewed derivative has a random public share ID, new byte hashes, transformation/review/withheld metadata, and a reported source verdict, but its imported trusted verdict is always inconclusive/not-revalidated. Public evidence lineage uses a withheld source reference; the exact original run/file mapping lives only in a private local share journal. A derivative is never an automatic passing baseline. No continuous media or raw private journal crosses MCP/DSH or the archive boundary.

Retention uses the store's process owner and mutation gate plus explicit read leases. A generation-bound dry run lists protected refs and candidate bytes; confirmation rechecks references before a move to trash. Moving releases no physical space. Restore is non-overwriting; purge is separately confirmed and irreversible. Agent request journals remain outside media trash and their run references are conservatively protected, preserving request ID idempotency. Automatic deletion and purge are off by default. These are storage/product-contract rules, not a provider or transport change.

## 2026-09-26: Baseline approval and store fencing

The run store now records a process identity, nonce, and owner generation. A second live or unverifiable owner fails closed; stale PID reuse does not grant ownership. The short claim mutex is never removed solely by elapsed time; if its holder dies inside the critical section, exact manual recovery is required rather than racing a second writer. An ordinary dead owner lock can be reclaimed because its claim mutex was already released. The in-process mutation gate fences durable references, baseline approvals, retention confirmation and read-lease registration. This does not create a shared daemon or device-level cross-process lease.

Visual baseline candidates use a registered project PNG or a clean original passing run PNG. Preview holds a short read lease and binds source image/manifest hashes, rule hash, build scope, expected revision and expiry. Explicit local approval rechecks those values and publishes one immutable revision with its run-source protection in the same committed record. A run-source revision fails closed if its manifest or source image later changes. Ordinary test execution overlays the latest approved profile before compiling a new plan; already accepted suite snapshots keep their prior revision. This remains deterministic pixel verification, not general visual understanding. The Viewer displays the reviewed image and requires an explicit check and reviewer alias; Mock/Viewer engineering checks do not establish real-App cross-build acceptance.

Retention also records move/restore/purge intent before filesystem mutation and conservatively classifies uncertain restart states. This is a partial recovery boundary: the exhaustive independent-process interruption matrix, capacity reservation, and persistent Agent tombstones remain open and must not be inferred from the current journal tests.

Trend pages carry a generation plus manifest digest so pagination can continue against the same immutable derived generation after a rebuild. The two-window read path keeps source run leases while reading, uses UTC half-open windows and an explicit build A/B dimension, and emits only descriptive versioned budget signals after the 30/30 first-pass gate. Cached trend generations do not replace original evidence or a future durable tombstone summary; evidence integrity and cleanup history still require the remaining R4/R5 work.

## 2026-09-26: Evidence-guided failure triage (experimental)

`add-evidence-guided-failure-triage` adds a derived, immutable report over an already finished run and an optional explicitly chosen completed comparison. The report retains the original verdict; four investigation directions are multi-label evidence checks, never automatic root-cause or product-pass judgments. Facts use recorded domains/codes and registered evidence references, not free-form log/image text. Locator-change is only a conservative candidate from the existing safe repair inspection; it does not confirm or execute a repair. A pass run is not-applicable, while missing facts yield unknown.

The existing `RunProductContract` and result projection remain the source of truth. Triage report v1 stores generation-time facts and a semantic digest; a read-time wrapper separately reports present evidence integrity and staleness without rewriting the original run or historical report. New triage evidence references use v2, while existing v1 references and operations stay unchanged. Readers of retention must fail closed on unknown versions. A short store mutation gate revalidates the run/owner, then publishes the protective reference, immutable report and succeeded job. Read APIs require the succeeded job and protection; restart recovery revokes an incomplete no-report reference instead of exposing it. Retiring a report writes a tombstone and revokes only its own reference under the same gate; it does not delete source media or other references. Independent-process crash/ENOSPC and filesystem replacement recovery remain explicit acceptance gates.

Generation is an explicit local Viewer/CLI action under the existing loopback/Origin boundary. The Agent tool only reads an already generated report, and only when an authorized registered execution owns the run; it cannot start, review, retire, obtain raw media, or alter Harness's agent loop. No provider, continuous media transport, or Appium boundary changes are introduced. The initial UI is experimental until dual-device, frozen-corpus, and independent-user gates in the OpenSpec change are met.

Rule computation runs in a bounded worker thread with cancellation and a terminating timer. This isolates the deterministic rule pass, not every input-loading and selector-assistance operation; it is not yet a complete hard process or total-budget boundary. The same packaged artifact has been exercised in clean-install Viewer/CLI/MCP and DSH Native/PTC Mock probes. Those host checks establish adapter interoperability, not real-device or independent diagnostic benefit.

## 2026-10-06: Report presentation and reviewed passive HTML

The report directory and analysis consume `runResultProjection` through one presentation module. Summary queries version independently from raw run APIs, retain unreadable coverage and execution denominators, and never hash image/structure payloads to manufacture a current verification claim. Identity-based history and existing trend formulas remain separate.

Offline HTML is a passive presentation artifact. A source adapter creates ReviewedReportSnapshot v1 from the existing share pipeline's transformed pixels/roles and a bounded allowlist. The renderer accepts only this schema, not a source run or storage capability. Private observations, labels, times and identifiers are withheld; type-level expectation templates are explicitly distinguished from exact source assertions. Runtime limitations and recorded measurement statuses remain descriptive source facts. HTML cannot become an automatic passing baseline or a machine-importable archive.

The existing single-owner share queue freezes final HTML bytes before explicit review and retains its source/mask/format/template bindings until expiry. Durable HTML jobs use commit manifest v2 with artifact/map hashes; existing JSON job manifest v1 and archive v2/v4 semantics remain. Older implementations reject unfamiliar HTML publication rather than exposing partial files; retain source references during rollback. No provider, media transport, Harness agent-loop or Agent authorization boundary changes are introduced. Real-device material and independent-user acceptance remain open in the active change.
