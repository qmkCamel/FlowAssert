## Problem and approach

<!-- Explain the problem, the chosen approach, and important alternatives. -->

## OpenSpec and compatibility

<!-- Link the active OpenSpec change, or explain why this is docs/tooling-only with skip_specs. -->

- OpenSpec change:
- Compatibility/failure behavior:
- Unverified boundary:

## Verification

<!-- List only commands that were actually run. -->

- [ ] `pnpm check`
- [ ] `pnpm test:e2e`
- [ ] `pnpm build`
- [ ] `pnpm pack:check`
- [ ] Strict OpenSpec validation
- [ ] `git diff --check`

## Privacy and evidence

- [ ] I removed device IDs, account/signing identities, capabilities, host reports, credentials, absolute home paths and raw logs.
- [ ] Screenshots are necessary, reviewed and contain no unintended personal content.
- [ ] Mock/clean-package/host/physical-device evidence is labeled accurately.
- [ ] Viewer work includes a retained and inspected runtime screenshot; otherwise this item is not applicable.

## Reviewer notes

<!-- Suggested review order, risky files, migration or rollback notes. -->
