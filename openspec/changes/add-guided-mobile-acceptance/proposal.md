## Why

The current workbench has execution and evidence primitives but a first-time user must manually connect Inspector, YAML, project setup and failure interpretation. The next three product iterations should make first acceptance continuous, make deterministic tests easier to maintain, and turn archived failure facts into actionable investigation steps.

## What Changes

- Add a bilingual first-acceptance assistant: choose platform/App, start from a template, transfer an Inspector draft, validate expectations, run through the existing consent path, inspect results and export a reusable project.
- Add opt-in semantic locators and bounded actionability waits with unique/visible/enabled/stable checks, classified timeout reasons and cancellation. Keep legacy YAML semantics compatible.
- Expose registered business fixtures and their lifecycle in the assistant; provide reusable project scaffolding with explicit prepare/verify/cleanup contracts. Show repair diffs and their rerun lineage.
- Add evidence-derived next-check plans and explicit follow-up run comparison, preserving facts, hypotheses, unknowns and the original verdict. Provide a deterministic evaluation corpus and repeatable evaluation for the new plans.
- Retain the existing independent real-device and non-author evaluation gates; software completion cannot establish human diagnostic benefit.

## Capabilities

### New Capabilities
- `guided-mobile-acceptance`: continuous first acceptance and portable project handoff.
- `workbench-actionable-locators`: explicit semantic locators and bounded action readiness.
- `workbench-investigation-plans`: evidence-derived next checks and follow-up comparison.

### Modified Capabilities

None. Existing execution, authorization, evidence and verdict contracts remain authoritative; new syntax and routes are additive.

## Impact

Viewer/Inspector, validation and project endpoints, native execution bridge, locator adapters and failure diagnostics. Local Android/iOS through the existing MirrorService/Appium provider; no new device owner or continuous media transport. MCP/DSH continue sharing the same core; no host loop changes. Project export contains reviewed public YAML and templates, never host paths, credentials or device identities. No arbitrary module installation or remote upload. Source baseline: dev@REDACTED_REVISION.
