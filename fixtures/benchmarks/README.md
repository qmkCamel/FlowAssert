# Physical Fixture UI benchmark v1

These two fixed flows open the installed Fixture, assert its native title, toggle Help twice and assert the title again. They create no orders. Each repetition starts a new Appium session, retains fresh PNG/XML for every step, checks an unrelated Viewer control during execution and verifies archived bytes after restart.

Use `pnpm test:workbench:benchmark` with explicit absolute `MOBILE_MIRROR_FLOW_PATH`, `MOBILE_MIRROR_CAPABILITIES_PATH`, `MOBILE_MIRROR_BENCHMARK_OUTPUT`, `MOBILE_MIRROR_APPIUM_EXECUTABLE` and loopback `MOBILE_MIRROR_APPIUM_URL`; set `MOBILE_MIRROR_REPEAT_COUNT=30`. Android media also needs the explicit scrcpy executable/server paths. Capability files and raw evidence belong in Git-ignored `artifacts/physical-validation/`.

The report checks input hashes before each repetition and retains completed samples on interruption. `budgets-v1.json` freezes the measured device-specific run budget after 30 samples. To check a frozen budget in a subsequent run, set `MOBILE_MIRROR_MAX_RUN_MS=11715` for the Android profile or `10821` for iPhone; do not replace it with the next run's newly calculated calibration value. Session startup/shutdown wall time is outside this run-duration budget. Both profiles are calibrated, not yet a subsequent frozen-budget regression run. Neither these Fixture results nor their budgets establish a production application SLO or a cross-platform speed ranking. iPhone's recorded initial state includes the keyboard, visible Help and a prior synthetic error; this flow only checks the native title and Help toggles, not business success.

Environment, physical acceptance boundaries and private report locations are recorded in `docs/physical-validation-2026-10-05.md`.
