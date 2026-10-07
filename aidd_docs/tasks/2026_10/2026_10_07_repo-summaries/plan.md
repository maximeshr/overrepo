---
objective: "Each fleet repository has a summary read from its remote default branch, written where the operator points."
status: implemented
---

# Plan: Repository summaries

## Overview

| Field      | Value                                                             |
| ---------- | ----------------------------------------------------------------- |
| **Goal**   | Write an index and one summary per repository from `origin/HEAD`. |
| **Source** | `aidd_docs/tasks/2026_10/2026_10_07_repo-summaries/spec.md`       |

## Phases

| #   | Phase     | File                         |
| --- | --------- | ---------------------------- |
| 1   | Summaries | [`phase-1.md`](./phase-1.md) |

## Decisions

| Decision                                      | Why                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Summaries are always read from `origin/HEAD`. | The shared copy must ignore a dirty checkout. A working-tree mode would bring that noise back. |
| The default directory is `ai/repos`.          | The operator's memory folder is theirs to set; the product default is not that folder.         |
