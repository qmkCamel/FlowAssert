# Managed Workbench jobs

Managed jobs are the headless, single-owner counterpart to `test suite --url`. The attach command continues to use an already-running Viewer and never shuts that Viewer, its device session, or its driver down. `test job` starts a loopback runtime, acquires the existing device claim, runs one locally registered suite, writes reports, and then releases only resources it owns.

## Local prerequisites

Use `doctor --operation test --test-ref suite:<id> --provider mock|appium --config <absolute-json>` for read-only preparation of a registered suite. Set the provider to match the private job connection. Doctor never starts the job or owns its session. For `test suite --url`, a local CLI receipt does not certify the attached Viewer: run preparation in that Viewer's environment. Browser recording cannot be required by a headless doctor. [Doctor v2 migration and scopes](environment-preflight.md).

- A trusted absolute runtime config with `agentTestControl.enabled: true`, an absolute `projectPath`, and the suite/platform/App allowlists.
- A separate private connection JSON. Keep capabilities, device identifiers, signing configuration, account data, and local paths out of the repository.
- For Android: an already authorized device, the pinned Appium/UiAutomator2 setup, and any required isolated test account.
- For iOS: trusted device, Developer Mode, valid WDA signing/provisioning, the pinned XCUITest driver, and any required isolated test account.
- A self-hosted runner with exclusive access to that device. Another live owner causes a fail-closed preflight; the job does not queue, steal the claim, or kill the owner.

Mock connection file:

```json
{"provider":"mock"}
```

Appium connection files use exactly one of a pre-existing `sessionId` or a `capabilities` object. They are trusted local inputs and are never copied into the job summary.

```bash
flowassert test job smoke \
  --config /opt/mobile-mirror/private/runner.json \
  --connection /opt/mobile-mirror/private/device.json \
  --report-dir /opt/mobile-mirror/results/current \
  --timeout-ms 3600000
```

The report directory contains the immutable run/suite evidence under `runs/`, one `*.job.json`, and one `*.junit.xml`. Headless jobs record browser video as `not-performed`; they do not imply that a recording exists.

## Exit contract

| Code | Meaning |
| --- | --- |
| `0` | Tests, required report writes, and owned-resource cleanup all completed cleanly. |
| `1` | A deterministic test failure, recovered result, or flaky result occurred. |
| `2` | Startup, infrastructure, report writing, cleanup, timeout, or result certainty failed. |
| `130` | A user signal cancelled the job and bounded cleanup completed. Cleanup uncertainty still wins as `2`. |

The JSON keeps `suiteExitCode` separate from `jobExitCode`. For example, a suite can remain `0` while a failed JUnit write makes the job `2`. SIGINT/SIGTERM stops new dispatch, drains/cancels the accepted execution within the shutdown budget, and never automatically replays it after restart.

## Self-hosted CI

The example workflow at `.github/workflows/mobile-mirror-self-hosted.yml` is manual-only. Configure these repository/environment variables to point to private files already provisioned on the runner:

- `MOBILE_MIRROR_RUNNER_CONFIG`
- `MOBILE_MIRROR_CONNECTION_CONFIG`
- `MOBILE_MIRROR_REPORT_ROOT`

Do not store their contents in GitHub variables, artifacts, logs, or the repository. Protect the runner label/environment so untrusted pull requests cannot use a connected device or its accounts.
