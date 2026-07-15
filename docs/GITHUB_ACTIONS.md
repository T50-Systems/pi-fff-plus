# GitHub Actions supply-chain policy

## Scope

Issue #38 inventories and pins every external `uses:` reference in `.github/workflows/**/*.yml` and `.github/workflows/**/*.yaml`. It does not change the workflow or job/check names. It also does not require an update to upstream `dmtrKovalenko/fff` or the `@ff-labs/fff-node` dependency; those compatibility decisions remain separate from this CI supply-chain change.

Local actions referenced with `./` are repository content and are not external pins. Container and dynamic action references are not currently approved; the offline validator rejects them.

## Reviewed inventory

The machine-readable source of truth is [`.github/actions-pins.json`](../.github/actions-pins.json). Reference counts there cover every occurrence, not only every distinct action.

| Publisher | Official action | Workflow references | Reviewed release | Immutable commit SHA | Release/tag-to-SHA evidence |
|---|---|---|---|---|---|
| GitHub | [`actions/checkout`](https://github.com/actions/checkout) | `ci.yml` (1), `release.yml` (1) | [`v5.0.1`](https://github.com/actions/checkout/releases/tag/v5.0.1) | [`93cb6efe18208431cddfb8368fd83d5badbf9bfd`](https://github.com/actions/checkout/commit/93cb6efe18208431cddfb8368fd83d5badbf9bfd) | `git ls-remote https://github.com/actions/checkout.git refs/tags/v5.0.1` returned the recorded SHA on 2026-07-15. |
| GitHub | [`actions/setup-node`](https://github.com/actions/setup-node) | `ci.yml` (1), `release.yml` (1) | [`v5.0.0`](https://github.com/actions/setup-node/releases/tag/v5.0.0) | [`a0853c24544627f65ddf259abe73b1d18a591444`](https://github.com/actions/setup-node/commit/a0853c24544627f65ddf259abe73b1d18a591444) | `git ls-remote https://github.com/actions/setup-node.git refs/tags/v5.0.0` returned the recorded SHA on 2026-07-15. |

The release tag comment after each `uses:` pin is documentation only; GitHub executes the preceding lowercase 40-character commit SHA.

## Offline enforcement

Run:

```bash
npm run verify:workflows
```

The validator uses only Node.js built-ins and performs no network requests. It recursively scans every workflow YAML file, rejects mutable, uppercase, dynamic, container, unversioned, or malformed external references, requires a trailing full release tag comment, and requires the SHA/tag/reference count to match the reviewed inventory. It also verifies that Dependabot retains a scheduled `github-actions` update entry for the repository root. Negative fixtures prove that both a mutable tag and an undocumented immutable SHA fail closed.

## Review and update policy

Dependabot continues to check the `github-actions` ecosystem weekly. A Dependabot pull request is a prompt for review, not sufficient provenance by itself. The reviewer must:

1. Confirm the publisher and repository are official and expected.
2. Resolve the proposed full release tag from the official repository (for example, `git ls-remote <official-repository>.git refs/tags/<full-tag>`) and require an exact lowercase 40-character result.
3. Review the release notes and the diff from the previously approved release, including bundled runtime changes, credential handling, network behavior, and requested permissions.
4. Update the workflow SHA and trailing tag comment together with `.github/actions-pins.json` and this evidence table.
5. Run `npm run verify:workflows` and the full repository validation before merge. Hosted checks remain required because local validation does not execute the actions.

Major-version upgrades stay in their own dependency change and must not be silently absorbed into unrelated work.

## Permissions

Both workflows declare only:

```yaml
permissions:
  contents: read
```

`actions/checkout` receives the read-only `GITHUB_TOKEN` needed to fetch repository content; `persist-credentials: false` prevents retaining that token in local Git configuration after checkout. `actions/setup-node` configures the selected public Node.js distribution and npm cache and receives no additional repository permission. The release workflow verifies a tag and package but does not publish, create a release, write repository contents, or request OIDC permissions.

Any future action that needs broader GitHub permissions, secrets, artifact writes, package publication, or OIDC must receive a separate security review and explicit least-privilege documentation before its pin can enter the inventory.

## Rollback

If a reviewed action release is faulty or compromised, stop workflow promotion, replace it with the last known-good reviewed release SHA and matching full tag comment, and update the inventory/evidence in the same pull request. Run the offline validator and full local validation, then require hosted checks before merge. Never roll back to a mutable branch or major tag, rewrite a release tag, force-push, or weaken workflow permissions. Reverting this policy requires a normal reviewed pull request.
