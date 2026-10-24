# Runtime gates acceptance audit — 2026-10-05

Implementation is engineering-only until the individual platform/business requirements below are met. No change is archived and main specs are not silently promoted.

**2026-10-07 follow-up:** authorized live iPhone `devicectl` details and scoped crash-archive access are now checked, completing health task 6.3 (29/32). The dated “live source not checked” statements below describe prior runs, not the current task status. Archive readability still does not release crash/hang collection; health 6.2/6.4 and real-business 6.6 remain pending. Historical October 6 physical USB runtime evidence is re-read without changing its verdict. See [current follow-up and explicit blockers](physical-validation-2026-10-07.md).

## Provenance and boundaries

- Base: origin/dev REDACTED_REVISION; branch feat/temporal-runtime-gates in a separate attached worktree.
- Primary checkout dev@REDACTED_REVISION and its existing modified screenshots/untracked triage materials are preserved. This feature is not merged into the primary checkout.
- Node 24.19.0 / pnpm 11.7.0 / macOS arm64. Worker protocol stays v1; opt-in product/summary v2 is shared by both changes.
- Initial engineering snapshot: 436 files under src/viewer/scripts/tests/examples/fixtures plus package/config/lock inputs; SHA-256 731971699eaa97834c0ca184073c869e7ac28b1d851428c3703bf600c07536f1. Digest uses sorted repository-relative path + NUL + file bytes. The 2026-10-06 physical follow-up changes only the probe script and synthetic Android fixture, not product runtime behavior; its frozen digest is 5c517505010e7e62788b9687ee97f40089e180d405bdc83547c48dee95458ad6 (436 files).
- DSH version remains the project's existing 0.1.5-rc.2 contract. This audit does not claim a fresh DSH host/real model run or change its agent loop.

## Engineering evidence

Tests and source owners:

| Requirement family | Implementation | Evidence |
| --- | --- | --- |
| temporal timing/bounds | workbench-temporal/runtime-syntax/plan | runtime-gates + runtime-integrity tests: delayed/negative/late/gap/first-counterexample/no-reset/cancel/fake monotonic clock |
| complete/scoped observations | workbench-temporal-evidence + owned checkpoint | malformed/empty/truncated/sensitive/ambiguous/missing-parent/blocker rejection and saved XML replay |
| restart policy/unknown mutation | WorkbenchDevice + MirrorService | authorized restart and uncertain terminate fence; existing lifecycle/policy/observation regression suite |
| business truth/unique window | runtime-execution + only-once verifier | mismatch-only polling, late/failed reads, per-sample material, header conjunction, two explicit synthetic submits and injected duplicate/amount/owner/delayed duplicate/cleanup faults |
| performance endpoint | workbench-measurement + runtime-evidence | equality/over-budget/fast functional failure/empty endpoint/provider error, repeated instances and immutable original failure |
| health attribution/coverage | health-contracts + private journal/window | process epoch/slot/App/time identity, duplicate/conflicting/out-of-order events, expected exit/crash, losses/queue/drain/budgets; synthetic collector only |
| interruption/admission/privacy | store + owned command helper + source/share routing | unknown/low capacity, damaged temporal/private health evidence, SIGKILL recovery, noncooperating child forced reap, v1/v2/3/4 routing and no imported green proof |
| result consumers | shared projection + native/matrix acceptance + suite/trend | legacy golden, runtime JUnit properties, v2 required dimensions, unknown version/feature failure and evidence leases |
| user action contract | existing async run lifecycle + Viewer stages | Playwright >=1800 ms sampling and 1200 ms drain; history/theme remain usable; duplicate button protection; cancel/previous result/domain completion |

Retained synthetic Viewer images: runtime-gates-sampling.png, runtime-gates-completed.png and runtime-gates-draining.png under artifacts/screenshots/. Reviewed: measurement value/threshold/status readable, scoped progress visible, drain shows final verdict pending rather than green, and no device identifiers/private App content. A v2-only heading wrap fix prevents long cancelling text from squeezing the run title.

Final serial `pnpm check --maxWorkers=1`: 105 files / 923 tests passed on the frozen snapshot; this command includes typecheck and lint:contracts. Earlier attempts are not erased: checks exposed the intentional v2 schema/allowlist migration, a wrong new cleanup expectation (cleanup is fail, overall inconclusive), an existing 2-second cancellation poll under default concurrency, and one mixed cached-source/new-test run while refinement was being added. The fresh revision-schema regression passed independently and the frozen full run passed; no source/test changes are made during final gates. One E2E run reached 74/75 and exposed an existing transient screenshot-busy assertion. Its fixture now explicitly delays PNG encoding >=1000 ms because a retained ImageBitmap can bypass the mocked img decode gap; product capture behavior is unchanged.

The final frozen-snapshot Viewer suite passed 75/75 (3.8 minutes). All four retained runtime/package screenshots were visually inspected again after that final run and the candidate probe. The scope is synthetic Mock, not physical iOS despite the demo phone illustration.

Candidate installation uses the unchanged frozen repository lockfile and workspace profile (not shipped as a new runtime dependency policy), including the existing appium-mcp exclusion. Unconstrained/offline attempts outside the workspace encountered missing metadata / the unrelated AppClaw Appium stack; copying the explicit frozen lock/profile and running `pnpm install --frozen-lockfile --ignore-scripts --prod` succeeded (226 packages, external installer pnpm 11.25.0). No --legacy-peer-deps, host prerelease mixing or external-device stack is used as acceptance proof. The repository probe driver may use test tools from this checkout; product libraries and Viewer assets are loaded only from the unpacked candidate.

## Android read-only source probe

Initial source-only probe: OnePlus KB2000 / Android 14 / API 34; ADB 1.0.41 (37.0.1-15733141); installed Appium 3.2.0 / UiAutomator2 6.8.0. That initial probe did not start a live Appium session and targeted the distinct old dev.mobilemirror.fixture package. On 2026-10-06 the dedicated runtime fixture was installed and actual managed UiAutomator2 sessions ran the cases below. The repeated source probe targets dev.mobilemirror.runtimefixture and confirms installed/readable/bounded diagnostic facts. Raw output/device serial is not in this document.

Both crash and ANR remain unsupported/source-completeness-unproven. Missing proofs: authoritative process generation, loss detection in-window, bounded late-event monotonic mapping and end-cursor drain acknowledgement. No confirmed platform health result is inferred from old exit history or empty logs.

The separate dev.mobilemirror.runtimefixture APK built successfully with Android API/build-tools 34 and OpenJDK 17. The initial phone confirmation stalled, but the subsequent authorized retry succeeded. No existing App was uninstalled/reset and no system permission/security setting was changed. Physical evidence and limits follow below; installation alone is not acceptance.

## Scenario traceability

The rows below enumerate all 41 delta-spec scenarios. `G` means tests/workbench-runtime-gates.test.ts; `I` means tests/workbench-runtime-integrity.test.ts; `E` means tests/e2e/workbench-runtime-gates.spec.ts. Engineering evidence is not platform release evidence. A future trusted collector must honor ready/drain/close abort budgets and force-reap only its own children before settling; an arbitrary JavaScript promise cannot safely be force-killed. No production collector is approved here.

| Spec | Scenario | Engineering evidence / acceptance boundary |
| --- | --- | --- |
| temporal | Invalid predicate | G unsafe runtime declarations |
| temporal | Infeasible sample budget | G gap inversion/unbounded samples; plan expanded limits |
| temporal | Delayed value becomes correct | G delayed monotonic sampler; physical Android negative-to-positive samples retained |
| temporal | Negative predicate on incomplete tree | I empty/malformed/truncated/scoped source rejection |
| temporal | Late success | G late observation and exact monotonic cutoff |
| temporal | State flickers | G first/mid-window counterexample without reset; physical Android true/true/false sequence fails |
| temporal | Host stalls during stable observation | G sampling gap; physical owned-host SIGSTOP/SIGCONT yields inconclusive gap |
| temporal | Persistent value after restart | G fixed Mock app state; physical Android fixed 1200 retention passes and intentional loss fails; real business pending |
| temporal | Uncertain termination | G terminate fence; activate unknown/cancel tests |
| temporal | Unsupported or unauthorized restart | G capability/policy refusal before ownership/actions |
| temporal | Business count converges | G typed mismatch-only eventual query and immutable samples |
| temporal | Verifier fails to read | G read failure/late once; existing extension process/credential tests |
| temporal | Stable uniqueness verifier cannot be retried into success | G published once-only declaration rejects eventually |
| temporal | Two actions create duplicate records | G two explicit synthetic submissions + duplicate/amount/owner/delayed faults; real business pending |
| temporal | Retry only hides an original failure | existing orchestration original-failure/flaky/exit-code test; G immutable original measured failure |
| temporal | Cancel before the next sample | G cancellation retains sample report/XML and prevents next tap |
| temporal | Evidence removed after execution | G corrupted sample read/acceptance downgrades and reported verdict retained |
| temporal | Long stable assertion in Viewer | E 1800 ms stability; history/theme interactive and previous result preserved |
| health | Unsupported iOS hang source | iOS read-only capability probe returns unsupported; no live iOS source release |
| health | Stale or foreign crash | I old/cross-App exclusions and private safe report |
| health | App process changes | I process generations/session epochs/slot identity; actual source remains unapproved |
| health | Empty but disconnected stream | I empty events with ready/drain/drop/time/process gaps |
| health | Attributed crash during test | I confirmed violation; G successful UI + final-drain crash stays failed |
| health | Buffered event after actions end | G final-drain event; E no final green before drain/close |
| health | Crash near an expected restart | I operation UUID expected exit never suppresses actual crash |
| health | Storage or buffer capacity exhausted | G capacity unknown/256 MiB admission; I queue/raw/event bounds |
| health | Collector ignores cancellation | I owned noncooperating command forced reap; G close/drain faults; real adapter admission remains open |
| performance | No assertion in selected path | I empty endpoint/prior assertion cannot satisfy block; G compiler no-assertion rejection |
| performance | Host wall clock changes | I injected monotonic elapsed independent from display timestamps |
| performance | Fast functional failure | G wrong native assertion and I endpoint-not-reached |
| performance | Deadline exceeded | G first-step startup deadline retained as fail; I equality/over-budget |
| performance | Read hangs rather than app running slowly | I provider fault classified inconclusive, not slow-App failure |
| performance | Fast retry after slow first attempt | G original failure + separate successful follow-up + loop instances; existing suite flaky test |
| performance | Restart during measured action | G owned child SIGKILL + store interruption recovery, no resumed writes |
| results | Old run without runtime gates | G legacy plan; original v1 golden fixtures unchanged |
| results | Old consumer sees required new feature | G/I unsupported versions/features; v2 required dimensions cannot be stripped |
| results | UI passed but health failed | G final-drain crash projection/JUnit; shared consumer regression suite |
| results | Missing required health in acceptance link | change-contract tests: old pass/new required dimension and revision downgrade refusal |
| results | Health evidence is corrupted | G private health-window damage and native acceptance semantic replay |
| results | Slow drain while inspecting history | E 1200 ms drain/cancel; theme/history remain usable |
| results | Synthetic crash fixture passes | Android diagnostic report remains unsupported; docs/source matrix separate engineering and platform evidence |

## Remaining tasks and exact prerequisites

| Change/task | What remains | Concrete prerequisite |
| --- | --- | --- |
| temporal 6.3 | real business persistence/two-submit truth | approved App/backend, isolated key, fixed expectation, authorized read-only truth query and cleanup |
| health 6.2 | Android crash/ANR controlled source release | source adapter with independently demonstrated epochs/cursors/loss/mapping/drain, then fault-injection fixture |
| health 6.3 | real iOS crash/hang source capability probe | authorized live diagnostic access; an installed/working signed Fixture and static unsupported declaration do not provide it |
| health 6.4 | iOS crash/hang signal release | complete App/process epoch, window/loss/mapping/drain source, then controlled signal positive/negative cases; signed runtime Fixture and WDA are now available |
| health 6.6 | real business endpoint timing | approved endpoint and business latency budget, same authorized business environment as temporal 6.3 |

The read-only Android source probe (health 6.1) is completed even though it truthfully reports unsupported. Source release tasks remain open. Audit/reconciliation tasks can complete without declaring the entire change complete. No platform dependencies block the engineering implementation or its ordinary Mock/package gates.

## Final engineering gate and checklist reconciliation

All code-bearing gates below use the frozen 436-file digest recorded above. Only documentation/checklist reconciliation follows them.

| Command / scope | Final result |
| --- | --- |
| `pnpm check --maxWorkers=1` | typecheck, contract lint and 105 files / 923 tests passed; 322.66 seconds |
| `pnpm typecheck` | passed independently |
| `pnpm test:e2e --workers=1` | 75 passed; 3.8 minutes |
| `pnpm build` | passed |
| `pnpm pack:check` | passed |
| `pnpm pack --pack-destination /tmp/mobile-mirror-runtime-package.Ks7xg9` | candidate tarball produced |
| external `pnpm install --frozen-lockfile --ignore-scripts --prod` | 226 production packages installed with the explicit unchanged lock/workspace profile |
| `node scripts/runtime-gates-package-probe.mjs /tmp/mobile-mirror-runtime-package.Ks7xg9/frozen/package/lib/application.js` | packaged Mock v2 measure/restart pass; sensitive temporal observation refused; legacy v1 pass; unsupported health refused before side effects; share v4 not revalidated; HTTP and command/MCP projections equal; actual CLI suite v2 clean exit 0; no browser page errors |
| strict OpenSpec validation, both changes | passed |
| public-readiness scan | final repeat passed: 1006 files, 89 reachable commits, 11 acknowledged legacy commits (earlier repeat had 88; repository-wide reachable refs can advance independently of this worktree) |
| `git diff --check` | passed |

Temporal tasks: **25/28**. Health/performance tasks: **27/32**. The **8 remaining tasks** are individually listed above (the iOS source probe and release are separate tasks); no whole-change completion, main-spec promotion or archive is claimed. No commit, push or merge is performed in this implementation turn. Existing tracked screenshots regenerated by the E2E suite are restored only in this originally clean feature worktree; the four new reviewed images are retained and the primary checkout is untouched.

## 2026-10-06 Android physical follow-up

Scope: this dedicated synthetic App on the selected OnePlus KB2000 / Android 14, managed Appium 3.2.0 / UiAutomator2 6.8.0. This is not real business persistence, production SLO, iOS or approved crash/ANR coverage.

- Initial APK 1.0 SHA-256: 66bc581f215e74bee5ab24291d5d3cbe994e3cfa389342342a3373d0d2e1aa60, independently matched to the installed base.apk. Its 1.5-second transitions could finish before the first checkpoint; those one-sample results alone are not credited as observed state transitions.
- Fixture 1.1 (versionCode 2) SHA-256: 783b57b89eaeaaa980dc5c2d3607c337aa396e7baf0a332cc62c940524688aa9, independently matched to the installed base.apk after the runs. Upgrade uses the same private local debug key and preserves this synthetic App's data. Delay becomes 5 seconds; blink starts at 6 seconds and restores at 10. Product sampling semantics and thresholds are unchanged. The original APK is retained privately as fixture-v1.apk.
- First startup exposed a probe-only Viewer construction mismatch; remove the standalone assistant override so the default matching device services are constructed. An early post-failure history-refresh click timed out; that failed attempt is retained. Subsequent complete runs passed, and HTTP request diagnostics remain in the probe for recurrence. No product workaround is applied.
- Final standard command: explicit DEVICE_ID / APPIUM_EXECUTABLE / ADB_PATH with `pnpm exec tsx scripts/workbench-runtime-android-probe.ts`. Private root: artifacts/physical-validation/runtime-gates-2026-10-06T05-35-57-011Z. The earlier strengthened complete run is retained at runtime-gates-2026-10-06T05-33-18-415Z.

| Physical check | Expected / observed |
| --- | --- |
| actual provider requires unsupported crash/ANR | preflight rejected before declared actions; no active run/owner retained |
| delayed completion | pass; final run samples false/false/true |
| sampled stability with mid-window counterexample | fail; samples true/true/false, no hidden reset |
| restart retains fixed Saved 1200 | pass; independent pre/post windows each have two matching samples |
| restart intentionally loses value | fail; fixed expectation remains unchanged |
| performance positive | pass; 8211.48 ms <= 20000 ms, automation-observed-e2e including required evidence |
| performance negative | fail; 1008.60 ms against fixed 1000 ms, performance-deadline and no later endpoint |
| UI-triggered cancel after a sample | cancelled; sample material retained, following tap not dispatched, run ownership released |
| pause only owned probe host for 8 seconds | inconclusive temporal-sampling-gap; measure is inconclusive, not pass; owned resume helper exits |
| manual USB interruption | not accepted: the separate 30-second window completed without observed interruption; no human fault confirmation, expected-inconclusive assertion correctly fails |

The final standard probe exits 0 and cleanup.json records idle lifecycle, no run owner and no owned managed runtime. It contains **9 matched checks**, not 10: the default USB case is explicitly not-performed. The separate USB attempt exits 1 and its root runtime-gates-2026-10-06T05-38-10-491Z is retained. It must not be counted as a disconnect pass. No global adb kill-server, root, global log clearing, existing App reset, or external service termination is used.

During live sampling the run button is disabled while theme/history controls remain usable; the active run remains running after those interactions. The final running.png shows Pending, local sampling stage and unknown verdict; performance.png shows the completed measured result. Both were visually inspected; they remain private/ignored and are not promoted to public screenshots. Readable diagnostics and an available paired iPhone inventory do not release any unverified platform signal.

Final follow-up verification on frozen digest 5c517505010e7e62788b9687ee97f40089e180d405bdc83547c48dee95458ad6:

| Gate | Result |
| --- | --- |
| `pnpm check --maxWorkers=1` | 105 files / 923 passed; 330.99 seconds; includes typecheck and contract lint |
| `pnpm test:e2e --workers=1` | 75 passed; 4.0 minutes |
| `pnpm build` and `pnpm pack:check` | both passed |
| strict OpenSpec validation, both changes | passed |
| fresh-process historical evidence read | all 8 saved native runs verify; verdicts pass/fail/cancelled/inconclusive preserved |
| installed candidate identity | local and installed 1.1 APK SHA-256 equal |
| `pnpm public:check` | passed: 1006 files, 89 reachable commits, 11 acknowledged legacy commits |
| `git diff --check` and frozen-source repeat | passed; the 436-file digest is unchanged after all gates |

The read-only replay initially used two unsuitable inline launch modes: CJS tsx evaluation could not resolve import-only AppClaw exports, and an ESM evaluation flag propagated to evidence workers. No evidence was rewritten. Dynamic imports under `node --import tsx -e` then reverified all 8 runs successfully. These launcher errors are not silently promoted to an evidence failure or omitted from the audit. The earlier external packaged-Mock proof remains tied to the earlier candidate; the new physical proof uses the source worktree, not a DSH host or installed desktop product.

Task totals remain 25/28 and 27/32 because the Android checklist includes USB interruption and the performance task includes both platforms. Human-coordinated USB injection, signed/authorized iOS runtime and diagnostics, approved complete crash/ANR source, and real App/backend truth and budgets remain the concrete prerequisites. No whole-change archive, main-spec promotion, commit or push is performed.

## 2026-10-06 manual USB retry

Two disconnect-only retries use the unchanged frozen source and installed synthetic Fixture. Both retain a successful sampled window rather than an interruption, so the probe's expected-inconclusive assertion exits 1. Neither is a USB disconnect acceptance pass.

| Private evidence root suffix | Run | Observation |
| --- | --- | --- |
| runtime-gates-2026-10-06T06-01-25-690Z | afee5fb7-9f7a-42b1-8fbb-8174b2a5b1fe | pass / sampled-window-satisfied; measurement 33423.26 ms |
| runtime-gates-2026-10-06T06-02-30-154Z | f15c0b6d-34d2-41f3-9adb-5d8f67e8b7e1 | pass / sampled-window-satisfied; measurement 34058.94 ms; explicit unplug prompt issued during sampling, but repeated read-only ADB inventory remained online and no human unplug confirmation arrived before completion |

Both cleanup records show idle lifecycle, released run ownership and no owned runtime; no listener remains on the managed Appium port. The prompts are expired: do not inject the fault after completion. Retry requires coordinated human readiness and an actual unplug during a newly armed sampling window. Temporal 6.1 and health/performance 6.5 remain unchecked. No runtime code, source digest or previously recorded engineering gate result changes in this retry.

Fresh-process native replay verifies both saved runs with their original pass verdicts; this verifies retention, not fault injection. The first replay launcher used a relative runs directory and was rejected before reading; resolving the absolute directory fixed that launcher invocation without rewriting evidence. Both strict OpenSpec validations and `git diff --check` pass. The four full engineering gates above were not rerun for this documentation-only retry.

### Coordinated retry: observed USB interruption

After the user confirmed readiness, a fresh disconnect-only probe used private root artifacts/physical-validation/runtime-gates-2026-10-06T06-14-10-625Z, native run c3c5b4a5-4270-4a55-ac3c-c8d243958815. The unplug prompt was issued after sampling started. The user confirmed unplugging and a concurrent read-only ADB inventory contained no devices. This is the first credited physical USB interruption; the earlier no-injection attempts remain above.

- Four matching samples and their PNG/XML materials were retained before the next observation failed. The stable assertion is inconclusive / temporal-observation-failed with incomplete coverage, not pass.
- Measurement is inconclusive / measurement-observation-failed, elapsed 11075.29 ms against 60000 ms. An infrastructure interruption is not reported as App performance failure or healthy success.
- The dispatch journal contains only the earlier settled activate and save tap. No further write, implicit restart or automatic retry is dispatched after interruption.
- Probe exits 0 because the expected inconclusive outcome matched. Native run cleanup says session-retained; the probe's subsequent explicit owned-service cleanup records idle, released run ownership and runtimeOwned=false. No managed Appium listener remains. Do not conflate the run cleanup policy with the outer probe cleanup.
- Fresh-process native evidence replay returns verified and preserves the inconclusive verdict. The user confirmed reconnection after evidence retention, and ADB again reports the selected device online (new transport generation); no run resumes on reconnect.

Temporal 6.1 is now complete: **26/28**. Health/performance remains **27/32** because 6.5 also requires iOS. The **7 remaining tasks** are temporal 6.2–6.3 and health 6.2–6.6, with exact prerequisites in the remaining-tasks table. This completes the selected synthetic Android temporal acceptance, not crash/ANR, iOS, real-business or whole-change release. Runtime source remains unchanged; only documentation/checklists are reconciled, so the prior frozen full engineering gates retain their original scope. No archive, main-spec promotion, commit, push or merge is performed.

After this checklist reconciliation, both changes pass strict OpenSpec validation and `git diff --check` passes. No full engineering gate rerun is claimed for this documentation-only update.

## 2026-10-06 iOS physical follow-up

Latest status supersedes the earlier Android-only counts: temporal **27/28**, health/performance **28/32**, combined **55/60**. The remaining-tasks table above contains the five open tasks. No whole-change release, main-spec promotion, archive, commit, push or merge is claimed.

Scope: explicitly selected physical iPhone 16 Plus / iOS 26.2.1 (23C71), wired pairing, Developer Mode enabled and user-confirmed unlocked/UI Automation enabled; Xcode 26.5 (17F42), host Appium 3.2.0 / XCUITest 10.19.1. All mutations target the independent dev.mobilemirror.runtimefixture, with noReset=true/fullReset=false, autoLaunch=false, owned managed runtime and session-app policy. No real business App or production data is touched.

### Offline signed Fixture and startup failures

- Added fixtures/runtime/ios/RuntimeFixture.swift, Info.plist and build.mjs. RuntimeFixture 1.1/versionCode 2 has the same synthetic 5-second delay, 6/10-second blink and fixed Saved 1200 persistence/loss controls as Android. It has no network functionality. Task-based UI transitions keep Help/save controls responsive and timing buttons disable duplicate submission.
- The builder uses an existing valid wildcard development profile already authorizing the selected device and a matching local private-key identity. No Xcode account changes, profile updates, device registration, new dependencies or xcodegen installation occur. The first certificate-selection check incorrectly assumed the profile had only one certificate; it safely rejected before building and was fixed to validate membership among all valid supplied certificates. An initial compiler SDK-selection warning was removed by explicitly selecting iphoneos for the tool invocation. Final compile, codesign and strict signature verification succeed; Mach-O load commands identify iOS platform 2 / SDK 26.5, minimum iOS 16.
- Installed the newly built App through devicectl. The receipt identifies the independent runtimefixture; subsequent installed-app metadata shows 1.1/2 and the old dev.mobilemirror.fixture remains installed unchanged. Local signed Mach-O SHA-256: dd5fb596d4accf597cb51f9488cdaf3c3e07c6c3102aca0303ccafc3a4549269. This is local artifact identity plus installation receipt/version, **not independent installed-binary readback**. Signing values, UDID, entitlements and profile stay private under ignored artifacts/fixture/.
- Preinstalled-WDA attempt runtime-gates-ios-2026-10-06T07-05-56-537Z times out before any workbench action. Prebuilt-WDA attempt runtime-gates-ios-2026-10-06T07-08-02-529Z returns xcodebuild 65. Its fresh xcresult explicitly reports “Timed out while enabling automation mode”; build status is notRequested and there is no signing failure recorded. Do not infer disabled Developer Mode, bad credentials or a product assertion failure from this generic startup error.
- Both failed attempts release their owner/runtime and all managed listeners. After the user confirms UI Automation enabled and an unlocked screen, one explicit prebuilt-WDA retry establishes the session. It uses signed existing DerivedData with test-without-building, startupRetries=1 and provisioningDeviceRegistration=false, without patching WDA/Appium. A diagnostic process-list filter invocation had a type error and was replaced by a local filtered read-only process listing; no device process was killed by that diagnostic.

### Standard cases and original evidence

Private root artifacts/physical-validation/runtime-gates-ios-2026-10-06T07-11-06-761Z exits 0 with **9 matched checks**. USB is separately not-performed in this standard run.

| Check | Observed result | Native run |
| --- | --- | --- |
| required crash/hang unsupported | actual Appium preflight rejects before declared tap, no run owner retained | no run created |
| delayed completion | pass, false/false/false/true | 7dc3edab-c657-4812-9fbb-b1afa8ce740f |
| stable counterexample | fail, true/true/true/true/false; no reset | b26b63f2-047f-4aa0-a325-f4155f59b2a4 |
| restart retains fixed value | pass, two matching samples both before and after owned authorized restart | 91c84c70-16b9-4ea1-b839-0640dc9b4616 |
| restart intentionally loses value | fail, fixed expected value unchanged | 3716fee8-9d2d-4b8f-ad6d-fcb42364db2b |
| measured positive | pass, 7847.14 ms <= 20000 ms; five samples ending in a match | 363d8e76-da9b-483c-960e-455eb12831f8 |
| measured negative | fail, 1008.41 ms against fixed 1000 ms; performance-deadline, no later assertion executed | 31dcf8af-92eb-44a9-b926-60929c981dc3 |
| UI cancel after saved sample | cancelled, material retained, no following tap, owner released | 83b4304e-7610-412d-93b0-0d9a6e3403aa |
| pause only owned probe host for 8 seconds | inconclusive / temporal-sampling-gap; measurement-observation-failed, no green result | e2bfd197-f0b2-450a-af14-fd87e4a7ceff |

The user-action-contract check initiates from Viewer, verifies the run control disabled, clicks theme/history while still active, and retains local progress with the unknown verdict. Running.png and performance.png were inspected: synthetic Pending/progress is visible while active; the finished measurement is readable as automation-observed-e2e / 7847 / 20000 ms / verified. Both images remain private/ignored. Runtime/evidence overhead is included; the positive measurement ran while engineering checks were active and is not a calibrated production SLO. An attempted read-only WDA status after cleanup correctly encountered a closed port; it is not credited as a live server version observation.

### Coordinated iPhone USB interruption

- First window runtime-gates-ios-2026-10-06T07-13-52-873Z / run 728a17f1-d623-4214-93dd-c09c5420d56e completes the 30-second stable window normally (measurement 31252.12 ms). Expected-inconclusive probe exits 1. The user later confirms waiting before unplugging. This is not credited as an in-window interruption; the original pass and failed probe are retained.
- Coordinated retry runtime-gates-ios-2026-10-06T07-19-21-754Z / run 11bda930-16e8-46e2-9e06-6abd0aac06ef exits 0. The user confirms unplugging during the new window; IOUSB inventory has no iPhone entry. Sixteen matching PNG/XML samples are retained, then observation fails. Stable result is inconclusive / temporal-observation-failed / incomplete coverage; measurement is inconclusive / measurement-observation-failed, elapsed 24012.82 ms, not an App performance failure or pass.
- Its journal contains only the earlier settled activate and save tap. No subsequent write, implicit restart or auto retry is dispatched. Native cleanup is session-retained by run policy; outer probe cleanup releases the owner, reaches idle/runtimeOwned=false and removes the managed 4723/8100/9100 listeners.
- After evidence retention, the user reconnects and IOUSB independently re-enumerates iPhone; lock-state read confirms unlocked. No window resumes. Device process listing has no WDA runner. Fresh independent-process native replay verifies all eight standard runs plus this interruption; the earlier non-interrupted run also verifies with its original pass, without being counted as fault injection.

Temporal 6.2 and health/performance 6.5 are complete within the synthetic platform scope. The iOS source-probe report explicitly says liveDiagnosticSourceChecked=false: a physical session plus static unsupported capability/preflight refusal **does not complete health 6.3**. Health 6.3 still needs authorized live diagnostic access; 6.4 needs complete source identity/window/loss/time/drain proofs and controlled crash/hang scenarios. Android health 6.2 has the analogous source-completeness blocker. Real-business temporal 6.3 and health 6.6 still require approved App/backend, isolated business keys/truth query/cleanup and an approved latency budget. No safe alternate evidence in the current environment satisfies these five tasks.

### Fresh iOS follow-up engineering gates

Frozen source: **439 files**, SHA-256 **7d326608609a43f8d15d0d44912173d5b0818b53f56830ae16407af14f2deed7**. Inputs are sorted relative paths + NUL + bytes under src/viewer/scripts/tests/examples/fixtures, plus package.json, pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig.json, tsdown.config.ts, vitest.config.ts, playwright.config.ts and public-readiness.config.json. Only the shared physical probe and three new iOS Fixture files change from the prior engineering snapshot; production runtime/Viewer source is unchanged. No code changes are made during these gates or physical attempts; only subsequent audit/checklist documentation changes. The digest repeats unchanged after verification.

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | passed after correcting a probe-only call to a nonexistent service method; no provider API was added |
| `node --check fixtures/runtime/ios/build.mjs` | passed |
| `pnpm check --maxWorkers=1` | typecheck/contracts plus 105 files / 923 tests passed, 338.96 seconds |
| `pnpm test:e2e --workers=1` | 75 passed, 4.0 minutes |
| `pnpm build` | passed |
| `pnpm pack:check` | passed; private signed Apps/profiles/raw physical evidence not shipped |
| `pnpm public:check` | passed: 1009 files, 89 reachable commits, 11 acknowledged legacy commits |
| fresh-process native evidence replay | eight standard runs and credited USB interruption verified, verdicts preserved; failed no-interruption attempt separately verifies |

Forty-eight tracked screenshots changed only by this turn's E2E generation are restored in the feature worktree, where those paths were clean before the run; the four new retained runtime screenshots remain. The primary dirty checkout is not modified. The OpenSpec checklist now reflects actual accepted Android/iOS Fixture outcomes while keeping the five external acceptance gates open.

## 2026-10-06 dev integration verification

The isolated integration worktree combines dev parent `REDACTED_REVISION` and feature parent `REDACTED_REVISION`, retaining both histories. The automatic merge has no unresolved paths; the iOS readiness source-structure/focus fix from dev remains present alongside the runtime-gate device operations. No product source is changed while these integration gates run.

Frozen merged inputs use the same path/byte digest scope as above: **450 files**, SHA-256 **15fbf491210799d3b86d1fcb50a78fdf238f8f76b19554bc143e349df04d4e6a**. This is a new engineering snapshot, not the prior 439-file physical candidate; it includes the dev follow-up probes, readiness regressions and package manifest additions. Node **24.19.0**, pnpm **11.7.0**. Dependencies are installed from the existing store with `pnpm install --frozen-lockfile --offline`; no lockfile update or new tool installation is needed.

| Integration gate | Fresh result |
| --- | --- |
| `pnpm check --maxWorkers=1` | typecheck/contracts and **105 files / 925 tests passed**, 337.08 seconds |
| `pnpm test:e2e --workers=1` | **75 passed**, 4.0 minutes |
| `pnpm build` | passed |
| `pnpm pack:check` | passed |
| `openspec validate --all --strict --no-interactive` | **45/45 passed**; checklist completion is not inferred from schema validation |
| `pnpm public:check` | passed on merge content: 1021 files, 90 reachable commits, 11 acknowledged legacy commits; delivery also checks newly committed history |
| `pnpm pack --pack-destination artifacts/runtime/runtime-gates-integration` | actual candidate tarball created locally; no npm/GitHub Release publication |
| `node scripts/runtime-gates-package-probe.mjs <outside-candidate>/package/lib/application.js` | extracted tarball outside the repository: v2 measure/restart pass, legacy v1 pass, sensitive temporal observation refused, health refused before side effects, share v4 not revalidated, HTTP/command/MCP projections equal, CLI suite v2 clean exit 0, no page errors |

Viewer verification follows user-action-contract: while temporal sampling or health cancellation/drain remains active, theme/history controls stay usable, initiating controls prevent duplicates, invalid input retains the last successful result, and completion refreshes domain timestamps. Fresh Mock screenshots `runtime-gates-sampling.png`, `runtime-gates-completed.png`, `runtime-gates-draining.png` and `runtime-gates-packaged.png` are retained and visually inspected. Their illustrative iPhone does not constitute physical evidence. The 51 other tracked screenshots generated by this integration's E2E run are restored from the pre-existing index; primary and feature worktree edits are not incorporated.

README, capability table and documentation index now link this runtime increment and preserve October 5 claims as historical. Temporal remains **27/28** and health/performance **28/32**: the five unfinished real-business and live health-source acceptance tasks retain their stated prerequisites. This integration reruns engineering and packaged-Mock gates only; it does not repeat the earlier physical probes, approve a production health source/SLO, publish a release, synchronize unfinished delta specs or archive either change.
