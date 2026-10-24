## Context

See `proposal.md` for motivation. The repository already publishes a versioned alpha.1 GitHub prerelease, while the integrated source is an alpha.2 candidate with detailed installation/security documents. The README information hierarchy was optimized for maintainers and the repository lacked GitHub community-health files. Current `main` history contains a personal maintainer email, the release package intentionally remains `private: true`, and tracked runtime evidence includes both Mock and physical-device screenshots.

This change must preserve product behavior and the existing release artifact. It must also preserve `artifacts/screenshots/mobile-mirror-ios-physical-final.png` exactly as requested, including its “微信” return entry. Repository visibility, historical workflow logs and GitHub security settings are external state; tracked files can make their review mandatory but cannot prove those settings changed.

## Goals / Non-Goals

**Goals:**

- Give first-time users a short, bilingual path from repository landing page to a successful Mock session before presenting physical-device complexity.
- Establish discoverable contribution, conduct, support and vulnerability-reporting contracts suitable for a public repository.
- Make current-tree, reachable-history and package leakage checks repeatable without printing secret values.
- Preserve Git history while creating an explicit legacy-history privacy boundary and preventing new personal author emails.
- Produce a concrete go/no-go checklist for the later GitHub visibility switch.

**Non-Goals:**

- Do not change FlowAssert runtime behavior, DSH/Cordis registration, Appium lifecycle, Viewer interaction or real-device support.
- Do not publish npm, modify/delete the existing GitHub prerelease, change repository visibility or mutate GitHub security settings.
- Do not rewrite or force-push published history. The legacy email remains reachable and is treated as an explicit maintainer acceptance item.
- Do not edit, crop, regenerate or remove the iOS screenshot containing the “微信” return entry.

## Decisions

### 1. Keep GitHub Release as the only public package channel

`package.json` remains `private: true`; README and the public-readiness guide state that source is MIT-licensed while installable alpha artifacts come from GitHub Releases. The release contract must continue rejecting `npm publish` steps. This separates source availability from registry support while DSH remains a developer preview.

Alternative: publish a public npm package now. Rejected because it adds registry ownership, provenance and support commitments without improving the current verified tarball path.

### 2. Put a progressive quickstart before architecture details

Both READMEs receive the same top-level information architecture: status and distribution notice, supported-version matrix, a five-minute Mock quickstart, four audience routes, sanitized Mock Viewer screenshot, limitations, then the existing detailed architecture/install sections. The screenshot will reuse `artifacts/screenshots/mobile-mirror-streaming.png`; no physical-device screenshot is changed.

Alternative: create a new documentation site. Rejected because GitHub users need a complete landing page and the current document set is still small enough for repository-native Markdown.

### 3. Use repository-local community policies with explicit support boundaries

Add root `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` and `SUPPORT.md`; add `.github/SECURITY.md`, `CODEOWNERS`, YAML issue forms, issue-template config, PR template and Dependabot configuration. English is the canonical contribution language, with short Chinese navigation in the Chinese README. Security reports must use GitHub private vulnerability reporting and must not include public device screenshots, capabilities, host reports, signing data or raw logs.

Alternative: depend on account-level default community files. Rejected because project-specific device/privacy rules must travel with clones and remain reviewable in this repository.

### 4. Add a deterministic public-readiness checker with a legacy boundary

Add a Node ESM script invoked by `pnpm public:check`. It uses argument-array child processes with `shell=false` and bounded output to inspect:

- tracked current files and every commit reachable from repository refs for private-key headers, credential-shaped values, absolute home paths and forbidden local configuration filenames;
- package contents through the existing pack contract rather than unpacking arbitrary user paths;
- commits after the recorded legacy boundary `REDACTED_REVISION`, except explicitly recorded already-pushed legacy SHAs, for author/committer emails that are not GitHub `users.noreply.github.com` addresses;
- required community-health files and README public-entry markers.

The script reports file/commit/check identifiers but never prints the matching line or candidate secret. Known placeholder fixtures are allowlisted narrowly by file and pattern. Legacy commits at or before `REDACTED_REVISION`, plus the already-pushed `REDACTED_REVISION` and `REDACTED_REVISION` feature-branch commits, are counted and called out in the manual checklist without repeating their email values; this preserves history while making acceptance explicit. All integration commits use the maintainer's GitHub noreply address.

Alternative: rewrite every historical commit. Rejected because the email has already been pushed, rewriting is destructive, and the user did not explicitly authorize force-pushing shared history.

### 5. Ignore real local state while keeping examples reviewable

Extend `.gitignore` with `.env` variants (retaining `.env.example`), real FlowAssert JSON, DSH patch, host-report, capabilities and signing/provisioning files. Add only placeholder-bearing `.example` files where a concrete example improves onboarding. Examples must use loopback, Mock, disabled high-risk permissions and obvious placeholder identifiers.

Alternative: ignore every JSON/YAML file with broad globs. Rejected because the repository legitimately tracks contracts, fixtures and OpenSpec artifacts in those formats.

### 6. Separate tracked readiness from external GitHub cutover

`docs/open-source-readiness.md` contains two sections:

- automated evidence: `public:check`, dependency audit, Markdown link check, required project gates and package inspection;
- manual/external evidence: accept or rewrite legacy author email, inspect historical Actions logs/artifacts, enable private vulnerability reporting/secret scanning/push protection/code scanning, protect `main`, verify release assets, topics/description and visibility consequences.

Checkboxes for external state remain unchecked until performed in GitHub. The implementation can still complete and be pushed because the repository is being prepared, not made public in this change.

## Risks / Trade-offs

- [Legacy personal email remains recoverable from Git history] → Make acceptance a blocking visibility-cutover item, use noreply for every new commit and require separate explicit authorization for any future history rewrite.
- [Regex history scanning produces false positives or misses provider-specific secrets] → Keep generic checks conservative, reuse repository-specific sensitive-output rules, add deterministic fixtures and rely on GitHub secret scanning as a separate external gate.
- [Governance files promise more support than maintainers can provide] → State developer-preview, best-effort support and maintainer-owned physical-device acceptance boundaries.
- [README copies drift] → Add contract tests for matching version/status/route markers and link both documents to the same detailed guides.
- [External GitHub settings are mistaken for completed work] → Keep their checklist boxes visibly unchecked and never use repository files as evidence of platform configuration.
- [Public checker touches the preserved screenshot] → Treat screenshots as scan inputs only and verify the requested iOS file hash is unchanged before commit.

## Migration Plan

1. Add community policies, public-readiness guide, safe examples and ignore rules.
2. Add the deterministic checker and contract tests, then wire `public:check` into CI without changing runtime package behavior.
3. Reorganize both README introductions and reuse the existing sanitized Mock screenshot.
4. Run Markdown links, `public:check`, dependency audit, required project gates, strict OpenSpec validation and diff/sensitive-output checks.
5. Verify the preserved iOS screenshot is byte-identical, commit with a GitHub noreply author and integrate the isolated implementation branches into `dev`.
6. After merge, a maintainer separately completes the GitHub external checklist before changing visibility.
