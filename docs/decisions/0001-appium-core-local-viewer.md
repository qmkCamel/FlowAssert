# ADR 0001: Appium control core with a local Viewer

- Status: Accepted
- Date: 2026-08-16

## Context

The product must let DeepSeek Harness see and control physical Android and iOS devices from a Mac, and later expose the same capability to Codex. Existing products cover pieces of the problem, but their platform, licensing, or extension contracts differ.

## Decision

1. Use Appium/WebDriver as the MVP semantic control substrate.
2. Implement DeepSeek Harness as an installable Cordis bundle with native DSH tools.
3. Put lifecycle/provider logic in a host-neutral `MirrorService` rather than the DSH adapter.
4. Serve frames and manual controls through a loopback-only local Viewer.
5. Use a deterministic Mock provider as the default validation path.
6. Add a generic MCP adapter after the DSH MVP, using the same service; do not transport continuous video in MCP results.
7. Treat Maestro as an optional declarative flow layer, not the device owner or control core.
8. Keep iOS WDA signing defaults and preflight in reusable core services: the Appium provider merges new-session capabilities, while the DSH tool remains a thin adapter. Host signing diagnostics and provisioning/device registration require separate explicit opt-ins.
9. Keep Android OEM hidden API policy compatibility at the Appium provider boundary. The shipped schema defaults to continuing after policy-write denial, preserves request-level strict override, and warns before startup rather than probing with a state-changing ADB command.
10. Treat guided device setup as a Viewer-only orchestration edge over the same `MirrorService`: Android/iOS strategies may perform a single user-authorized read-only host check and issue short-lived opaque references, but Appium provider/session ownership and DSH/MCP authority remain unchanged.
11. Provide a formal loopback Viewer launcher and an explicit private local setup store. A saved setup only becomes a runtime default on launch; opening the page never performs diagnostics, enumerates devices, or starts Appium.
12. Treat WDA's device-side MJPEG port as a protocol constraint rather than an arbitrary local allocation. Auto mode uses the available WDA default 9100 and falls back to discrete screenshots on conflict without replacing cached WDA.

## Rationale

- Appium is the only mature shortlisted foundation with official real-device coverage for both platforms.
- DeepSeek Harness already has a documented plugin/bundle/tool lifecycle; a native adapter is smaller and easier to validate than nesting an MCP server for the first release.
- Local frames avoid model-token cost, log bloat, and unnecessary network exposure.
- Mock makes lifecycle/UI regressions reproducible in CI and on contributor machines without Apple/Android provisioning.
- The service seam makes later Codex/MCP support an adapter addition rather than a rewrite.

## Rejected alternatives

- **Maestro as core:** simpler authoring, but official physical-iOS execution remains unsupported.
- **Mobile Next as the entire implementation:** closest open-source product, but would make its larger MCP surface, device ownership, security history, and release cadence our core contract. It remains a valuable benchmark/integration candidate.
- **MobAI dependency:** proprietary implementation prevents source audit and independent maintenance.
- **Apple iPhone Mirroring/QuickTime automation:** good manual media UX but no supported programmable cross-platform control API.
- **MCP video streaming:** wrong protocol shape for continuous high-volume frames.

## Consequences

- Real-device setup is more involved and must be documented/tested as a matrix.
- MVP “live” view is screenshot polling, not 30–120 fps.
- DSH preview changes may require adapter updates; pin and test a known release.
- Appium sessions need explicit ownership to avoid destroying external test runs.
- Personal WDA Team, bundle, certificate, and machine-path values live in a user profile patch, never in the shipped bundle or service state.
- Read-only preflight can reduce signing ambiguity, but device trust, Developer Mode, UI Automation, and final WDA installation still require physical-device validation.
- Android OEMs may deny hidden API policy writes even when ADB is authorized. Continuing is compatible with the verified device but may expose later UiAutomator2 issues, so system/Appium/driver upgrades require a new physical smoke.
- The Viewer may simplify first connection without becoming a second device owner: it generates non-launching current-screen capabilities by default and fixed Settings capabilities only on explicit selection. One-shot diagnostics/runtime authorization never becomes an Agent tool or persistent profile mutation; driver-inferred app identifiers do not confer target-app authority on app-less connections.
- The standalone Viewer can persist a validated Appium entrypoint, platform preference, and bounded WDA signing defaults in a repository-external `0600` file. Device identifiers, capabilities, credentials, confirmations, and Agent authority are never persisted by this flow.
- A 120-second Appium session-start budget accommodates cold WDA compilation while server readiness, initial-frame, and established-session commands retain their shorter bounds.

## 2026-09-14 工作台增量

最小 YAML 闭环采用 AppClaw 2.7.0 原生执行器，经受控工具适配直接复用 MirrorService 的 owned session；不采用其 SDK session 或 appium-mcp。运行独占租约阻止其他控制，Viewer 媒体继续使用同一 owner。细节见 [ADR 0006](0006-native-yaml-workbench.md)。Maestro 保留为待集成适配器，未改动 DSH agent loop。
