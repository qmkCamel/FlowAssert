# Project Agent Guide

## Source of truth

- Product behavior is specified in `openspec/specs/` and active changes in `openspec/changes/`.
- Architecture decisions live in `docs/decisions/`; update the relevant ADR when a provider or transport boundary changes.
- DeepSeek Harness is a developer preview. Keep the tested Harness version explicit and never patch its agent loop.

## Implementation rules

- Register all Harness behavior through documented Cordis effects and registries.
- Keep the DSH adapter thin; device control belongs behind `MirrorService`/provider interfaces so a later MCP adapter can reuse it.
- MCP and agent tool results carry control/status data, not continuous video payloads.
- Any user-triggered action that can exceed 300 ms must have local progress, preserve the last usable result on failure, and be tested while another control remains interactive.
- Bind network services to loopback by default. Host command discovery and destructive session ownership must remain explicit.

## Required gates

Run `pnpm check`, `pnpm test:e2e`, `pnpm build`, and `pnpm pack:check`. For Viewer changes, retain and inspect a runtime screenshot.
