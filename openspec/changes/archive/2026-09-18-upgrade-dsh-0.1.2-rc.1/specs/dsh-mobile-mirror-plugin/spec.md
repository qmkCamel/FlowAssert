## MODIFIED Requirements

### Requirement: Installable DeepSeek Harness bundle

The package SHALL declare a DeepSeek Harness bundle patch that inserts one schema-validated Cordis plugin row, SHALL register behavior only through documented effects and registries, and MUST pin its tested Harness host packages to exact version `0.1.2-rc.1` until a later version receives the same clean-profile acceptance. The checksum-verified GitHub prerelease tarball SHALL remain installable without building repository source. A newer GitHub source tag without corresponding installable npm packages MUST NOT be reported as a supported host.

#### Scenario: Installing the current bundle in an rc.2 profile

- **WHEN** a user installs a prebuilt package with `dsh plugin --profile <name> add <package>` into an isolated DeepSeek Harness `0.1.5-rc.2` profile
- **THEN** the profile bundle list SHALL include this package
- **AND** `dsh --profile <name> --dump-config` SHALL contain the `mobile-mirror` row
- **AND** Native Mode and PTC mode SHALL each register the nine canonical tools and complete the Mock semantic lifecycle
- **AND** plugin disposal SHALL close host resources.

#### Scenario: Installing the alpha prerelease

- **WHEN** a user downloads the `0.1.0-alpha.1` GitHub prerelease tarball, verifies its published SHA256 and installs it into a clean rc.8 profile
- **THEN** DSH SHALL load the bundled schema/viewer/runtime directly from the tarball and complete the Mock observation/action lifecycle
- **AND** installation MUST NOT run a repository build, publish to npm or require a Git checkout.

#### Scenario: Detecting Harness version drift

- **WHEN** the dependency, lockfile, package peer contract, documented current baseline or runtime/clean-profile probe no longer resolves to `0.1.2-rc.1` and `native|ptc`
- **THEN** repository contract validation MUST fail
- **AND** a newer Harness preview MUST NOT become the supported baseline until clean-profile installation, Native/PTC runtime probes and package gates pass for that exact version.

#### Scenario: Reviewing a newer unpublished source tag

- **WHEN** GitHub exposes a newer DSH tag whose matching root/subpackages cannot be installed from the public package registry
- **THEN** documentation MAY record compatible API observations with an explicit date and commit/tag
- **AND** package peers, support matrix and runtime probe MUST remain on the latest exact version that passed reproducible clean-profile acceptance.
