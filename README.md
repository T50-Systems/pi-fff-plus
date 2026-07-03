# @t50-systems/pi-fff-plus

T50-friendly Pi extension for FFF-powered file and content search.

This package started from `@ff-labs/pi-fff` and keeps the same core tools while making them safer for our Pi workflows on Windows and multi-repo setups.

## Tools

- `fffind` — fuzzy path search
- `ffgrep` — content search
- `fff-multi-grep` — intentionally not enabled by default, same as upstream

## T50 changes vs upstream

- Accepts absolute `path` values when they are inside a configured root.
- Default roots include:
  - current Pi cwd
  - `C:/dev/pi`
  - `~/.pi/agent`
  - `~/.agents`
- Additional roots can be configured with:

```bash
PI_FFF_ROOTS="D:/code;C:/other/root"
```

- Output paths are normalized to `/`.
- Results outside the active cwd are emitted as absolute paths so `read` can consume them directly.
- `ffgrep.limit` is treated as a true global display cap, not a per-file display cap.
- Error messages explain configured roots and how to add more.

## Install in Pi settings

Use the local path from this repo, for example:

```json
{
  "packages": [
    "..\\..\\..\\..\\dev\\pi\\T50-Systems\\pi-fff-plus"
  ]
}
```

Remove or disable `npm:@ff-labs/pi-fff` to avoid duplicate `fffind`/`ffgrep` tool registrations.

## Commands

- `/fff-health` — show mode, active cwd, configured roots, and initialized index sizes
- `/fff-rescan` — rescan initialized roots
- `/fff-mode <tools-and-ui|tools-only|override>` — same mode concept as upstream

## Development

```bash
npm install
npm run typecheck
```
