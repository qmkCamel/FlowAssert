# Support

FlowAssert is a `0.1.0-alpha.2` Developer Preview candidate maintained on a best-effort basis. There is no response-time SLA, guaranteed hardware coverage or compatibility promise for untested DeepSeek Harness previews.

## Where to ask

Invited beta testers: use the dev branch and follow the [task card](docs/beta-start.md). Include the branch, commit SHA and whether local changes exist in the [experience record](docs/beta-feedback.md). Installation time and task time are recorded separately; incomplete attempts are useful feedback too.

- Reproducible product bugs: use the **Bug report** issue form.
- Installation, Doctor or host configuration problems: use the **Setup and configuration** issue form.
- Product ideas: use the **Feature request** issue form.
- Security vulnerabilities: follow [.github/SECURITY.md](.github/SECURITY.md) and use GitHub private vulnerability reporting. Never open a public issue.
- Conduct incidents: follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Search existing issues and the platform guides before filing:

- [Beta installation and rollback](docs/beta-installation.md)
- [MCP and Codex hosts](docs/mcp-hosts.md)
- [Android real devices](docs/android-real-device.md)
- [iOS and WDA signing](docs/ios-real-device.md)

## Supported baseline

- Mock: macOS, Linux and Windows with a supported Node runtime.
- Maintainer source baseline: Node 24.19.0 and pnpm 11.7.0.
- DSH integration: `@deepseek-ai/dsh@0.2.0-rc.2` exactly, with Native and PTC presentation.
- Physical devices: Appium 2/3 with UiAutomator2 or XCUITest/WDA, subject to the documented device evidence boundary.

Mock is the only deterministic path available to every contributor. Host Doctor success means prerequisites were found; it does not prove Android USB authorization, iPhone trust/Developer Mode, WDA signing or physical-device compatibility.

## What to include

Provide the smallest reproduction with:

- FlowAssert, Node, pnpm, DSH, Appium and driver versions that are relevant;
- host OS and whether the failure occurs in Mock, DSH, MCP, managed Appium or external Appium;
- stable FlowAssert error codes and sanitized steps;
- the exact repository verification commands you ran.

Do not attach device IDs, account/signing identities, Appium capabilities, host reports, provider tokens, absolute home paths, raw logs or screenshots containing private content. Replace them with placeholders and stable counts/codes.

## Out of scope

Maintainers cannot provide general support for Appium, Xcode provisioning, Apple/Google developer accounts, third-party model providers, remote exposure of the loopback Viewer, modified Harness agent loops or versions outside the documented matrix. Requests that cannot be reproduced with a supported baseline may be closed with a pointer to the relevant upstream project.
