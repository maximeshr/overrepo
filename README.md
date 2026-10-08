# overrepo

Manage a fleet of git repositories from one manifest.

Describe your repositories once in `overrepo.yaml`, then clone, update, inspect and script them together: by tag, by path, or all at once.

```sh
npm install -g overrepo

overrepo init                          # write a manifest from the repositories already on disk
overrepo sync                          # clone everything that is missing
overrepo status --dirty                # show repositories with local changes
overrepo exec --tags backend -- git pull   # run a command in a subset
```

Requires Node.js 24 or later, and `git` in `PATH`.

## Contents

- [Layout](#layout)
- [Manifest](#manifest)
- [Commands](#commands)
- [Selecting projects](#selecting-projects)
- [Repository summaries](#repository-summaries)
- [Importing a catalogue](#importing-a-catalogue)
- [Robustness](#robustness)
- [Programmatic API](#programmatic-api)
- [Development](#development)

## Layout

`overrepo.yaml` is a plain file: put it wherever suits you. By default the clones are laid out next to it, and neither the manifest's directory nor the fleet root needs to be a git repository.

```text
acme/
├── overrepo.yaml
├── apps/web/            ← clone
├── services/api/        ← clone
└── infra/terraform/     ← clone
```

`root` decouples the two. Keep the manifest in a separate directory (a dotfiles repo, a shared config repo, or just a folder) and point `root` at the fleet:

```text
acme/
├── config/
│   └── overrepo.yaml    ← root: ..
├── apps/web/
└── services/api/
```

## Manifest

```yaml
# overrepo.yaml
projects:
  apps/web:
    url: git@github.com:acme/web.git
    tags: [frontend, app]
    desc: Customer-facing web app
  services/api:
    url: git@github.com:acme/api.git
    tags: [backend, app]
  infra/terraform:
    url: git@github.com:acme/terraform.git
    tags: [ops]
```

| Key              | Meaning                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| `root`           | Fleet root, relative to the manifest file. Omitted, it is the manifest's directory.     |
| `projects`       | Map of path → project. The key is the clone path, relative to `root`.                   |
| `url`            | Remote to clone. Required.                                                              |
| `tags`           | Labels used by `--tags`. No whitespace or commas.                                       |
| `desc`           | Free-text description, shown in summaries.                                              |
| `summary.outDir` | Where `context` writes summaries, relative to the manifest file. Defaults to `context`. |

A project path may not be absolute and may not climb above `root` (`../outside` is rejected).

`overrepo.yaml` is searched from the current directory upward. When it is not in a parent directory, point at it with `-c`:

```sh
overrepo -c config/overrepo.yaml sync
```

## Commands

| Command           | What it does                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`            | Scans git repositories below the current directory (follows directory symlinks, skips the directory you are in) and writes `overrepo.yaml`. Repositories without an `origin` are skipped. `--depth`, `--force`, `--dry-run`. |
| `sync`            | Clones missing projects in parallel. `--pull` fetches and fast-forwards existing clones. `--dry-run`, `-j`, `--timeout`, `--retries`, `-q`, `--json`.                                                                        |
| `list` (`ls`)     | Lists projects (`●` cloned, `○` not cloned). `--json`, `--names`.                                                                                                                                                            |
| `status` (`st`)   | Branch, ahead/behind, local changes. `--dirty`, `--json`.                                                                                                                                                                    |
| `context`         | Writes one summary per repository and an index. `--check` fails when a file is outdated and writes nothing. `--prune` deletes summaries of removed projects.                                                                 |
| `exec <command…>` | Runs a command in each selected project. Requires a selection.                                                                                                                                                               |
| `import`          | Merges projects from JSON (stdin or `--file`) into the manifest. `--sync` clones only the projects just added. `--overwrite`, `--prune`, `--dry-run`, `--json`.                                                              |
| `doctor`          | Checks git, remote access, the manifest, missing clones, orphan repositories and interrupted clones. `--no-network`, `--json`.                                                                                               |

Global options: `-C <dir>`, `-c <file>`, `-v`, `-h`.

`sync` clones the remote default branch. It never writes a `.gitignore`: the fleet root is not necessarily a git.

### Exit codes

| Code  | Meaning                      |
| ----- | ---------------------------- |
| `0`   | success                      |
| `1`   | at least one project failed  |
| `2`   | usage or configuration error |
| `130` | interrupted (Ctrl+C)         |

## Selecting projects

`exec`, `status`, `list`, `sync` and `context` accept:

| Flag                   | Meaning                             |
| ---------------------- | ----------------------------------- |
| `-a, --all`            | every project                       |
| `-t, --tags a,b`       | projects having **all** these tags  |
| `--paths services/`    | projects under these path prefixes  |
| `-p, --projects p1,p2` | projects by path (the manifest key) |

Criteria combine with AND. Without a selector, `exec` refuses to run (exit code 2); the other commands use every project.

```sh
overrepo exec --tags backend -- git status -s
overrepo exec --all --parallel 'git fetch && git log -1 --oneline'
overrepo sync -p apps/web,services/api
```

- After `--`, arguments run directly (no shell); a **single quoted argument** goes through the shell.
- Sequential by default; `--parallel` uses 8 workers, `-j <n>` sets the count.
- Commands receive `OVERREPO_ROOT`, `OVERREPO_PROJECT` and `OVERREPO_PROJECT_PATH` (the last two are the project path).
- Projects that are not cloned are skipped.

## Repository summaries

`context` writes one Markdown summary per repository plus an `index.md`, under `summary.outDir` next to the manifest. Point `summary.outDir` wherever you want them versioned, for example to give AI assistants an overview of the whole fleet.

```yaml
summary:
  outDir: docs/repos
```

Summaries are read from each clone's `origin/HEAD`, so a dirty checkout does not change them. In CI, `overrepo context --check` fails when a summary is out of date.

## Importing a catalogue

`import` fills the manifest from a JSON list of repositories, read from stdin or `--file`. It is meant for large fleets: rather than writing every entry by hand, generate the list from wherever your repositories are already listed (GitHub, GitLab, an internal catalogue). overrepo does not talk to any hosting provider itself.

The expected input:

```json
{
  "projects": [
    {
      "name": "apps/web",
      "url": "git@github.com:acme/web.git",
      "tags": ["frontend", "app"],
      "desc": "Customer-facing web app"
    }
  ]
}
```

`name` is the path (the manifest key). A different `path` field is rejected. Unknown fields are ignored.

For example, to import every repository of a GitHub organization with the [GitHub CLI](https://cli.github.com) and [jq](https://jqlang.org), using repository topics as tags:

```sh
gh repo list acme --limit 1000 --json name,sshUrl,description,repositoryTopics \
  | jq '{projects: map({
      name: .name,
      url: .sshUrl,
      desc: .description,
      tags: ((.repositoryTopics // []) | map(.name))
    })}' \
  | overrepo import --sync
```

`--sync` also clones the projects just added; `--dry-run` shows what would change without writing.

`projects` is written as a block map; tag lists stay flow-style (`[frontend, app]`). Existing values are kept unless you pass `--overwrite`. Projects missing from the input are kept unless you pass `--prune`, so you can re-run the same command to pick up new repositories.

## Robustness

- One repository failing never stops the others.
- git never prompts: `GIT_TERMINAL_PROMPT=0`, and SSH runs in batch mode unless you configured `GIT_SSH_COMMAND` or `core.sshCommand`.
- Per-operation timeout and retries with exponential backoff on transient network errors.
- Clones land in `.<name>.overrepo-partial` and move into place only when complete.

## Programmatic API

```ts
import { loadManifest, selectProjects, sync } from "overrepo";

const manifest = await loadManifest({
  cwd: "/path/to/acme",
});
const backend = selectProjects(manifest.projects, { tags: ["backend"] });
await sync(manifest, { projects: backend });
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
