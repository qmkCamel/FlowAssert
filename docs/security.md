# Security model

## 修复 Preview 的安全边界

新修复闭环默认关闭；宿主工具可见性与项目准入不是同一个开关，也不代替范围/补丁执行/安装的精确审批。`trusted-local` 源码检查与构建执行可信登记命令，不提供任意代码沙箱。M3 当前只有 Mock 维护适配，未知安装回执保留围栏，不能因取消或进程退出推定回滚。页面范围与 owned loopback 防护始终生效；统一运行时总开关与 Viewer 开关尚未实现。详见[Preview 操作与停用](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md)。

## Trust boundaries

The DeepSeek Harness plugin runs in the host process, while an MCP host starts the same runtime as a local stdio child process. Both are outside any sandbox applied only to agent shell tools. Appium, `adb`, `xcrun`, and future media binaries are therefore trusted host executables. Installing a Git dependency with `prepare` also executes package code; prefer a pinned commit plus explicit pnpm allowlist or a prebuilt tarball/npm release.

## MVP controls

- Viewer host is schema-limited to loopback addresses.
- CSP, `nosniff`, no-referrer, frame denial, and no-store headers are applied.
- Request bodies have route-specific limits: legacy defaults 64 KiB; connection-assistant check/cancel 1 KiB and connect 8 KiB; authoring requests 80 KiB and share jobs 256 KiB. Artifact upload/HTML/text/image limits remain separately enforced by their owner.
- Every state-changing Viewer POST requires an exact matching `Origin` before its body is read or host work begins. Guided errors expose only stable `{code,message}` values.
- Host `adb`/`xcrun` discovery is disabled by default.
- New Android sessions default to `appium:ignoreHiddenApiPolicyError=true` so OEM policy-write denial does not block UiAutomator2. The schema and Viewer expose that this can hide later ROM/driver incompatibilities, and a request or profile can set it to `false` for strict failure.
- Host Xcode, Appium, device, signing-identity, and profile diagnostics are separately disabled by default; the preflight executes no command until explicitly enabled.
- Automatic provisioning/device registration is disabled by default. Enabling it may update profiles or register a device in the user's Apple Developer account, so the schema and Viewer surface that external side effect.
- Provider operations have bounded timeouts and accept cancellation signals.
- Attached Appium sessions are never deleted by plugin stop.
- Owned Managed Appium preloads a package-local guard for XCUITest 10.19.1 with a pinned forwarder fingerprint, binding both WDA/MJPEG USB host forwarders to 127.0.0.1 without modifying installed files. Unknown versions/content fail closed. External Appium, device-side WDA and wireless network exposure need separate owner-controlled verification; this is not a blanket network-security claim.
- Appium capabilities are not logged or echoed because cloud grids may put secrets in them.
- iOS preflight and classified WDA errors expose stable codes, counts, versions, and bounded guidance—not raw UDIDs, Team IDs, certificate labels, profile contents, machine paths, or command output.
- The default provider is a non-destructive Mock.
- `agentScreenContentPolicy=mock-only` is the default and rejects Appium screenshot, page source, geometry, and orientation before any screen endpoint is called. `structure` allows only bounded normalized accessibility text; `image-and-structure` explicitly allows PNG attachment/model sharing.
- `agentTextInputPolicy=mock-only` is the default. Physical text input requires explicit `non-sensitive`, a fresh structure observation, a focused visible/enabled ordinary input, and provider-side active-element rect verification. Password/secure roles are always rejected.
- Android password and iOS secure input content is removed before field truncation and JSON accounting. The public node retains only `sensitive=true` and non-secret geometry/state metadata; raw, masked and length-derived values are not published.
- Text is limited to 512 Unicode code points / 4 KiB and rejects C0/C1/newline/tab/line-separator characters. Results, state, progress and fixed errors never echo it; hosts may still retain tool-call arguments, so users must authorize only public test/input content.
- `agentAppControlPolicy=disabled` is the default. `session-app` and exact `allowlist` are opt-in, require a plugin-owned session, and reject unknown/attached targets before provider calls. App ids, element/session ids, request bodies and raw provider responses are excluded from public surfaces.
- A private WeakSet mutation marker records unknown/partial outcomes without becoming serializable. Success or may-have-mutated failure increments the screen epoch; validation failures before a request do not. This prevents reuse of potentially stale observations.
- Raw Appium XML is capped at 4 MiB, parsed without external entities, and reduced to bounded fields/nodes/JSON. It is never logged or returned.
- Core observations are memory-only, limited to four per session, 60 seconds, and 32 MiB of image bytes. Eviction best-effort zeroes buffers; stop/session replacement invalidates them.
- Screen PNG canonical results contain metadata only. Image bytes go through the DSH attachment validator/store and one deferred plugin context; no Base64, local path, bearer URL, attachment ID, session ID, UDID, or capabilities appear in canonical JSON or shared state.
- The MCP server uses stdio only. stdout is reserved for JSON-RPC, diagnostics use bounded/redacted stderr, and there is no MCP network listener.
- MCP configuration is a schema-validated JSON file capped at 64 KiB. Unknown keys, non-loopback Viewer hosts, malformed input and image limits above 32 MiB fail closed.
- MCP image content is a per-call Base64 transport copy with an 8 MiB default limit. It is not added to canonical JSON, a screenshot resource, a URL, or continuous media history.
- EOF, SIGINT, SIGTERM and explicit close converge on idempotent cleanup. The Viewer listener closes before active operations quiesce and owned Appium sessions are released.

## Beta onboarding and managed-process controls

- `flowassert doctor` is a user-invoked CLI, never an agent tool. It performs only bounded read-only checks and does not download, install, start, repair or modify host/device state.
- Each host command uses `shell=false`, an abort signal, timeout and 1 MiB output cap. Raw stdout/stderr is reduced to stable versions/counts/codes and discarded; device IDs, signing identities, paths and ports never enter the report.
- Config generation writes only to stdout and starts from Mock, loopback, `mock-only`, external Appium, host discovery off, signing diagnostics off and provisioning mutation off. Applying or redirecting the output remains a user action.
- Managed Appium is disabled by default. It accepts only an explicit absolute executable and HTTP loopback URL, derives fixed address/port/base-path arguments, and does not accept arbitrary CLI arguments or search PATH.
- A Viewer check creates a one-use authorization for only the selected Android or iOS read-only strategy. Assistant/device references use 128-bit randomness, hashed constant-time lookup, a 120-second TTL, a maximum of eight contexts and atomic consumption; they are never stored in browser persistence or Agent state.
- Android discovery accepts only authorized physical USB rows and a server-resolved Settings activity; iOS discovery accepts only available physical iPhones. Public reports omit serial/UDID/model/name, Team/bundle/certificate/profile, executable paths, command output and final capabilities.
- `managed-once` is armed only after explicit selection and candidate fingerprint revalidation. It uses the existing managed runtime and returns to configured external mode after failure/stop; check itself cannot spawn.
- The standalone Viewer persists setup only after an explicit `rememberOnThisMac` request and successful candidate/device/signing revalidation. Its repository-external parent/file are restricted to `0700/0600`, replacement is atomic, and symlink, unknown-field, oversized, or non-absolute-path inputs fail closed.
- Persisted setup is allowlisted to normalized Mirror settings, the managed Appium executable, one platform preference, and validated iOS Team/WDA bundle defaults. It excludes device identifiers/names, assistant references, capabilities, Apple credentials/certificates/private keys, provisioning authorization, and Android helper confirmation; public Viewer state exposes only availability and the saved platform.
- Saved setup never creates authority on page load. The one-click path is still one same-origin user action, a fresh short-lived check, candidate/device revalidation, and an owned session; ambiguity stops at the report.
- A Volta `appium` shim is used for diagnostics but not armed directly: the assistant runs the fixed `volta which appium` query, validates the returned absolute entrypoint and fingerprints both canonical targets. If a wrapper cannot yield a directly owned executable, `managed-once` is not offered.
- Guided Android requires explicit acknowledgement that UiAutomator2 may install/update helper APKs. Guided iOS refuses profiles that enable automatic provisioning/device registration and never accepts that field from HTTP.
- A pre-existing listener is a conflict, not a process to adopt. Cleanup holds one exact child handle, sends SIGTERM, waits two seconds and only then signals that same child with SIGKILL; it never scans process tables or uses `pkill`.
- The GitHub prerelease is created only after clean-runner source, E2E, build, OpenSpec, pack, checksum, clean-prefix, MCP, managed Appium and exact DSH `0.2.0-rc.2` Native/PTC probes. The workflow uploads no host report/config and never runs `npm publish`.

## Low-latency media controls

- `viewerMediaMode=polling` is the immediate rollback. `auto` does not execute Android media unless an absolute trusted scrcpy path is configured.
- Android accepts exactly scrcpy 4.1, resolves only explicit or deterministic adjacent/prefix server paths, uses `spawn` with `shell=false`, and never searches PATH, reads an environment override, downloads, installs, or upgrades binaries.
- scrcpy runs video-only with audio/control disabled. All input and Appium session ownership remain in the existing provider.
- WDA MJPEG is accessed only through a provider-created loopback context. Owned iOS auto sessions probe and use the device-default port 9100; a local conflict or forwarding race falls back to screenshots without forcing WDA replacement. Attached sessions require a capability hint and their forwarding/settings are never modified or deleted.
- `/api/media/stream` is same-origin, no-store, one-subscriber and parameter-free. H.264 packets/JPEGs are capped at 8 MiB, queues at two packets / 8 MiB, and browser failure reports accept only the current opaque generation plus a fixed enum.
- Media bytes remain memory-only on the loopback Viewer path. They are not recordings, DSH attachments, MCP resources/results, observations, logs, or persisted diagnostics.
- Android cleanup targets only the saved child handle, exact owned forward and unique remote jar. It never uses `pkill`, scans other instances, or deletes external resources.
- A force-killed process can still leave an owned ADB forward or remote jar. Cross-process orphan recovery is deferred to production hardening because broad cleanup would be more dangerous.

## Known limits

- There is no viewer authentication because it cannot bind beyond loopback in M1.
- Appium itself is a privileged automation server; users must not expose it to untrusted networks without its recommended security controls.
- Coordinate actions can trigger destructive application behavior. DSH approval/policy remains the authority layer; this plugin does not bypass it.
- Semantic node tap, text input and application lifecycle can still trigger destructive behavior in the target app. Observation freshness, core policy and provider verification reduce target confusion but do not infer business intent; host approval remains required.
- Host discovery broadens visibility into connected devices and is an explicit opt-in.
- The Android compatibility default does not grant `WRITE_SECURE_SETTINGS` or probe it with a state-changing ADB command; it only tells Appium whether policy-write failure is fatal.
- Signing diagnostics broaden visibility into local Xcode and keychain state and are a separate explicit opt-in. They do not unlock the keychain or manage credentials.
- The plugin never stores Apple IDs, private keys, keychain passwords, or Developer Portal credentials.
- The core 60-second TTL does not delete a DSH attachment. Once image sharing is enabled and `saveImage` succeeds, recovery, fork, provider delivery, retention, and deletion follow DSH policy; the plugin has no attachment GC API.
- A capture window is not an atomic device snapshot. External touches, animations, or app refreshes can change content between screenshot and source, so high-risk actions require a fresh observation.
- Existing actions without `observationId` intentionally retain their old semantics and have no stale-screen protection.
- A force-killed MCP process cannot guarantee owned-session cleanup and can leave an orphan in Appium. Attached sessions remain deliberately external. Production hardening needs an explicit orphan inspection/recovery flow.
- A force-killed managed Appium parent may also leave Appium downstream resources after the saved child disappears. Recovery must resolve exact ownership; broad port/process cleanup is intentionally absent.
- MCP tool annotations are advisory. The host remains responsible for approval policy, especially start/action/manage-app/stop and any physical-screen or public-text authorization.

## Reviewed offline HTML

Report discovery is bounded to metadata and does not revalidate artifacts. The share owner constructs a whitelisted ReviewedReportSnapshot; the renderer receives no source run, path or file capability. Passive HTML embeds reviewed PNGs, has no scripts/network/forms/external links, and uses the fixed template style hash; Viewer previews use a sandbox iframe without scripts or same-origin permission. Source pixels remain private unless explicitly selected and masked. Raw expectations, observations, YAML, identifiers and private journals are omitted, with the omission visible.

Preview binds source/options/format/template and freezes identity, time and bytes; input/source changes, ten-minute expiry or restart invalidate review. Export requires explicit review and an intact committed manifest/hash. HTML is not an importable/replayable archive, a signature of source authenticity or a new health/business pass. See the [report guide](report-reading-and-sharing.md) and [format/rollback matrix](https://github.com/qmkCamel/flowassert/blob/main/docs/workbench-compatibility.md).

## Before remote access

Any future non-loopback mode requires authenticated transport, origin validation, TLS termination guidance, explicit device/action policy, rate limits, secret storage integration, and a separate threat-model review. It must not be enabled merely by changing the host string.
