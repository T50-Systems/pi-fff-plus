# Examples

## Find a known file type

```text
fffind pattern:"*.ts" path:"src/**" limit:20
```

## Search content with exclusions

```text
ffgrep pattern:"registerTool" path:"src/**" exclude:["node_modules","dist","coverage"] context:2 limit:20
```

## Search another configured repository

Use an absolute path only when it sits inside one of the roots reported by `/fff-health`:

```text
ffgrep pattern:"GoalState" path:"C:/dev/pi/T50-Systems/pi-thread-goal/src/**" limit:10
```

## Diagnose missing results

1. Run `/fff-health` and confirm the selected directory is inside a configured root.
2. Use `/fff-rescan` after large filesystem changes.
3. Start with a bare identifier rather than a long exact phrase.
4. Remove a path constraint temporarily, then narrow the top result.
5. Follow the returned cursor when a search reports more matches.

All examples use explicit limits so search output remains bounded.
