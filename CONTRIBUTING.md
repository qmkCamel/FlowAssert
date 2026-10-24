# Contributing to FlowAssert

Thank you for helping improve FlowAssert. This project is a Developer Preview: interfaces may change, DeepSeek Harness compatibility is pinned, and physical-device behavior varies across host, OS, OEM, account and signing state.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md), [support policy](SUPPORT.md) and [security policy](.github/SECURITY.md) before contributing.

## Good first contributions

- Reproduce a bug with the deterministic Mock provider.
- Improve installation, platform or troubleshooting documentation.
- Add deterministic coverage for a currently documented boundary.
- Propose a narrowly scoped compatibility improvement with evidence.

Use the GitHub issue forms before starting a large change. Security vulnerabilities must never be filed as public issues.

## Development baseline

- Node 24.19.0 (the package also declares its supported Node range).
- pnpm 11.7.0 through Corepack.
- DeepSeek Harness `0.2.0-rc.2` exactly for DSH integration evidence; exercise both Native and PTC presentation.
- Appium is optional for normal development; Mock is the required default path.

```bash
mise install
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
pnpm build
pnpm pack:check
```

Do not update pinned runtimes or Harness preview packages as an incidental dependency change. A new Harness preview requires a clean-profile compatibility change and its own evidence.

## OpenSpec and architecture

Product behavior is specified in `openspec/specs/`; active changes live in `openspec/changes/`; provider and transport decisions live in `docs/decisions/`.

- Start behavior changes with an OpenSpec change and keep proposal, design, specs and tasks coherent.
- Pure documentation or repository-tooling changes may declare `skip_specs: true`; do not invent runtime requirements for them.
- Register Harness behavior only through documented Cordis effects and registries.
- Keep the DSH adapter thin. Device/session control belongs behind `MirrorService` and provider interfaces so the MCP adapter can reuse it.
- Do not patch or replace the DeepSeek Harness agent loop.
- Continuous media stays on the loopback Viewer path; DSH and MCP return bounded observations and control/status results.

## Testing and evidence

Every contribution must keep these gates green:

```bash
pnpm check
pnpm test:e2e
pnpm build
pnpm pack:check
pnpm dlx @fission-ai/openspec@1.9.0 validate --all --strict --no-interactive
git diff --check
```

For Viewer changes, retain and inspect the Playwright screenshot. Test user-triggered work that may exceed 300 ms with local progress, a still-interactive unrelated control, last-result preservation on failure, completion refresh and cancellation where supported.

Normal contributors are not required to own a physical device. Use deterministic Mock/fake runtime coverage in pull requests. Maintainers are responsible for Android/iOS device acceptance and must clearly separate:

- deterministic Mock evidence;
- clean package and DSH/MCP runtime evidence;
- host Doctor readiness;
- authorized physical-device evidence.

A passing Doctor is not physical-device acceptance.

## Privacy and safe diagnostics

Before opening an issue or pull request:

- remove device IDs/UDIDs, serials, account names, Apple Team IDs, bundle IDs and signing identities;
- remove Appium capabilities, provider credentials, host reports, absolute home paths and raw command output;
- crop or replace screenshots containing notifications, personal apps, contacts, accounts or private content;
- never commit real `.env`, `mobile-mirror.mcp.json`, DSH profile patches or device/signing configuration;
- prefer stable error codes and minimal reproduction fixtures over complete logs.

Run `pnpm public:check` before submitting repository-governance, packaging or release changes.

## Pull requests

Keep each pull request focused. Include:

- the problem and chosen approach;
- affected OpenSpec change or an explanation for `skip_specs`;
- compatibility and failure behavior;
- commands actually run and any unverified boundary;
- screenshots only when needed and only after privacy review.

Do not mix generated runtime evidence, local configuration or unrelated formatting into the change. Maintainers may request a smaller scope or additional deterministic tests before device-specific evidence is considered.
