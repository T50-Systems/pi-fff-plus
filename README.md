# @t50-systems/pi-fff-plus

T50-friendly Pi extension for safer FFF-powered file and content search on Windows and multi-root workspaces.

## Product vision

Give Pi agents fast local search with explicit roots, bounded output, predictable path constraints, and paths that downstream Pi tools can consume directly. See [`docs/PRODUCT.md`](docs/PRODUCT.md) for measurable targets.

## Tools

- `fffind` — fuzzy path search.
- `ffgrep` — bounded content search with context and pagination.
- `fff-multi-grep` — intentionally disabled by default, matching upstream.

## Quickstart

### 1. Install

```bash
pi install git:github.com/T50-Systems/pi-fff-plus
```

Remove or disable `npm:@ff-labs/pi-fff` to avoid duplicate `fffind`/`ffgrep` registrations, then restart Pi or run `/reload`.

### 2. Check roots and index health

```text
/fff-health
```

Default roots include the current Pi cwd, `C:/dev/pi`, `~/.pi/agent`, `~/.agents`, and the Windows global npm root when available.

### 3. Find a path

```text
fffind pattern:"*.ts" path:"src/**" limit:20
```

### 4. Search content

```text
ffgrep pattern:"registerTool" path:"src/**" exclude:["node_modules","dist"] context:2 limit:20
```

Results outside the active cwd are absolute and use `/`, so Pi `read` can consume them directly.

## Configuration

Additional roots can be configured for the Pi process:

```bash
PI_FFF_ROOTS="D:/code;C:/other/root" pi
```

Comma-separated values are also accepted. Roots are normalized, deduplicated, and authorization is applied before search. Do not add broad sensitive directories unless agents should be able to search them.

## T50 changes vs upstream

- Accepts absolute `path` values only when they are inside a configured root.
- Supports multiple configured roots across Windows and POSIX environments.
- Normalizes output paths to `/`.
- Emits absolute paths for results outside the active cwd.
- Treats `ffgrep.limit` as a global display cap, not a per-file cap.
- Provides pagination cursors instead of unbounded output.
- Explains configured roots and recovery steps in errors and `/fff-health`.

## Commands

- `/fff-health` — show mode, active cwd, configured roots, and initialized index sizes.
- `/fff-rescan` — rescan initialized roots after large filesystem changes.
- `/fff-mode <tools-and-ui|tools-only|override>` — select tool registration behavior.

## Troubleshooting

### `fffind` or `ffgrep` is missing

Run `pi list`, remove duplicate upstream registrations, and restart Pi or run `/reload` after installation.

### An absolute path is rejected

Run `/fff-health`. The selected path must be inside a configured root. Add the smallest necessary root through `PI_FFF_ROOTS` and restart Pi.

### Recent files are missing

Run `/fff-rescan`, then retry with a bare identifier and a broader path constraint.

### Output is truncated

This is intentional. Follow the returned cursor or narrow the path/pattern; do not increase limits until the query is specific.

## Development

```bash
npm install
npm run typecheck
npm test
npm run test:coverage
npm run benchmark
```

Load the checkout directly:

```bash
pi --no-extensions -e ./src/index.ts
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, boundaries, flow, and extension points.
- [`docs/EXAMPLES.md`](docs/EXAMPLES.md) — practical search and recovery recipes.
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — reproducible local performance baseline.
- [`docs/PRODUCT.md`](docs/PRODUCT.md) — vision, promise, and success metrics.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contributor setup and validation rules.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## Release workflow

Update `package.json` and `CHANGELOG.md`, merge validated changes, then create a matching `vX.Y.Z` tag. The release workflow verifies typechecking, tests, dependency audit, and tag/version consistency. GitHub Releases are the distribution baseline; publishing to npm requires a separate explicit decision.

## License

MIT
