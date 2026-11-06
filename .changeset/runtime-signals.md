---
"overrepo": minor
---

`overrepo context` now reports, for every repository, the Node.js version declared in `.nvmrc` and `.node-version` (besides `engines` and `devEngines.runtime`), the package manager version from `packageManager` or `devEngines.packageManager`, and the date and short hash of the `origin/HEAD` commit. The same data is exposed by `analyzeProject()` as `runtimeVersions`, `packageManagerVersions` and `lastCommit`, so scripts can build a fleet inventory.
