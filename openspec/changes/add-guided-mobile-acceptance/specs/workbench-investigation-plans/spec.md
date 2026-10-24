## Purpose

Help users investigate finished mobile test failures using specific evidence, finite next checks and explicit follow-up results without overwriting original conclusions.

## ADDED Requirements

### Requirement: Evidence-derived investigation plan
The system SHALL identify the earliest checkable failure, observed facts, competing directions, missing information and concrete next checks with interpretation criteria. It MUST distinguish a proposed check from a performed check and never present a suggested cause as an established root cause.

#### Scenario: Missing locator
- **WHEN** the recorded failure indicates a missing target
- **THEN** the plan includes page/state, locator-change and visibility checks, with evidence references and unresolved alternatives

#### Scenario: Incomplete evidence
- **WHEN** current evidence is unavailable or invalid
- **THEN** the plan prioritizes restoring or recapturing evidence and withholds unsupported product/locator conclusions

### Requirement: Explicit follow-up review
The user SHALL explicitly select a finished child run from the same App/platform to compare projected results and verification dimensions. The original run and report MUST remain unchanged; recovery and unverified imports MUST NOT be called clean passes.

#### Scenario: Unrelated follow-up
- **WHEN** a selected run is unrelated, unfinished or for another App/platform
- **THEN** comparison is rejected with no modification to either run

### Requirement: Reproducible software evaluation
The repository SHALL include deterministic failure-category and negative-control evaluation for investigation plans. Results MUST identify synthetic coverage separately from real-device and independent non-author studies.

#### Scenario: Synthetic evaluation passes
- **WHEN** the software matrix passes
- **THEN** it reports contract coverage without claiming measured diagnostic accuracy or human time savings
