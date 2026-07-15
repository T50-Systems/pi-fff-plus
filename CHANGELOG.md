# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- contributor, architecture, product, examples, and performance documentation;
- unit tests and coverage for query normalization;
- reproducible query-normalization benchmark;
- CI validation for typechecking, tests, and dependency auditing.
- immutable, reviewed GitHub Action pins with an offline all-workflow validator, Dependabot policy verification, and negative policy fixtures.
- GitHub issue #38 is CI supply-chain hardening only; it requires no `dmtrKovalenko/fff` or `@ff-labs/fff-node` update and does not include issue #36 or #37 behavior.
- deterministic lifecycle/UI coverage now exercises mode restoration and malformed-state recovery, autocomplete delegation, command notifications and persistence, rendering, and shutdown with a separate entrypoint coverage budget.

## 0.1.1

### Fixed

- included the Pi CLI npm root in default configured roots.

## 0.1.0

### Added

- initial T50 FFF search extension with safer Windows and multi-root behavior.
