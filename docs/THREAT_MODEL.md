# Filesystem Search Threat Model

## Assets and inputs

The extension handles caller-provided patterns, path constraints, exclusions, context/limit values, opaque cursors, configured roots, local filenames, matched lines, index state, and optional frecency/history database paths.

## Trust boundaries

### Configured-root authorization

`RootAuthorization` performs platform-aware lexical containment first and canonical containment for existing paths. It rejects `..` traversal, sibling-prefix confusion, incompatible Windows drives/UNC shares, and symlinks or junctions whose canonical target leaves the authorized root. Authorization completes before `FileFinder.create`, `grep`, or `fileSearch`.

This is **not a filesystem sandbox**. The extension and upstream native library run with the Pi process user's operating-system privileges. A configured root authorizes search within that root. Adding a broad root, enabling filesystem-root scanning, or explicitly adding a symlink target expands the authorized surface.

Filesystem state can change after authorization (for example, a concurrent link replacement). OS-level isolation and trusted local filesystem permissions remain necessary for hostile multi-user environments.

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
