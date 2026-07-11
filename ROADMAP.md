# Roadmap

This roadmap is an issue-backed view of product commitments, not a substitute for GitHub issues. Product metrics are defined in [`docs/PRODUCT.md`](docs/PRODUCT.md).

## Next

Items remain Next while their linked issue is open and verification evidence has not been accepted on the default branch.

| Metric | Committed work | Issue | Verification evidence |
|---|---|---|---|
| SAFE-1, UX-1 | Extract root authorization and finder lifecycle | [#19](https://github.com/T50-Systems/pi-fff-plus/issues/19) | `src/root-authorization.ts`, `src/finder-lifecycle.ts`, module and registration tests |
| SAFE-1 | Containment, traversal, symlink/junction, UNC, drive, and case fixtures | [#20](https://github.com/T50-Systems/pi-fff-plus/issues/20) | `tests/root-authorization.test.ts`, `tests/tools.test.ts`, threat model |
| REL-1, UX-1 | Caller and formatted-output budgets | [#21](https://github.com/T50-Systems/pi-fff-plus/issues/21) | TypeBox schema bounds and worst-case formatter tests |
| REL-1, SAFE-1 | Immutable cursor/query/root-generation binding | [#22](https://github.com/T50-Systems/pi-fff-plus/issues/22) | `tests/cursors.test.ts`, continuation/mismatch/refresh tests |
| REL-1, UX-1 | Tool-level caps, fallback, pagination, abort, failure, and path tests | [#23](https://github.com/T50-Systems/pi-fff-plus/issues/23) | `tests/tools.test.ts`, `tests/index-registration.test.ts` |
| REL-1 | Tested upstream compatibility range and rollback policy | [#24](https://github.com/T50-Systems/pi-fff-plus/issues/24) | compatibility test, lockfile verifier, release check |
| SAFE-1, REL-1 | Security policy, threat model, Dependabot, and least privilege | [#25](https://github.com/T50-Systems/pi-fff-plus/issues/25) | `SECURITY.md`, `docs/THREAT_MODEL.md`, workflow configuration |
| PERF-1 | Fixed-fixture indexing/search/authorization/formatting benchmark | [#26](https://github.com/T50-Systems/pi-fff-plus/issues/26) | `npm run benchmark`, `docs/PERFORMANCE.md` |
| UX-1, REL-1 | Establish this issue-backed roadmap and governance | [#27](https://github.com/T50-Systems/pi-fff-plus/issues/27) | this document and monthly/release triage records |

## Later

There are no committed Later items. A candidate moves here only after a maintainer opens or selects an issue, identifies its product metric, owner, acceptance evidence, and priority. Prose-only ideas are not commitments.

## Deferred

These directions are intentionally not planned:

- unbounded search or context output, because it conflicts with REL-1;
- broader default roots or implicit symlink-target authorization, because they conflict with SAFE-1;
- network telemetry or remote query/content processing without an approved security design;
- CI-enforced indexing latency/memory floors until repeated hosted-runner baselines exist;
- upstream breaking-version adoption without a maintainer-owned compatibility and rollback issue.

A deferred item can return only through an open issue with new evidence, metric impact, ownership, and explicit maintainer prioritization.

## Governance

### Triage cadence

Maintainers review the roadmap monthly and before each release. The review verifies that links remain open/current, evidence still matches the default branch, labels/owners are present, and performance/security assumptions remain valid. Material changes are recorded in the relevant issue or release notes.

### Stale items

An item with no progress or owner for two consecutive monthly reviews is either assigned, moved to Deferred with a reason, or removed after its issue disposition is recorded. Completed work leaves Next only after default-branch verification evidence is accepted; issue state remains the source of truth.

### Labels and contributor entry points

Use `roadmap` for committed direction, `help wanted` for contribution-ready work, and `good first issue` only when scope is bounded, setup is documented, and no maintainer-only security/compatibility decision remains. Labels supplement rather than replace acceptance criteria.

### Ownership

Root authorization, symlink/junction policy, filesystem-root scanning, security disclosure, dependency range/breaking updates, native binary support, and performance enforcement thresholds are maintainer-owned decisions. Contributors may prepare evidence and patches, but maintainers approve the boundary or compatibility decision and rollback plan.
