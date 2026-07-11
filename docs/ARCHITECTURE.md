# Architecture

## Components

- `src/index.ts` owns Pi registration, configured-root resolution, FFF index lifecycle, tool schemas, pagination cursors, commands, and output formatting.
- `src/query.ts` owns pure normalization of path constraints, exclusions, and FFF query strings.
- `@ff-labs/fff-node` owns filesystem indexing and fuzzy/content search execution.

## Control flow

1. The extension registers commands, tools, and optional UI completion behavior.
2. A tool request resolves its selected root and validates that the path stays inside configured roots.
3. `buildQuery` normalizes includes/excludes without touching the filesystem.
4. A root-specific `FileFinder` executes the query.
5. Formatters normalize slashes, enforce global display caps, and preserve a pagination cursor when more results exist.

## Boundaries

- Root authorization must happen before creating or querying a finder.
- `query.ts` must remain pure and platform-testable.
- Raw file content and search queries remain local.
- Output must stay bounded; do not expose an unbounded result mode.
- Paths outside the active cwd are absolute so Pi `read` can consume them.

## Extension points

- Add roots through `PI_FFF_ROOTS`, not hard-coded project-specific paths.
- Add tool modes through the `FffMode`/`ToolNames` mapping.
- Add query syntax in `query.ts` with focused cross-platform tests.
- Add diagnostics to `/fff-health` without dumping filenames or file contents.
