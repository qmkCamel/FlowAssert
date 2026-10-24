## MODIFIED Requirements

### Requirement: Installable DeepSeek Harness bundle

The package SHALL declare a DeepSeek Harness bundle patch that inserts one schema-validated Cordis plugin row, SHALL register behavior only through documented effects and registries, and MUST pin its tested Harness host packages to exact version `0.1.5-rc.2` until a later version receives the same clean-profile acceptance. A newer alpha tag or source commit MUST NOT be reported as a supported host without the same reproducible package and runtime gates.

#### Scenario: Installing the current bundle in an rc.2 profile

- **WHEN** a user installs the packed plugin into an isolated DeepSeek Harness `0.1.5-rc.2` profile
- **THEN** the config dump SHALL contain the `mobile-mirror` row
- **AND** Native and PTC modes SHALL register the same ten tools and complete the Mock semantic lifecycle
- **AND** disposal SHALL release plugin-owned resources.

#### Scenario: Installing the alpha prerelease

- **WHEN** a user downloads the `0.1.0-alpha.1` GitHub prerelease tarball, verifies its published SHA256 and installs it into a clean rc.8 profile
- **THEN** DSH SHALL load the bundled schema/viewer/runtime directly from the tarball and complete the Mock observation/action lifecycle
- **AND** installation MUST NOT run a repository build, publish to npm or require a Git checkout.

#### Scenario: Detecting Harness version drift

- **WHEN** package peers, lockfile, current documentation or runtime probes no longer resolve to exact `0.1.5-rc.2`
- **THEN** contract validation SHALL fail
- **AND** the newer version MUST NOT enter the support matrix before packed clean-profile acceptance passes.

#### Scenario: Reviewing a newer unpublished source tag

- **WHEN** GitHub exposes a newer DSH tag or commit whose exact packages have not passed this repository's acceptance gates
- **THEN** documentation MAY record compatible API observations with an explicit date and commit/tag
- **AND** package peers, support matrix and runtime probe MUST remain on `0.1.5-rc.2`.
