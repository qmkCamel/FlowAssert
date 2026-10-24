## Context

Baseline REDACTED_REVISION. The application owns triage/share/suite/run shutdown, but comparison still schedules a private queue without a close contract. The previous Worker helper resolves before termination. Architecture checks cover selected direct imports only.

## Goals / Non-Goals

Goals: stop admission synchronously, settle admitted requests, cancel queued/active comparisons, await actual Worker exit before releasing read leases, surface persistence/termination errors, prevent late results and safely recover interrupted records. Enforce the repository module graph in CI.

Non-Goals: generic task scheduler, dynamic plugin framework, database/index migration, new engine, new device capabilities or dev merge.

## Decisions

1. Comparison retains its domain-specific queue. Serialize admissions and track the active drain promise; close is memoized, prevents scheduling and waits for admitted work. Persist queued cancellation even when another cancellation fails. Terminal persistence failures are propagated by close; durable references are never revoked by shutdown.
2. Separate comparison Worker ownership from report orchestration. One winning event, a bounded execution timer, abort-before-create checks, listener cleanup and awaited termination/exit apply to success/error/cancel/timeout. If termination rejects, retain the lease until actual exit and surface the error; never declare an unconfirmed live Worker safely stopped. This favors safety over claiming a bounded successful shutdown after a broken runtime termination API.
3. Application stops admissions before draining background services; comparison completes before workbench closes its Store. Other shutdown errors remain aggregated and independent cleanup still runs once workers are known stopped.
4. Walk all source modules recursively using TypeScript AST. Resolve static imports, re-exports, literal dynamic imports and require calls; distinguish erased type edges from runtime edges. Check cycles and layer reachability, fail on unresolved local imports or unreviewed nonliteral module loads. Explicit narrow exceptions must be documented/tested, not a blanket graph baseline.
5. Test controlled delayed Workers, publication/terminal-write failures, rejected termination with delayed exit, late callbacks and restart recovery. Preserve source manifests and existing reports. Audit existing triage/share/suite/run/media ownership without a blanket rewrite.

## Risks / Trade-offs

- A Worker that never emits exit after failed termination keeps shutdown pending → preserve ownership rather than permit a second writer; document operator recovery.
- Filesystem failure prevents terminal persistence → propagate failure and leave durable references plus a recoverable nonterminal record; restart retries interruption recovery.
- Existing graph cycles → remove small ownership/type leaks rather than allow all existing violations.
- Tests may generate screenshots → only intentional evidence is committed; build and E2E run serially.

## Migration Plan

No stored schema migration. Keep report and tool contracts compatible. After gates, sync/archive the prior completed change and this iteration; document exact package/host checks and commit/push only scoped files. No automatic dev merge.
