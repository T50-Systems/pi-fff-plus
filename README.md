# @t50-systems/pi-fff-plus

Safer FFF-powered file and content search tools for Pi across Windows, multi-repo workspaces, and global agent configuration.

This package started from `@ff-labs/pi-fff` and keeps the familiar `fffind` / `ffgrep` workflow while adding T50-specific root handling, path normalization, bounded output behavior, and clearer diagnostics for coding-agent use.

## Tools

- `fffind` — fuzzy file/path search.
- `ffgrep` — content search with a true global match cap.
- `fff-multi-grep` — kept intentionally disabled by default, matching upstream behavior.

## What the plus layer changes

- Accepts absolute `path` values when they are inside a configured safe root.
- Default roots include:
  - current Pi working directory
  - `C:/dev/pi`
  - `~/.pi/agent`
  - `~/.agents`
- Supports extra roots through `PI_FFF_ROOTS`.
- Normalizes output paths to `/`.
- Emits absolute paths for results outside the active cwd so Pi `read` can consume them directly.
- Treats `ffgrep.limit` as a global display cap rather than a per-file cap.
- Returns error messages that show configured roots and how to add more.

## Repository layout

```text
src/index.ts   Pi extension/tool registration, root setup, commands
src/query.ts   shared query/path helpers
tsconfig.json  TypeScript config
```

## Install in Pi

Install the GitHub package or use a local checkout:

```bash
pi install git:github.com/T50-Systems/pi-fff-plus
```

When installing from a local checkout through Pi settings, add the repository path and remove/disable `npm:@ff-labs/pi-fff` to avoid duplicate `fffind`/`ffgrep` registrations:

```json
{
  "packages": [
    "C:/dev/pi/T50-Systems/pi-fff-plus"
  ]
}
```

## Configure additional roots

Use semicolon-separated or platform path-list style values:

```bash
PI_FFF_ROOTS="D:/code;C:/other/root"
```

Only paths inside configured roots are accepted when an absolute `path`
