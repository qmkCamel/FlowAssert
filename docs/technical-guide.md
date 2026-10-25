# FlowAssert technical and development guide

English | [简体中文](technical-guide.zh-CN.md)

This guide covers source development, builds, verification, and extension of FlowAssert. Start with the [README](../README.md) for a first run, the [capability matrix](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md) for acceptance boundaries, and [Product TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md) for active tasks. Engineering commands live here; task counts stay in the TODO.

The repair loop is **Preview, off by default**; see [repair operations](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md) for admission, approval, and shutdown. Software/Mock, package/host, physical-device, and real-model validation are separate.

## Toolchain baseline

| Area | Version or constraint |
| --- | --- |
| Repository Node | 24.19.0, pinned through mise |
| Package Node | `^22.19.0 || >=24.0.0` |
| pnpm | 11.7.0, pinned through Corepack |
| DeepSeek Harness | `0.2.0-rc.2` |
| Appium | 2 or 3 |
| Android driver | UiAutomator2 |
| iOS driver | XCUITest/WebDriverAgent |

Owned WDA/MJPEG host forwarding requires fingerprint-audited XCUITest `10.19.1`; external Appium remains its owner’s responsibility. Harness preview, driver, and scrcpy upgrades require the corresponding clean-profile, provider, and physical-device evidence, not just a version edit.

## Local development

```bash
git clone --branch main --single-branch https://github.com/qmkCamel/flowassert.git
cd flowassert
mise install
mise exec -- corepack enable
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

For an existing checkout, start at `mise install`. If you manage Node yourself, omit `mise exec --` after confirming the versions above in the current terminal.

The development entry starts a loopback Viewer at `http://127.0.0.1:3210` and uses the safe Mock provider when no local setup has been saved. Mock requires no phone, Appium, model credential, or host-device discovery and is the deterministic path for UI, lifecycle, and agent-contract development.

`pnpm dev` and `pnpm start` now use the formal Viewer launcher; installed packages expose `flowassert-viewer`. The launcher may load repository-external private defaults, but startup and page load never enumerate devices or start Appium. See the [local Viewer guide](local-viewer.md) for first-time persistence and later quick connect.

Repository boundaries:

- the DSH plugin and MCP server are thin adapters over one `LocalDeviceRuntime` and `MirrorService`;
- the Appium provider is the Android/iOS semantic-control layer;
- agents receive discrete PNG/structure observations, while continuous media remains in the local Viewer;
- every user operation that can exceed 300 ms must show local progress and preserve the last usable result on failure;
- the Viewer and managed Appium remain loopback by default, with explicit session and server ownership.

See [architecture](architecture.md) for components, lifecycle, and data boundaries.

## Build and package

```bash
pnpm build
pnpm pack:check
```

`pnpm build` emits ESM, declarations, and source maps. `pnpm pack:check` triggers a build and checks packaged documentation links against the actual `pnpm pack --dry-run` file list; it does not install a real tarball in isolation. Create a local candidate with `pnpm pack --pack-destination /ABSOLUTE/CANDIDATE_DIR`. Source is the current entry point and the package remains `private: true`; future Release download and rollback templates are in the [installation guide](beta-installation.md).

The candidate package includes:

- the DSH Cordis bundle;
- the generic stdio MCP launcher;
- the read-only `doctor/config` onboarding CLI;
- Viewer static assets;
- runtime-facing architecture, host, platform, security, validation, and release documentation.

## Required gates

Run before delivery:

```bash
pnpm check
pnpm test:e2e
pnpm build
pnpm pack:check
pnpm public:check
git diff --check
```

- `pnpm check` covers TypeScript, contract lint, documentation checks, and Vitest;
- `pnpm test:e2e` covers Viewer Playwright scenarios;
- `pnpm public:check` checks public files, Markdown links, secret/path exposure, author identity, and distribution boundaries;
- Viewer changes also require a retained final screenshot and human inspection;
- each OpenSpec change requires `openspec validate <change> --strict`.

See [validation](validation.md) for the exact matrix, physical evidence, and open boundaries.

## Runtime probes

### MCP Mock

```bash
pnpm build
pnpm run test:mcp:probe --launcher ./scripts/mobile-mirror-mcp.mjs
```

This probe launches the real built stdio child and checks tool schemas, the Mock observation/action loop, mutation and stale protection, signal cleanup, and Viewer-port release. See the [MCP host guide](mcp-hosts.md) for MCP/Codex installation, approval, and configuration contracts.

### DeepSeek Harness

```bash
DSH_TOOLS_MODE=native dsh web --patch ./scripts/dsh-runtime-probe.patch.yml
DSH_TOOLS_MODE=ptc dsh web --patch ./scripts/dsh-runtime-probe.patch.yml
```

These paths call the real DSH registry through Native tools and the host-provided PTC `run_code` transport. The default tool set contains ten device tools, five registered-test tools, and five read-only summary tools; test execution requires separate enablement and a project allowlist. Five Preview repair tools require host opt-in and valid project registration; visibility is not execution approval. See the [tool catalog](product-shape.md#agent-与控制面) and [Agent run guide](agent-test-run-control.md).

In the DSH `0.2.0-rc.2` catalog, `deepseek-flash` declares `text,image`, while `deepseek-v4-pro` is text-only and receives a stable image-omission placeholder. Catalog metadata or attachment delivery does not prove a real model consumed an image; verify that separately. DSH Doctor currently has a [known Cordis version-check mismatch](environment-preflight.md#dsh静态前提与实际启用分开).

### Physical devices

```bash
pnpm run test:mcp:physical
pnpm run test:media:physical
```

These commands require explicit platform, device, Appium, and media environments. They do not discover authorization values or bypass a device lock. Read the [Android guide](android-real-device.md) or [iOS/WDA guide](ios-real-device.md) first, and treat each result as single-device evidence rather than broad compatibility.

## Configuration and security principles

- Mock is the default provider. Host discovery, signing diagnostics, physical screen sharing, text input, and application control are independently opt-in.
- External Appium is the default. Managed mode requires an absolute executable and loopback URL and stops only its saved child.
- A newly created session is owned; a supplied `sessionId` is attached. Stop deletes only owned sessions.
- Appium capabilities can contain credentials and must not enter logs, tool results, or shared state.
- `image-and-structure` sends a discrete PNG to the selected host/model. Core-memory TTL does not delete a host-managed attachment.
- Automatic provisioning/device registration is disabled because it can mutate Apple Developer account state.

See the [security model](security.md) for the full threat model, retention, and policy contract.

## Technical documentation map

| Task | Source of truth |
| --- | --- |
| Understand product boundaries and target shape | [Product shape and capability boundaries](product-shape.md) |
| Understand components, lifecycle, and media channels | [Architecture](architecture.md) |
| Install the DSH Beta, run doctor/config, upgrade, or roll back | [Beta installation guide](beta-installation.md) |
| Register Codex or another MCP client | [MCP host guide](mcp-hosts.md) |
| Configure Android, UiAutomator2, and scrcpy | [Android real-device guide](android-real-device.md) |
| Configure iPhone, Xcode, WDA, and MJPEG | [iOS/WDA guide](ios-real-device.md) |
| Start the Viewer, save local setup, and reconnect quickly | [Local Viewer guide](local-viewer.md) |
| Evaluate permissions, privacy, and external-state changes | [Security model](security.md) |
| Inspect tests, performance, and physical evidence | [Validation](validation.md) |
| Inspect delivery phases and open compatibility work | [Milestones](milestones.md) |
| Review architecture decisions | [ADR index](https://github.com/qmkCamel/flowassert/blob/main/docs/README.md#架构决策-adr) |
| Review product and competitor evidence | [Product landscape research](https://github.com/qmkCamel/flowassert/blob/main/docs/research/product-landscape.md) |

## Contribution and release

Read [CONTRIBUTING](https://github.com/qmkCamel/flowassert/blob/main/CONTRIBUTING.md) and the [Code of Conduct](https://github.com/qmkCamel/flowassert/blob/main/CODE_OF_CONDUCT.md) before contributing. Report vulnerabilities through the [security channel](https://github.com/qmkCamel/flowassert/blob/main/.github/SECURITY.md), not a public issue. Releases must come from an exact tag on a clean runner, create a new GitHub prerelease, never overwrite existing assets, and never publish to public npm. See [open-source readiness](https://github.com/qmkCamel/flowassert/blob/main/docs/open-source-readiness.md) and the versioned release notes for the complete rules.

## Observation query and Viewer Inspector

`mobile_mirror_query_screen` queries a retained observation without another capture or an extension of action freshness. The Viewer Inspector independently freezes its local screenshot and tree; see the [Inspector guide and acceptance boundaries](inspector-validation.md).
