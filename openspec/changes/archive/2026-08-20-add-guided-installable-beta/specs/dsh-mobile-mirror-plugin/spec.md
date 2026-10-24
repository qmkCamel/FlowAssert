## MODIFIED Requirements

### Requirement: Installable DeepSeek Harness bundle

The package SHALL declare a DeepSeek Harness bundle patch that inserts one schema-validated Cordis plugin row, SHALL register behavior only through documented effects and registries, and MUST pin its tested Harness host packages to exact version `0.1.0-rc.8` until a later version receives the same clean-profile acceptance. Version `0.1.0-alpha.1` SHALL additionally be installable from the checksum-verified GitHub prerelease tarball without building repository source.

#### Scenario: Installing the bundle in an rc.8 profile

- **WHEN** a user installs a prebuilt package with `dsh plugin --profile <name> add <package>` into an isolated DeepSeek Harness `0.1.0-rc.8` profile
- **THEN** the profile bundle list includes this package
- **AND** `dsh --profile <name> --dump-config` contains the `mobile-mirror` row
- **AND** Native Mode and Code Mode each register the eight canonical tools
- **AND** plugin disposal closes host resources.

#### Scenario: Installing the alpha prerelease

- **WHEN** a user downloads the `0.1.0-alpha.1` GitHub prerelease tarball, verifies its published SHA256 and installs it into a clean rc.8 profile
- **THEN** DSH SHALL load the bundled schema/viewer/runtime directly from the tarball and complete the Mock observation/action lifecycle
- **AND** installation MUST NOT run a repository build, publish to npm or require a Git checkout.

#### Scenario: Detecting Harness version drift

- **WHEN** the dependency, lockfile, package peer contract, documented current baseline or runtime probe no longer resolves to `0.1.0-rc.8`
- **THEN** repository contract validation MUST fail
- **AND** a newer Harness preview MUST NOT become the supported baseline until clean-profile installation, Native/Code runtime probes and package gates pass for that exact version.
