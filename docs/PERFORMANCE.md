# Performance Baselines

Run both deterministic benchmarks from a clean checkout:

```bash
npm ci
npm run benchmark
```

Run either layer alone with `npm run benchmark:query` or `npm run benchmark:index`.

## Query normalization

`benchmarks/query.bench.ts` isolates extension-owned path/exclusion normalization. The PERF-1 product target remains p99 below 5 ms. Vitest reports sample count, mean, and latency percentiles with runtime metadata.

## Fixed indexing/search fixture

`benchmarks/fixed-fixture.mjs` creates and removes a deterministic temporary tree:

- 80 TypeScript, 40 Markdown, 20 JSON, and 20 ignored-path files;
- deterministic 512 B, 4 KiB, and 32 KiB content sizes;
- fixture seed/manifest version `pi-fff-plus-fixed-v1`;
- five cold-index samples;
- forty samples each for warm exact grep, exact-miss-plus-fuzzy fallback, and file search;
- 1,000 authorization and 200 formatting samples.

The JSON report records timestamp, Node version, OS/release/architecture, exact `@ff-labs/fff-node` version, fixture manifest, p50/p95/p99/max latency, sample count, and highest observed process resident-set size for each phase. The script compiles the extension into a disposable `.benchmark-dist`, so authorization and formatting measurements execute production functions rather than copies.

`upstream` results cover FileFinder creation/indexing and searches. `extensionOwned` results cover configured-root authorization and formatting. Peak RSS is a process-level upper observation, not isolated allocation attribution.

## Initial fixed-fixture result

Measured 2026-07-11 on Windows 10.0.26200 x64, Node 24.18.0, and `@ff-labs/fff-node` 0.9.6:

| Layer | Operation | Samples | p50 | p95 | p99 | Peak RSS |
|---|---|---:|---:|---:|---:|---:|
| Upstream | Cold index | 5 | 62.27 ms | 64.18 ms | 64.18 ms | 75.4 MiB |
| Upstream | Warm exact grep | 40 | 2.96 ms | 5.45 ms | 5.62 ms | 84.2 MiB |
| Upstream | Fuzzy fallback | 40 | 11.70 ms | 15.64 ms | 16.48 ms | 101.0 MiB |
| Upstream | File search | 40 | 3.71 ms | 6.80 ms | 7.59 ms | 105.0 MiB |
| Extension | Authorization | 1,000 | 0.276 ms | 0.358 ms | 0.448 ms | 108.5 MiB |
| Extension | Formatting | 200 | 0.118 ms | 0.194 ms | 0.485 ms | 107.8 MiB |

## Budget policy

All fixed-fixture budgets are **informational**. CI does not enforce indexing/search latency or memory thresholds yet. Maintainers should compare repeated Ubuntu, Windows, and macOS hosted-runner samples before approving a broad regression floor. Functional output/context/match caps remain enforced separately by tests and are not performance SLOs.
