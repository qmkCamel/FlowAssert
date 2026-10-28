# FlowAssert

**Repeatable mobile tests. Explicit assertions. Evidence you can inspect.**

English | [简体中文](README.zh-CN.md)

[Quickstart](#quickstart) · [Documentation](https://github.com/qmkCamel/flowassert/blob/main/docs/README.md) · [MCP integration](docs/mcp-hosts.md) · [Contributing](https://github.com/qmkCamel/flowassert/blob/main/CONTRIBUTING.md)

FlowAssert is a local automation test workbench for Android and iOS. Write readable YAML flows, watch them run, and inspect screenshots, assertion diagnostics, and run history in one place. Use the workbench on its own, or connect a coding agent through MCP or DeepSeek Harness.

> **Developer Preview · `0.1.0-alpha.2`.** Start from source. No FlowAssert release has been published, and the package is not on public npm. The source repository is public. The standalone workbench needs no model credentials or DeepSeek Harness.

[![Watch the 46-second FlowAssert product introduction (Chinese narration)](https://raw.githubusercontent.com/qmkCamel/flowassert/main/docs/communications/product-video/cover.png)](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/product-video/flowassert-introduction.zh-CN.mp4)

*Click the cover to open the 46-second video. Edited Mock demonstration with Chinese narration and electronic music; not physical-device acceptance evidence.*

[▶ Watch video (中文)](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/product-video/flowassert-introduction.zh-CN.mp4) · [Subtitles and production source](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/product-video/README.md).

## Why FlowAssert?

- **Keep tests readable.** Version YAML flows for taps, swipes, waits, and explicit assertions. Fixed flows do not call a model at every step.
- **See what happened.** Watch the device during execution and inspect retained step images, interface structure, logs, and assertion diagnostics afterward.
- **Keep the history.** Save case revisions, compare linked runs, and revisit a failure after a rerun. A new result does not replace the original.
- **Share reviewable results.** Export JSON or a reviewed offline HTML report, with explicit attachment selection and image masking.
- **Work with agents.** Give an MCP client access to device observation and control, with separately authorized execution of registered tests.

## Quickstart

Try a Mock test before connecting a phone. It needs no Appium, mobile toolchain, model credentials, or device discovery.

### 1. Start the workbench

Use **Node 24.19.0** and **pnpm 11.7.0**, the source toolchain pinned by this repository. With [mise](https://mise.jdx.dev/getting-started.html) installed:

```bash
git clone --branch main --single-branch https://github.com/qmkCamel/flowassert.git
cd flowassert
mise install
mise exec -- corepack enable
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

If you manage Node yourself, install the versions above and run the same commands without `mise exec --`. Open the local URL printed in the terminal (default `http://127.0.0.1:3210`). If the port is occupied, use `mise exec -- pnpm dev --port 0` to choose an available port. The Viewer supports English and Simplified Chinese.

### 2. Run your first test

1. In **Devices**, select **Mock device · demo** and choose **Start demo**. Leave the device screen untouched so its action count starts at zero.
2. Open **Cases → New case** (`/#/cases/new`), load the Mock demo, and expand the YAML editor. Replace its contents with the five-step example below.
3. Confirm that the example contains only public demo content, save the case, run static validation, then confirm and start the run. Expect **Passed** with all five steps complete.
4. Open a step to inspect its screenshot and assertion diagnostics. Refresh the page and reopen the result from run history.

```yaml
name: Demo · tap and verify
platform: ios
appId: com.example.mobilemirror.mock
---
- launchApp
- assertVisible:
    text: Hello, harness.
- tap:
    accessibilityId: action-card
- assertVisible:
    text: 1 actions received
- done
```

This is the repository's [Mock flow](https://github.com/qmkCamel/flowassert/blob/main/examples/flows/demo.yaml); `platform: ios` does not require an iPhone. The compatibility workbench at `/#/legacy` can also run it.

### 3. Inspect a failure and rerun

Stop and restart Mock to reset its action count. Change `1 actions received` to `2 actions received`, save a new revision, validate, and run. Step 4 should fail and step 5 should remain unexecuted. Open the report to compare the expected and observed result.

Reset Mock again, restore the expected value to `1`, and run a new revision. Both the failure and the new passing run remain in history. Rerunning or launching the app does **not** reset Mock automatically. This exercise corrects an intentionally wrong expectation; investigate unexpected failures before changing a real test.

You can keep viewing the device during execution or cancel the run. Cancellation does not roll back device actions. For the full first-use walkthrough and report-sharing exercise, see the [beta task card (中文)](https://github.com/qmkCamel/flowassert/blob/main/docs/beta-start.md).

## Choose your workflow

| Goal | Start here |
| --- | --- |
| Connect an Android phone or iPhone | [Android setup](docs/android-real-device.md) · [iOS / WDA setup](docs/ios-real-device.md) · [Local Viewer](docs/local-viewer.md) |
| Write flows and inspect elements | [Workbench guide](docs/test-workbench.md) · [Inspector](docs/inspector-validation.md) |
| Read, compare, or share results | [Reports and offline sharing](docs/report-reading-and-sharing.md) |
| Connect Codex or another MCP client | [MCP host guide](docs/mcp-hosts.md) · [Registered test execution](docs/agent-test-run-control.md) |
| Integrate DeepSeek Harness | [Installation and compatibility](docs/beta-installation.md) |
| Import reports or review a change | [External test assets](docs/external-test-assets.md) · [Change acceptance](docs/change-acceptance-records.md) |
| Explore opt-in capabilities | [Runtime assertions](docs/runtime-assertions.md) · [Local OCR](docs/local-region-ocr.md) · [Device matrix](docs/local-device-matrix.md) |

Many detailed guides are currently in Chinese. The technical overview is available in [English](docs/technical-guide.md) and [简体中文](docs/technical-guide.zh-CN.md).

## Requirements and integrations

| Entry | Requirements and scope |
| --- | --- |
| Source / Mock | Node 24.19.0, pnpm 11.7.0. Start here without a phone. The first-use reference environment is macOS. |
| Android device | USB authorization, Appium, UiAutomator2, and compatible scrcpy. Tested stack: Appium 3.2.0, UiAutomator2 6.8.0, scrcpy 4.1 on macOS. |
| iOS device | macOS, Xcode, device trust, Developer Mode, and signed WDA. Tested stack: Appium 3.2.0, XCUITest 10.19.1, WDA MJPEG. |
| MCP | A compatible MCP host; no DSH dependency. Device and evidence permissions are configured separately. |
| DSH plugin | DeepSeek Harness `0.2.0-rc.2` exactly. Model-provider validation is separate from plugin compatibility. |

The Viewer, MCP server, and DSH adapter share device control through MirrorService/Appium. The workbench uses the pinned AppClaw 2.7.0 YAML executor; you do not need the AppClaw CLI. Continuous video stays local; agent tools exchange discrete observations and control results. See [architecture](docs/architecture.md) and [environment preflight](docs/environment-preflight.md).

## Status and limits

FlowAssert is a developer preview for local mobile testing. Review the [capability matrix](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md) before relying on a specific feature.

- **A pass has a defined scope.** It confirms declared assertions and required evidence. Visual, OCR, and business checks need explicit configuration; an ordinary UI pass does not establish them.
- **Physical setup is explicit.** Connecting a device may require signing and platform-specific tools. Published physical results cover particular devices and fixtures, not every app, OS, or account.
- **Advanced features have separate acceptance gates.** OCR approval, the physical two-slot matrix, real-business validation, and independent-user studies remain incomplete. Repair is an opt-in preview, off by default; consult its [operations guide](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md).
- **Reports preserve their origin.** Offline HTML is a derived reading document, not a replayable test. Importing an external report does not launch its runner.

This repository has independent Git history. Earlier reports and screenshots document pre-migration work, not fresh FlowAssert acceptance. See [validation](docs/validation.md), [physical-device evidence](docs/workbench-validation.md), [runtime-gate evidence](docs/runtime-gates-validation.md), and [release readiness](https://github.com/qmkCamel/flowassert/blob/main/docs/open-source-readiness.md) for dated results and remaining work.

## Data and privacy

Services bind to loopback by default. Raw run evidence is stored locally at `~/.local/share/mobile-mirror/runs/` by default; the directory name is retained for compatibility. Screenshots and interface trees may contain page or account data. Review attachments and unmasked pixels before sharing. Local execution does not automatically authorize an agent to share evidence. Read the [security model](docs/security.md).

## Contributing

Bug reports, setup feedback, documentation improvements, and focused patches are welcome. Include the commit SHA, environment, and a minimal reproduction; remove credentials and private device evidence.

Read the [contribution guide](https://github.com/qmkCamel/flowassert/blob/main/CONTRIBUTING.md), [support guide](https://github.com/qmkCamel/flowassert/blob/main/SUPPORT.md), and [product TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md). Use the [security policy](https://github.com/qmkCamel/flowassert/blob/main/.github/SECURITY.md) for sensitive reports.

From a source checkout, run the project gates:

```bash
pnpm check
pnpm test:e2e
pnpm build
pnpm pack:check
```

## License

[MIT](LICENSE). Third-party notices are listed in [licenses/NOTICE.md](licenses/NOTICE.md).
