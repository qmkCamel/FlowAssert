# Design: DeepSeek Harness mobile mirror MVP

## Context

The plugin must work inside the documented DeepSeek Harness Cordis lifecycle, cover eventual physical Android and iOS devices, keep visual data local, and later support a second agent client through MCP.

## Goals and non-goals

Goals:

- prove the full plugin install/register/start/view/action/stop lifecycle;
- provide a real Appium W3C path plus a deterministic Mock path;
- make long-running UI actions observable and recoverable;
- keep provider logic reusable outside DSH.

Non-goals for M1:

- 30–120 fps media or audio;
- automated WDA signing or Appium driver installation;
- generic MCP/Codex distribution;
- multiple concurrent device sessions.

## Decisions

### Native DSH adapter first

Register tools through `ctx.tools` and acquire the Viewer in `ctx.effect()`. This follows the documented lifecycle, gives clean disposal/HMR behavior, and avoids running an MCP server inside another plugin for the first release.

### Reusable stateful service

`MirrorService` owns the lifecycle and calls a `MirrorProvider`. Neither the Viewer HTTP adapter nor DSH tools own Appium state. A future MCP server can call the same service contract.

### Appium semantic control, replaceable media

The Appium provider uses W3C endpoints for status, session create/attach/delete, screenshots, actions, and back. Screenshot polling is sufficient to validate the contract. Later media adapters can replace only frame delivery.

### Explicit ownership

Sessions created by this service are deleted on stop. Sessions supplied by ID are only attached and must survive stop/disposal.

### Local-only Viewer

Config accepts loopback hosts only. The Viewer uses a same-origin API with bounded body size and security headers. It shows local progress immediately, disables duplicate destructive actions, permits an unrelated theme control while connecting, refreshes on completion, and keeps the last frame on transient failure.

## Failure handling

- Startup and provider calls use combined caller cancellation and configured timeouts.
- Failed connection transitions to `error` with a model-visible status message.
- Frame refresh failure records the error and returns the cached frame when possible.
- Stop failure remains visible rather than falsely reporting idle.

## Compatibility

Target DeepSeek Harness `0.1.0-rc.6`, Node `^22.19.0 || >=24.0.0`, Appium 2/3 W3C endpoints. Because Harness is a developer preview, bundle-load verification is required on every pinned upgrade.
