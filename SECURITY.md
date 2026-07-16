# Security Policy

## Supported versions

Security fixes target the default branch and the latest `0.1.x` release. Older commits or releases may be fixed at maintainer discretion based on severity and exploitability.

## Private reporting

Do not open a public issue containing searched file contents, query results, filesystem paths that reveal private projects, credentials, tokens, database contents, personal information, exploit details, or a proof of concept.

Report privately through [this repository's GitHub private vulnerability report](https://github.com/T50-Systems/pi-fff-plus/security/advisories/new). If that repository route is unavailable, use [T50 Systems' organization-default private report](https://github.com/T50-Systems/.github/security/advisories/new), name `T50-Systems/pi-fff-plus`, and do not create a public placeholder.

Include the affected version/commit, platform, root configuration, impact, minimal reproduction, and mitigation when safe to share privately. Redact unrelated filenames and all file content not required to demonstrate the issue.

Coordination targets follow the organization policy: acknowledgement within 3 business days, initial severity/scope triage within 7 business days, weekly critical/high updates, and monthly medium/low updates while actively tracked.

## Security boundaries

See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). In summary:

- Configured roots are an application authorization policy, not an operating-system filesystem sandbox.
- Lexical and canonical checks deny traversal and symlink/junction escapes before finder creation or search; pre/post root identity snapshots add best-effort replacement detection but do not eliminate TOCTOU races.
- The extension runs with the Pi process user's filesystem permissions; it cannot protect data from other extensions or code in that process.
- Queries and matched content stay local to the configured `@ff-labs/fff-node` process boundary and are not intentionally logged or sent to a network service.
- Optional frecency/history database paths and broad roots expand the local data surface and must be treated as sensitive configuration.

Dependency alerts and update pull requests are reviewed weekly. Security-boundary and upstream-breaking changes are maintainer-owned and follow [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).
