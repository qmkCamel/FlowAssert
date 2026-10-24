# Workbench trusted-adoption validation

Date: 2026-09-25. Branch: `dev`. Scope: software-only implementation for `harden-workbench-adoption`; no Android or iPhone was connected.

## Implemented and checked

- Versioned, strictly parsed product contract for attributed provenance, verification dimensions, evidence lineage, task status, and one result projection.
- Golden fixtures for legacy/future/missing/derived records. Legacy reads do not rewrite the manifest; future contracts are not interpreted or accepted for writes.
- Bounded provider metadata collection, trusted declared build/data context, path/secret-shaped public-value rejection, and strict missing-provenance rejection before run ownership or device writes.
- Viewer provenance display, legacy explanation, and comparison differences for App version/build and environment.
- Existing attach CLI preserved; managed job uses a loopback runtime, existing coordinator/provider/device claim, bounded cancellation/shutdown, and separate suite/job exit codes.
- JSON/JUnit output, report/cleanup precedence, no-recording declaration, external-Viewer ownership test, child-process SIGINT test, and self-hosted runner example.
- Public documentation no longer links private local evidence; file-URL conversion covers this checkout's non-ASCII space.

## Verification results

| Command / check | Result |
| --- | --- |
| `pnpm check` | Passed: 52 files, 426 tests |
| `pnpm test:e2e` | Passed: 46 tests |
| `pnpm build` | Passed |
| `pnpm pack:check` | Passed; managed-job guide and ADR present in dry-run contents |
| `openspec validate harden-workbench-adoption --strict --no-interactive` | Passed |
| Full strict OpenSpec validation | Passed: 31/31 |
| `git diff --check` | Passed |
| Viewer screenshot | Inspected `artifacts/screenshots/mobile-mirror-workbench-evidence.png`; provenance sources/unknowns are readable and do not crowd the live device view |

The slow-source, long-flow cancellation, slow text input, slow prepare, and managed-job tests keep unrelated controls or progress/status available, retain prior evidence on failure, refresh after success, and use run/job timestamps rather than a generic global spinner.

## C0 candidate identity and clean-install boundary

| Item | Recorded value |
| --- | --- |
| C0 acceptance source | `REDACTED_REVISION` |
| Candidate package | `flowassert-0.1.0-alpha.2.tgz` |
| Candidate SHA-256 | `3fe79a65c1d11c9e6b62e5912a0cb74358080dfa72902788c6cc74a69a68a211` |
| Standalone/MCP clean prefix | Passed: CLI `0.1.0-alpha.2`, 16 tools, Viewer localization, signal cleanup, packaged YAML and registered Agent tests |
| DSH dependency closure | Exact `0.1.5-rc.2` root plus 230 DSH-family packages; mixed rc.3 resolution is now rejected |
| DSH Native/PTC | Not accepted: both tool lifecycles reached `lifecycle=complete`, but the host then exited because its user patch watcher could not find the Cordis HMR service |
| Physical providers | Not run; no device was connected |

The packed contents include the root README, managed-job guide, ADR, Workbench usage guide, validation record, and executable CLI/MCP/Viewer entry points. Repository-only examples and GitHub governance files remain intentionally excluded from the runtime tarball. The candidate is local evidence only: no tag or Release was created.

## Deliberately unverified

- Appium metadata values on a connected Android and iPhone;
- physical disconnect/lock/rotation/driver fault matrices;
- per-platform 30-run benchmarks and physical-App false-pass measurements beyond the offline corpus below;
- clean-package upgrade/rollback against the previous supported artifact;
- successful DSH `0.1.5-rc.2` host shutdown after the Native/PTC probes; the completed tool lifecycle does not override the later HMR process failure;
- two external pilot apps, 20 flows, five first-time users, and seven days / 100 scheduled runs;
- any release tag, GitHub Release, npm publication, or production-support claim.

Those OpenSpec tasks remain unchecked. Mock/software evidence must not be used to close them.

## 2026-09-26 offline negative-result corpus

`tests/workbench-contracts.test.ts` now generates 100 distinct, deliberately non-clean cases: ten IDs each for UI assertion failure, business-verifier failure, visual failure, cleanup failure, recovered, evidence conflict, evidence contamination, inconclusive, cancellation, and unavailable evidence. The first four deliberately carry a contradictory reported `pass` to test the fail-closed projection boundary. All 100 projected to non-clean/non-zero results: observed false passes **0/100**. The projection now reports `verification-conflict` and exit 2 when a reported pass conflicts with an explicit failed dimension (or a required dimension in a supported contract is not passed). This is a deterministic software corpus, not an empirical estimate of false-pass risk on real Apps or devices.

The `pnpm check` gate on this checkout passed 64 files / 549 tests after these changes. The physical Android/iPhone failure matrix and their 30-run benchmarks remain separate pending acceptance work.

## 2026-09-26 same-tarball clean-prefix probe

The uncommitted `dev` worktree was packed as `flowassert-0.1.0-alpha.2.tgz` (SHA-256 `2e67bc3c4d9570d3a028375367933e5ea60e57283cce563b2a1e522e11baffe2`). `scripts/release-candidate-probe.mjs` verified the checksum and installed this exact tarball outside the repository: standalone CLI reported `0.1.0-alpha.2`, Mock/MCP exposed 16 tools, Viewer localization and signal cleanup passed, packaged YAML passed with evidence hashes, and catalog/flow/suite/cancel/evidence Agent probes passed.

A separate temporary Harness closure resolved `@deepseek-ai/dsh@0.1.5-rc.2` with 230 pinned family packages. `scripts/dsh-clean-profile-probe.mjs` installed the same tarball into a new `web` profile and passed Native/PTC tools, registered test probes, image/text-only catalog projection, and normal process lifecycle. The probe explicitly sets the documented profile `dsh.profile.patchReload: startup`: the rc.2 default live watcher otherwise completes tool work and then exits with `user patch-layer watching requires the Cordis HMR service`. This is a host-profile boundary, not a change to the DSH agent loop; default live-reload shutdown remains unaccepted. The Mac's everyday `dsh` is rc.8 and was not substituted for this rc.2 result. No real model provider call or physical device was part of this probe.

## 2026-09-26 additional offline engineering gates

The repository-only HTTP business template passed a fake-service suite covering positive/negative asynchronous verification, uncertain single-write behavior, scoped cleanup failure, response-size limits, and project/plan loading. It does not provide the missing two real App builds or pilot authorization. The repository-only `docs/workbench-compatibility.md` guide makes the prior-package limitation explicit: the published alpha.1 predates this Workbench and cannot establish a supported Workbench rollback baseline.

Share job records now persist the hashed request key before publishing the request index, so a restart in that write gap reconstructs the same interrupted job rather than accepting a duplicate conversion. Trend comparison reports failed/cancelled/recovered duration summaries separately from eligible first-pass performance samples, with explicit 29/30, threshold-equality, zero-baseline and non-finite boundary tests.

After these edits, `pnpm check` passed **65 files / 555 tests**, `pnpm test:e2e` passed **54 tests**, `pnpm build` and `pnpm pack:check` passed, all three active changes passed strict OpenSpec validation, `pnpm public:check` passed **665 files / 63 reachable commits**, and `git diff --check` passed. The first full `pnpm check` attempt hit a 30-second timeout in the full-history public-readiness integration test while 554 other tests passed; its isolated rerun completed in 12.49 seconds. The test-specific budget was raised to 90 seconds for parallel-suite contention, then the full gate passed. E2E refreshed screenshot artifacts; this record does not claim any new physical-device run.

A subsequent isolated Mock regression extended the retention Viewer test to a two-run move, one restore, one independently confirmed purge, and unrelated theme/language interaction; its first attempt exposed a stateful demo flow, so the second case now uses an assertion-only fixture and the test passes. The Agent journal/retention integration test also now proves a finished single-flow run can move/purge media while requestId remains durable, status downgrades to evidence-unavailable, and restart/retry dispatches no device action. Old/incomplete Agent journals and suites still protect their referenced media. The fresh full gate passed: `pnpm check` **65 files / 556 tests**, `pnpm test:e2e` **54/54**, `pnpm build`, `pnpm pack:check`, `pnpm public:check` **670 files / 63 reachable commits**, all three strict OpenSpec validations, and `git diff --check`. The isolated retention screenshot was visually inspected; its candidate count, protected count, no-free-space warning and explicit confirmation are legible.

The later candidate package at `/tmp/mobile-mirror-final-0HNoND/flowassert-0.1.0-alpha.2.tgz` has SHA-256 `568c9e00ddc61ebeafdb5e8f1c29046c671b9010045c49a723b022d2c222a14a`. The checksum-verified clean-prefix probe passed standalone CLI, Mock/MCP 16 tools, Viewer localization, shutdown, packaged YAML/evidence hashes and Agent catalog/flow/suite/cancel/evidence. The same tarball passed the clean DSH `0.1.5-rc.2` Native/PTC, registered Agent tests and catalog-level image/text-only projection using `patchReload: startup`, with normal lifecycle completion. These results supersede the earlier candidate hash for the implementation tested here; they do not validate the default live HMR mode, a real provider image call, physical devices or external pilots. This report text was updated after the package probe; a final release package must be rebuilt and re-hashed from its exact release tree.

## 2026-09-26 default-off semantic-vision evaluation

`src/workbench-visual-eval.ts` adds a repository-only candidate seam with no device handle, baseline write, product verdict update or automatic model request. Synthetic tests cover disabled-by-default, denied external sharing, cross-split image overlap, explicit wrong-positive/wrong-negative/unknown counts, 2 MiB image budget, 10-second ceiling, cancellation, single-request response, and rejection of a candidate action field prompted by image text. Current result is **no-go** because there is no authorized real frozen dataset or approved external model/image sharing; see [experiment boundary](workbench-visual-evaluation.md). No real model accuracy or latency is claimed.

After this addition, the complete software gate passed again: `pnpm check` **66 files / 562 tests**, `pnpm test:e2e` **54/54**, `pnpm build`, `pnpm pack:check` (including the experiment-boundary document), strict OpenSpec checks for stages two and three, `pnpm public:check` **674 files / 63 reachable commits**, and `git diff --check`. The previously probed candidate tarball predates this repository-only harness and subsequent documentation/package-file-list edits; it remains evidence for the runtime code at that point, not a byte-for-byte release artifact of the final tree.

## 2026-09-26 offline reference, history and admission follow-up

The current dirty `dev` worktree adds separate-process SIGKILL tests at five baseline approval cutpoints; a published revision remains readable and an unpublished temporary never becomes executable. Suite attempt media can be released only after an explicit confirmed HTTP action freezes every verified attempt's source manifest digest, result projection and sanitized trend facts. An intentional move/purge with a matching lifecycle journal preserves the historical planned-case denominator while showing evidence unavailable; loss without that journal becomes inconclusive. A reader attempting to acquire a lease during a cleanup commit waits behind the mutation gate and cannot lease an already moved identity.

Storage scans now report run/trash/export/baseline/index categories with complete-scan counts. New runs, archive imports and share exports reserve bounded space above a 256 MiB safety margin; unknown or insufficient capacity fails closed before new device action or publication. Injected ENOSPC at six store write cutpoints keeps earlier evidence readable and does not create a new pass. Business hook/resource-journal, Viewer history selection and result/provenance rendering were extracted without changing the public report schema. These are software and Mock facts only; no actual low-disk physical device or real user archive was modified.

Final local gates for this follow-up: `pnpm check` **68 files / 581 tests**, `pnpm test:e2e` **54/54**, `pnpm build`, `pnpm pack:check`, two strict OpenSpec validations and `git diff --check` passed. The first full E2E run missed a transient Android “Connecting” text assertion under parallel load (53/54); isolated rerun and the final full run passed. The retention preview screenshot at `artifacts/physical-validation/retention-preview-desktop.png` was inspected for category counts, scan coverage and confirmation clarity. No new same-tarball physical-host probe or external pilot evidence is claimed.

The subsequent offline follow-up also reserved space for baseline approval, trend generation, comparison artifacts and suite metadata before their writes; capacity-denial tests confirm no new baseline/report/index or suite attempt is accepted and earlier facts stay readable. The Viewer repair/comparison action state moved into dedicated modules, and a delayed repair-confirmation response no longer overwrites a manually edited draft. `pnpm check` passed **68 files / 585 tests**, `pnpm test:e2e` passed **54/54**, and `pnpm build` and `pnpm pack:check` passed. One intermediate full `pnpm check` hit two timing-sensitive tests (20 ms child stop grace and a dispatched tap wait); their isolated rerun passed 56/56 and the later complete gate passed 585/585. The baseline review screenshot was inspected after the Viewer split. These checks still use local/Mock data, not a physical device or external pilot.
