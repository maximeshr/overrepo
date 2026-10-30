# overrepo

## 0.1.0

### Minor Changes

- 2580a4a: Require Node.js 26 or later. Node.js 24 is no longer supported.

### Patch Changes

- 3dcc731: Update dependencies: execa 10.1.1, zod 4.6.7.

## 0.0.4

### Patch Changes

- 1e5d492: `context` now writes summaries to `context/` instead of `ai/repos/` by default (#4).
  
  Fleets relying on the default get their summaries in `context/` on the next run; the old `ai/repos/` is left as is and `--prune` does not see it. Delete it, or keep the previous location with:
  
  ```yaml
  summary:
    outDir: ai/repos
  ```
  
  A project whose path collides with `summary.outDir` (now `context` by default) is rejected, case-insensitively, with a message pointing at `summary.outDir`.
- 50f6fe9: `context` shows a progress bar on stderr while it analyzes repositories, when stderr is a terminal.
