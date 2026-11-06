## Release notes

### Minor changes

- `overrepo context` now reports, for every repository, the Node.js version declared in `.nvmrc` and `.node-version` (besides `engines` and `devEngines.runtime`), the package manager version from `packageManager` or `devEngines.packageManager`, and the date and short hash of the `origin/HEAD` commit. The same data is exposed by `analyzeProject()` as `runtimeVersions`, `packageManagerVersions` and `lastCommit`, so scripts can build a fleet inventory.

### Pull requests

- #26 ci: adopt the canary release flow (maximeshr)
- #27 chore: align with quality-gate v0.4.0 and pnpm 12.16.1 (maximeshr)
- #28 docs: follow Standard Readme and add CONTRIBUTING.md (maximeshr)
- #29 feat(context): report node version files, package manager versions and last commit (maximeshr)

### Commits

- `be1cac8` test: ignore git hook environment in test repositories (Maxime Sahroui)
- `e2abfb3` feat(context): report node version files, package manager versions and last commit (Maxime Sahroui)
- `a3b9b96` docs: follow Standard Readme and add CONTRIBUTING.md (Maxime Sahroui)
- `aa6ecac` chore: align with quality-gate v0.4.0 and pnpm 12.16.1 (Maxime Sahroui)
- `7a0b81c` ci: adopt the canary release flow (Maxime Sahroui)
- `a470ea0` chore: align with quality-gate v0.3.1 (Maxime Sahroui)
- `729164a` chore: adopt the OKQ quality gate (Maxime Sahroui)
