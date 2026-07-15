# Contributing

## Prerequisites

- Node.js 22 or newer
- npm
- Pi CLI for interactive extension testing

## Shortest path to a verified change

```bash
git clone https://github.com/T50-Systems/pi-fff-plus.git
cd pi-fff-plus
npm ci
npm run verify
npm run test:coverage
npm run benchmark
npm audit --audit-level=high
npm run verify:package
```

Test interactively without installing globally:

```bash
pi --no-extensions -e ./src/index.ts
```

Then run `/fff-health`, followed by a bounded `fffind` or `ffgrep` request.

## Configuration

`PI_FFF_ROOTS` accepts additional roots separated by semicolons or commas. Never add credentials or machine-specific private roots to committed files.

## Pull requests

- Keep query normalization pure and covered by tests.
- Test Windows and POSIX-style path cases when changing root/path handling.
- Preserve global output caps and cursor behavior.
- Update README/docs for user-visible tool or command changes.
- Run `npm audit --audit-level=high` for dependency changes.
- Run `npm run verify:workflows` after any `.github/workflows` or action-pin inventory change; follow [`docs/GITHUB_ACTIONS.md`](docs/GITHUB_ACTIONS.md) for publisher, provenance, permissions, update, and rollback review.
