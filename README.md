# overrepo

Manage a fleet of git repositories from one manifest.

```sh
overrepo -c workspace/overrepo.yaml sync --tags collect
overrepo -c workspace/overrepo.yaml exec --tags collect -- git status -s
```

Requires Node.js 24 or later, and `git` in `PATH`.

## Layout

The manifest lives in a git. The clones sit next to that git. The directory you open does not have to be a repository.

```text
qualifio-workspace/                 ← not a git
├── workspace/                      ← the git that versions the manifest
│   └── overrepo.yaml               ← root: ..
├── qualifio/collect/collect/       ← clone
└── ops/flux/applications/
```

```yaml
# workspace/overrepo.yaml
root: ..
projects:
  qualifio/collect/collect:
    url: git@gitlab.example:qualifioapp/collect/collect.git
    tags: [collect, product, app]
    desc: Collect
  ops/flux/applications:
    url: git@gitlab.example:qualifioapp/flux/applications.git
    tags: [ops, flux]
```

The project key is the path, relative to `root`. `root` is relative to the manifest file; omit it to use the manifest's directory. A path may not be absolute and may not climb above `root` (`../outside` is rejected). `overrepo.yaml` is searched from the current directory upward; `-c <file>` points at it.

`sync` clones the remote default branch. It does not write a `.gitignore`: the fleet root is not necessarily a git.

`context` writes summaries next to the manifest (`ai/repos/` when `summary.outDir` is omitted). Point `summary.outDir` wherever you want them versioned. They are read from `origin/HEAD`, so a dirty checkout does not change them.

## Commands

| Command           | What it does                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`            | Scans git repositories below the current directory (follows directory symlinks, skips the directory you are in) and writes `overrepo.yaml`. Repositories without an `origin` are skipped. `--depth`, `--force`, `--dry-run`. |
| `sync`            | Clones missing projects in parallel. `--pull` fetches and fast-forwards existing clones. `--dry-run`, `-j`, `--timeout`, `--retries`, `-q`, `--json`.                                                                        |
| `list` (`ls`)     | Lists projects (`●` cloned, `○` not cloned). `--json`, `--names`.                                                                                                                                                            |
| `status` (`st`)   | Branch, ahead/behind, local changes. `--dirty`, `--json`.                                                                                                                                                                    |
| `context`         | Writes one summary per repository and an index, read from each clone's `origin/HEAD`. `--check` fails when a file is outdated and writes nothing. `--prune` deletes summaries of removed projects.                           |
| `exec <command…>` | Runs a command in each selected project. Requires a selection.                                                                                                                                                               |
| `import`          | Merges projects from JSON (stdin or `--file`) into a block-style `projects` map. `--sync` clones only the projects just added. `--overwrite`, `--prune`, `--dry-run`, `--json`.                                              |
| `doctor`          | Checks git, remote access, the manifest, missing clones, orphan repositories and interrupted clones. The fleet root does not have to be a git. `--no-network`, `--json`.                                                     |

Global options: `-C <dir>`, `-c <file>`, `-v`, `-h`.

### Selecting projects

`exec`, `status`, `list`, `sync` and `context` accept:

| Flag                   | Meaning                             |
| ---------------------- | ----------------------------------- |
| `-a, --all`            | every project                       |
| `-t, --tags a,b`       | projects having **all** these tags  |
| `--paths services/`    | projects under these path prefixes  |
| `-p, --projects p1,p2` | projects by path (the manifest key) |

Criteria combine with AND. Without a selector, `exec` refuses to run (exit code 2). The other commands use every project.

```sh
overrepo exec --tags collect -- git status -s
overrepo sync -p qualifio/collect/collect,qualifio/libraries/foo
```

- After `--`, arguments run directly (no shell); a **single quoted argument** goes through the shell.
- Sequential by default; `--parallel` uses 8 workers, `-j <n>` sets the count.
- Commands receive `OVERREPO_ROOT`, `OVERREPO_PROJECT` and `OVERREPO_PROJECT_PATH` (the last two are the project path).
- Projects that are not cloned are skipped.

### Exit codes

| Code  | Meaning                      |
| ----- | ---------------------------- |
| `0`   | success                      |
| `1`   | at least one project failed  |
| `2`   | usage or configuration error |
| `130` | interrupted (Ctrl+C)         |

## Importing a catalogue

A script you own (GitLab membership, for example) writes the manifest. overrepo does not talk to GitLab.

```json
{
  "projects": [
    {
      "name": "qualifio/collect/collect",
      "url": "git@gitlab.example:qualifioapp/collect/collect.git",
      "tags": ["collect", "product", "app"],
      "desc": "Collect"
    }
  ]
}
```

`name` is the path. A different `path` field is rejected. Unknown fields are ignored.

```sh
./discover-repos.sh | overrepo -c workspace/overrepo.yaml import
./discover-repos.sh | overrepo -c workspace/overrepo.yaml import --sync
overrepo -c workspace/overrepo.yaml sync -p qualifio/collect/collect
```

`projects` is written as a block map. Tag lists stay flow-style (`[collect, product, app]`). Existing values are kept unless you pass `--overwrite`. Projects are kept unless you pass `--prune`.

## Robustness

- One repository failing never stops the others.
- git never prompts: `GIT_TERMINAL_PROMPT=0`, and SSH runs in batch mode unless you configured `GIT_SSH_COMMAND` or `core.sshCommand`.
- Per-operation timeout and retries with exponential backoff on transient network errors.
- Clones land in `.<name>.overrepo-partial` and move into place only when complete.

## Programmatic API

```ts
import { loadManifest, selectProjects, sync } from "overrepo";

const manifest = await loadManifest({
  cwd: "/path/to/qualifio-workspace",
  file: "workspace/overrepo.yaml",
});
const collect = selectProjects(manifest.projects, { tags: ["collect"] });
await sync(manifest, { projects: collect });
```

## Development

The toolchain is [Vite+](https://viteplus.dev) (`vp`). Dependencies are managed with [pnpm](https://pnpm.io).

```sh
vp install
vp check
vp test
vp pack
```

Releases use [changesets](https://github.com/changesets/changesets).

## License

MIT
