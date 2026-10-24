## Context

See proposal.md. dev@REDACTED_REVISION already has Inspector drafts, run/fixture execution, repair proposals, reports, comparisons and a shared application. The missing work is a continuous user path and explicit new readiness/investigation behavior, not a replacement executor.

## Goals / Non-Goals

Goals: deliver the first three numbered iterations in order; reuse consent, ownership, result projection and evidence storage; keep bilingual keyboard-accessible UI; make software validation repeatable.

Non-goals: PR acceptance objects, cloud/device scheduling and general OCR (iterations four through six); claiming real-device or non-author benefit from synthetic tests. Existing triage/visual experimental gates remain open.

## Decisions

1. A separate Viewer acceptance module owns a form and revision-scoped validation, while the existing editor/run controller owns execution. Inspector explicitly transfers text; replacing a nonempty editor requires confirmation. Validation binds to the exact YAML/params revision. Project export is a bounded tar download with fixed relative paths, a flow, suite config and a README. Registered external code and credentials are never copied; flows referencing external project capabilities are rejected for standalone export with an actionable explanation.
2. Add opt-in `tapReady`, `fillReady`, `waitFor`, `assertReady` nodes. Their target supports exact `testId`, `role`, `name`, `text` and one `within` scope. The flow compiler validates strict schemas and parameter bindings. Reads poll for one visible/enabled target with unchanged identity/bounds over two samples; tap/fill use the existing run lease and durable dispatch journal. Ambiguity/truncated trees/sensitive nodes fail closed. Negative visibility checks and explicit focus handling are supported. One budget covers polling; mutations are never retried. Existing AppClaw selectors and flows are untouched.
3. Existing prepare/verify/cleanup and case isolation remain the fixture runtime. The assistant exposes registered public hook names/shapes, offers a downloadable self-contained fixture template, and explains per-run ownership/cleanup. Shared mutable suite fixtures are not introduced: current suites already execute isolated cases and retry safety is explicit. Document and test this lifecycle instead of implying a new shared-state mechanism.
4. Investigation plans are a deterministic read-only projection of verified finished runs. They contain earliest checkable failure, source facts, competing directions, missing information, finite next checks and success/failure interpretation. They cannot issue device or network calls. A separately selected follow-up must be a finished child run of the original with matching app/platform; projected verdict/dimensions, repaired lineage and source differences are shown without assigning causality. New reads use existing leases and same-origin Viewer authorization. Existing triage analyzer and Agent contracts remain stable.
5. Tests cover success plus ambiguity, delayed visibility/enabled/stability, abort, stale UI responses, failed export/validation, business false positives and unrelated follow-ups. An offline evaluation matrix tests next-check correctness and forbidden conclusions, but is labelled synthetic and does not replace the existing 60+60 independent corpus or five-person study.

## Risks / Trade-offs

- Additional polling costs device reads → only explicit new steps use it; expose duration/reason codes, maximum 60 seconds and bounded poll intervals.
- A tree is not a complete visibility oracle → label checks as accessibility readiness; do not claim pixel occlusion detection.
- Exported YAML may contain public app content → explicit review and local download, no remote sharing; no arbitrary archive paths.
- Model or human diagnostic benefit remains unknown → retain the existing independent evaluation gates and do not rename experimental triage as root-cause analysis.

## Migration Plan

Additive YAML/API/UI changes, no rewrite of existing runs. Upgrade required to execute new readiness steps. Old versions reject new syntax rather than silently weakening it. Keep the core provider/transport and DSH rc.2 boundary unchanged.
