# Product Vision and Success Metrics

## Vision

Provide the safest and fastest Pi-native search interface for Windows and multi-root development workspaces.

## Product promise

Agents can locate paths and search content with bounded output, predictable constraints, and paths that Pi tools can consume directly.

## Success metrics

| ID | Outcome | Target | Evidence |
|---|---|---|---|
| SAFE-1 | Search never escapes configured roots | 100% boundary-test pass | query/root tests |
| UX-1 | Errors explain the configured roots and recovery action | 100% classified root errors actionable | integration/manual checks |
| PERF-1 | Query normalization overhead | p99 < 5 ms on reference fixture | `npm run benchmark` |
| REL-1 | Global result limits remain bounded | 100% cap regression pass | search formatting tests |

Metrics describe targets, not production telemetry. No search query or file content is sent to an external service by this extension.
