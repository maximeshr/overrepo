---
"overrepo": patch
---

`context` now writes summaries to `context/` instead of `ai/repos/` by default (#4).

Fleets relying on the default get their summaries in `context/` on the next run; the old `ai/repos/` is left as is and `--prune` does not see it. Delete it, or keep the previous location with:

```yaml
summary:
  outDir: ai/repos
```

A project whose path collides with `summary.outDir` (now `context` by default) is rejected, case-insensitively, with a message pointing at `summary.outDir`.
