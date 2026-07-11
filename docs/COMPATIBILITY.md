# Upstream Compatibility Policy

## Supported range

`@t50-systems/pi-fff-plus` supports `@ff-labs/fff-node` `^0.9.6` (`>=0.9.6 <0.10.0`). The lockfile is the tested resolution and `npm run verify:compatibility` fails if the declaration or lockfile leaves that range.

The extension depends on these upstream behaviors:

- `FileFinder.create` returns a typed success/error result and accepts root, database, AI-mode, and scan options.
- `waitForScan` makes initial file search usable within a bounded wait.
- `grep` supports plain, regex, and fuzzy modes, context, per-file/page caps, and opaque continuation cursors.
- `fileSearch` supports deterministic page index/page size pagination.
- `mixedSearch`, `scanFiles`, `healthCheck`, `isDestroyed`, and `destroy` retain their current lifecycle contracts.

`tests/upstream-compatibility.test.ts` exercises creation, scan completion, grep, file search, rescan, health, and destruction against a temporary fixture.

## Updating upstream

1. Open or select an issue describing the candidate version, API changes, and rollback owner.
2. Update the declared range and lockfile on a branch; never widen to `*`.
3. Run `npm ci`, `npm run verify:compatibility`, typecheck, all tests/coverage, the fixed-fixture benchmark, audit, and package dry-run.
4. Review root authorization, cursor, result ordering, path formatting, native binary/OS support, and database compatibility explicitly.
5. Record observed behavior and benchmark comparison in the issue or pull request.
6. Roll back by reverting the declaration and lockfile together. Do not reuse or rewrite release tags.

Breaking upstream changes, native binary changes, or changes to root/search semantics are maintainer-owned and require security-boundary review before merge.
