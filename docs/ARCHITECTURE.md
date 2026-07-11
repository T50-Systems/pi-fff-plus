# Architecture

## Components

- `src/index.ts` is the thin Pi boundary: flags, event/tool/command registration, UI rendering, and autocomplete composition.
- `src/root-authorization.ts` owns root discovery, normalization, lexical containment, canonical-path containment, and rooted-query resolution.
- `src/finder-lifecycle.ts` owns finder creation, scan waiting, caching, rescan, health access, and destruction behind an injectable factory.
- `src/tools.ts` owns schemas, execution budgets, search handlers, path formatting, and notices.
- `src/cursors.ts` owns bounded cursor storage and immutable query/root-generation bindings.
- `src/query.ts` owns pure normalization of path constraints, exclusions, and FFF query strings.
- `@ff-labs/fff-node` owns filesystem indexing and fuzzy/content search execution.

## Control flow

1. The extension registers commands, tools, and optional UI completion behavior.
2. `RootAuthorization` resolves the selected path and validates both lexical and canonical containment.
3. Only after authorization succeeds, `FinderLifecycle` creates or retrieves the root-specific finder.
4. `buildQuery` normalizes includes/excludes without touching the filesystem.
5. `executeGrep` or `executeFind` invokes the finder, formats bounded output, and stores a bound continuation cursor when available.

## Boundaries

- Root authorization must finish before creating or querying a finder.
- Lexical `..`, sibling-prefix, drive/UNC, and mixed-separator escapes are rejected with platform-aware path operations.
- Existing paths are resolved canonically. A symlink or Windows junction that resolves outside its configured root is denied; callers must explicitly authorize the canonical target as a separate root.
- This configured-root policy limits the extension's search surface but is not an operating-system filesystem sandbox.
- Extracted authorization, lifecycle, cursor, and tool modules have no Pi UI dependency.
- Raw file content and search queries remain local.
- Caller match/context budgets and formatted byte/line output are bounded; no unbounded result mode exists.
- Paths outside the active cwd are absolute so Pi `read` can consume them.

## Extension points

- Add roots through `PI_FFF_ROOTS`, not hard-coded project-specific paths.
- Add tool modes through the `FffMode`/tool-name mapping in the entrypoint.
- Add query syntax in `query.ts` with focused cross-platform tests.
- Inject a finder factory for deterministic lifecycle/tool tests instead of using a live index.
- Add diagnostics to `/fff-health` without dumping filenames or file contents.
