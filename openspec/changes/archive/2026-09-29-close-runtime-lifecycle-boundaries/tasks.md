## 1. Lifecycle implementation

- [x] 1.1 Serialize comparison admission and implement idempotent close with queued cancellation and active drain.
- [x] 1.2 Await Worker exit on all paths; preserve leases on termination failure and reject late results.
- [x] 1.3 Wire application shutdown and audit other background owners.

## 2. Regression boundaries

- [x] 2.1 Add deterministic admission/close/cancel/late-result/termination and persistence failure tests, including restart ownership and unchanged evidence.
- [x] 2.2 Implement full source graph traversal, runtime-cycle and layer-reachability gates with negative fixtures.

## 3. Acceptance and delivery

- [x] 3.1 Run check, E2E, build, pack checks and packaged runtime probes; verify comparison UI progress and unrelated interactions.
- [x] 3.2 Record ADR, lifecycle audit, TODO and acceptance evidence; validate OpenSpec. Archive completed changes after delivery.
- [x] 3.3 Commit only intended files, push feature branch and verify remote SHA.
