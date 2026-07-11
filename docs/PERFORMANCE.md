# Performance Baseline

Run the deterministic query-normalization benchmark with:

```bash
npm run benchmark
```

The benchmark excludes filesystem indexing/search time and isolates extension-owned path/exclusion normalization. Record Node, Vitest, OS, sample count, mean, and percentile before publishing results.

## Initial local result

Measured 2026-07-11 on Windows with Node 24.18.0 and Vitest 4.1.9:

| Fixture | Mean | p99 | Samples |
|---|---:|---:|---:|
| Relative source constraint | 0.0014 ms | 0.0027 ms | 370,315 |
| Multi-exclusion query | 0.0020 ms | 0.0038 ms | 246,302 |

Both fixtures are comfortably below the 5 ms target. This is a local query-normalization baseline, not a filesystem-search SLO.

The initial target from [`PRODUCT.md`](PRODUCT.md) is p99 below 5 ms. File indexing performance is owned primarily by `@ff-labs/fff-node` and should be measured separately with a fixed fixture before changing extension policy.
