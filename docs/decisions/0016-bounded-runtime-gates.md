# ADR 0016: Bounded temporal, business, health and E2E gates

Status: accepted for engineering; platform health sources remain unapproved.

## Decision

MirrorService is the sole device/session/mutation owner. Restart and observations use WorkbenchDevice and the existing exclusive queue, policy and unknown-write fence. DSH/Cordis, MCP, CLI and Viewer remain thin shared-application consumers; no agent-loop or Worker v1 protocol change.

Opt-in runtime features share product/summary v2 and mandatory requiredFeatures. Legacy/v1 remains frozen; unknown features fail closed. Native/derived archives and acceptance independently route versions 3/4/2 rather than stripping new requirements. Imports remain not-revalidated.

Pure provider health contracts live in health-contracts.ts, with no dependency on WorkbenchService/store. Health normalization, process/window/slot binding and budgets are pure. Private journal/window persistence and semantic replay live at the evidence boundary. Android/iOS probes execute only fixed read-only commands, bound output/time and reap only owned children. Readability alone never authorizes a health source.

The 2026-10-07 iPhone probe reads live CoreDevice details and only RuntimeFixture-prefixed crash archive metadata into a new private directory. It validates Xcode's `info.outcome` and expected command/result shape; stdout exposes only bounded capability facts. A readable archive is not a realtime window or a verified hang stream, so both signals remain unsupported. The probe does not enter the collector lifecycle, install an agent or add another session owner. Offline physical-evidence audit uses immutable store reads without initialization/recovery, replaying temporal/measurement evidence without running extensions or contacting devices.

Time sampling, business sampling, measurement and integrity replay are separate modules. Runtime syntax compiles inside the existing plan; a shared monotonic contract prevents wall-clock duration claims. All materials remain immutable, bounded and run-owned. Scoped evidence read leases protect read-time replay and suite freeze; leases are acquired before the mutation gate, not recursively inside it.

## Consequences

- UI responsiveness follows the global user-action-contract: local progress, duplicate protection, cancellation/drain, previous-result preservation and runtime interaction tests.
- Trusted business extensions declare observation authority. This is not a sandbox; polling never makes mutating code safe.
- A sample window is not a continuous-state guarantee. automation-observed-e2e includes necessary automation/evidence overhead and is not a production SLO.
- No Android/iOS health source is released until its complete positive/negative, interruption and drain evidence exists. Empty logs are insufficient.
- Failure, incomplete coverage and missing private evidence cannot be erased by a faster attempt, explicit restart or a derived archive.
- Collector implementations must enforce cancellation and await their owned-process exit; ready/drain/close each receive a 5000 ms signal budget, late drain/close cannot publish pass, and close must force-reap owned children on budget expiry before settling. Arbitrary in-process promises cannot be force-killed safely: this is a trusted-adapter admission obligation, not a timeout race that releases a live device owner. The existing owned command helper proves forced-reap behavior. Unapproved providers cannot enter this lifecycle.
- Source baseline is origin/dev REDACTED_REVISION. This feature is isolated from the older, dirty primary checkout.
