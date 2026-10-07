# Scan any repository name

## Target

A git repository found below the directory being scanned is included in the catalogue whatever its directory is named.

## Hard constraints

- The directory where the scan starts is not itself listed as a repository.
- A directory symlink that points at a git repository is followed and listed at the symlink's path.
- No directory is excluded because its name matches a tool, a product, or a worktree prefix.
- A repository without an `origin` remote is still not added to the catalogue.

## Non-goals

- Ignoring directories that belong to an agent or an editor.
- Changing how clones are created or updated.
- Walking above the directory where the scan starts.

## Done-when

- A repository whose name begins with `t3-` and that has an `origin` appears in the catalogue produced by a scan.
- The directory where the scan starts does not appear in that catalogue.
- A symlink to a repository appears in that catalogue under the symlink's path.

## Context (optional)

A scan used to skip every directory whose name started with `t3-`, because one client's agent worktrees use that prefix. That rule hides real repositories and names one tool inside the product.
