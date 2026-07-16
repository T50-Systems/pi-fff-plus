# Filesystem Search Threat Model

## Assets and inputs

The extension handles caller-provided patterns, path constraints, exclusions, context/limit values, opaque cursors, configured roots, local filenames, matched lines, index state, and optional frecency/history database paths.

## Trust boundaries

### Configured-root authorization

`RootAuthorization` performs platform-aware lexical containment first and canonical containment for existing paths. It rejects `..` traversal, sibling-prefix confusion, incompatible Windows drives/UNC shares, and symlinks or junctions whose canonical target leaves the authorized root. Authorization completes before `FileFinder.create`, `grep`, or `fileSearch`.

Immediately before `FileFinder.create`, `FinderLifecycle` snapshots the root's canonical path, device, and inode. It snapshots the same identity again immediately after creation. If the post-create snapshot fails or any field differs, the new finder is destroyed, its cache entry is discarded, cursor state is invalidated, and creation fails closed. The snapshot provider is injectable so replacement races are deterministic in tests; supported-platform fixtures also replace a directory with a Linux symlink or Windows junction when the host permits link creation.

This is a **best-effort detection guard, not race elimination**. Residual TOCTOU windows remain: replacement can occur after authorization but before the first identity snapshot; after the post-create snapshot but before or during native traversal; or later while watchers and scans use the tree. Filesystem identity metadata can also have platform/filesystem limitations or be reused. Descendants can change independently of the root object. OS-level isolation and trusted local filesystem permissions remain necessary for hostile multi-user environments.

A strict guarantee requires `@ff-labs/fff-node` to bind authorization and every traversal to the same opened directory handle/object without reopening the path. That capability is not present in the supported API and is tracked upstream in [dmtrKovalenko/fff#682](https://github.com/dmtrKovalenko/fff/issues/682). Until such a capability is designed, implemented, and separately adopted, this extension must not claim strict TOCTOU resistance.

This is **not a filesystem sandbox**. The extension and upstream native library run with the Pi process user's operating-system privileges. A configured root authorizes search within that root. Adding a broad root, enabling filesystem-root scanning, or explicitly adding a symlink target expands the authorized surface.

### Local query and content handling

Patterns, filenames, matched lines, and formatted results remain local. This extension does not intentionally transmit them or add telemetry. Results are returned to Pi tool callers and can therefore become part of the active agent/session context. Do not search secret-bearing roots unless that is intended, and never paste sensitive results into public issues.

Output caps reduce accidental disclosure volume but do not make individual matches non-sensitive.

### Finder and database paths

`@ff-labs/fff-node` owns native indexing and search. `FFF_FRECENCY_DB`, `FFF_HISTORY_DB`, and their flags are passed upstream. Operators must point them only to trusted local locations and protect them as potentially sensitive metadata. `FFF_ENABLE_ROOT_SCAN` materially broadens discovery and is disabled by default.

### Extension process privileges

The extension shares the Pi process, environment, user identity, filesystem access, and extension host. It does not isolate other extensions, shell commands, or compromised dependencies. Dependency compatibility is constrained and tested, Dependabot monitors npm and Actions dependencies, and workflows use explicit read-only repository contents permissions.

## Failure and recovery policy

- Rejected root: inspect `/fff-health`, configure only the smallest canonical root, and retry.
- Symlink/junction escape: search the canonical target only after explicitly authorizing that trusted root.
- Stale or mismatched cursor: restart without `cursor` using the intended parameters.
- Finder/index failure: run `/fff-rescan`; restart Pi if health remains degraded.
- Suspected authorization bypass or sensitive output exposure: stop searching, preserve only minimal redacted evidence, and use the private route in `SECURITY.md`.

## Maintainer review triggers

Maintainer security review is required for root policy changes, canonicalization/link behavior, filesystem-root scanning defaults, database path handling, output-budget relaxation, native dependency range changes, or new network/external side effects.
