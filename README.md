# overrepo

Manage a fleet of git repositories from one declarative manifest, and make the meta-repo that holds them **readable by AI agents**.

- **Fleet management**: clone, pull, inspect and run commands across hundreds of repositories, in parallel, without one failing repo blocking the others.
- **AI-aware context**: generates a versioned index and one context card per repository, so an agent started at the root of the meta-repo knows which repo does what, and you can tag `@billing-api.md` to give it context.

## Why overrepo

overrepo started on a client project: about 195 repositories spread across a dozen folders, and a team that wanted one shared view of all of them.

The first version of that view was built with [mani](https://manicli.com), and it is a great tool: one YAML file, tags, parallel commands. It became the blueprint for overrepo. But mani ships as a Go binary, and this team lived 100% in Node. Every laptop and every CI runner needed a second CLI next to `npm` just to get the workspace, and "install Node, then install this other tool, then run the script" turned onboarding into a checklist.

Then AI agents joined the team. Started at the root of the meta-repo, they could not see the git-ignored repositories, and had no idea which one did what.

So I rebuilt the idea where the team already was: an npm package you run with `npx`, with nothing else to install, and taught it to write the map the agents were missing.

## Quick start

```sh
npx overrepo init      # scan existing clones and write overrepo.yaml
npx overrepo sync      # clone what is missing, maintain .gitignore
npx overrepo context   # write ai/repos/index.md and one card per repo
```

A new teammate only needs `git clone <meta-repo> && npx overrepo sync`.

Requires Node.js 24 or later, and `git` in `PATH`.

## The meta-repo layout

```text
meta-repo/                  ← versioned: overrepo.yaml, ai/repos/, your shared rules…
├── overrepo.yaml
├── .gitignore              ← contains a managed block listing every project
├── ai/repos/
│   ├── index.md            ← global map, read first by agents
│   └── backend/
│       └── billing-api.md  ← card of backend/billing-api
└── backend/
    └── billing-api/        ← real clone, git-ignored by the meta-repo
```

Projects are ignored by the meta-repo, but `ai/repos/` **must stay versioned**: it is what agents and the `@` file picker can see. `overrepo doctor` warns if it is ignored.

## Manifest

`overrepo.yaml` at the root of the meta-repo (searched in the current directory and its parents; `-c <file>` to point elsewhere). Paths are relative to the manifest and may not leave its directory.

```yaml
version: 1

defaults:
  clone:
    depth: null # null = full history
    filter: blob:none # partial clone (default); null to disable
    branch: null # null = remote default branch
  concurrency: 8 # parallel operations
  timeout: 600 # seconds per git operation
  retries: 2 # retries on transient network errors

context:
  outDir: ai/repos # where cards are written
  index: ai/repos/index.md
  include: [README.md, AGENTS.md, CLAUDE.md, package.json, composer.json, go.mod, Dockerfile]
  maxBytes: 16000 # upper bound of the generated part of a card
  readmeMaxChars: 3000 # README excerpt length
  treeMaxEntries: 40 # top-level entries listed

gitignore:
  sync: true # maintain a managed block in .gitignore

projects:
  billing-api:
    path: backend/billing-api # defaults to the project name
    url: git@github.com:client/billing-api.git
    desc: Billing API (AdonisJS + PostgreSQL)
    tags: [backend, billing, node]
    owners: [team-payments]
    links:
      docs: https://docs.example.com/billing
    sync: true # false = listed (and documented) but never cloned
    clone:
      branch: develop # overrides defaults.clone

tasks:
  pull:
    desc: Fast-forward the current branch
    cmd: git pull --ff-only
  lint: npm run lint --if-present # short form
```

Validation is strict: unknown keys, wrong types, paths escaping the root, duplicate paths and duplicate names are rejected with the file, line, YAML path and cause:

```text
error Invalid manifest:
  - overrepo.yaml:9:11 projects.billing-api.path: path "../billing" escapes the manifest root
```

Commands that write the manifest (`import`) preserve comments and formatting.

## Commands

| Command           | What it does                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`            | Scans for git repositories below the current directory and writes `overrepo.yaml` (url from `origin`, tag from the parent folder, description from `package.json`/`composer.json`). `--depth`, `--force`, `--dry-run`. |
| `sync`            | Clones missing projects in parallel and updates the `.gitignore` block. `--pull` also fetches and fast-forwards existing clones. `--dry-run`, `-j`, `--timeout`, `--retries`, `-q`, `--json`.                          |
| `list` (`ls`)     | Lists projects (`●` cloned, `○` not cloned). `--json`, `--names`.                                                                                                                                                      |
| `status` (`st`)   | Branch, ahead/behind, local changes. `--dirty` to only show what needs attention, `--json`.                                                                                                                            |
| `exec <command…>` | Runs a command in each selected project. Requires a selection.                                                                                                                                                         |
| `run [task]`      | Runs a manifest task in each selected project; without a task, lists tasks. Requires a selection.                                                                                                                      |
| `context`         | Generates `index.md` and the cards. `--check` fails if anything is outdated (CI), `--prune` deletes cards of removed projects, `--json`.                                                                               |
| `import`          | Merges projects from JSON (stdin or `--file`). Adds new projects, fills missing fields, reports projects absent from the input. `--overwrite`, `--prune`, `--dry-run`, `--json`.                                       |
| `doctor`          | Checks git, remote access (one `git ls-remote` per host), the manifest, missing clones, orphan repositories, interrupted clones, the `.gitignore` block. `--no-network`, `--json`.                                     |

Global options: `-C <dir>` (run as if started in `<dir>`), `-c <file>` (manifest), `-v`, `-h`.

### Selecting projects

`exec`, `run`, `status`, `list`, `context` and `sync` accept:

| Flag                   | Meaning                                        |
| ---------------------- | ---------------------------------------------- |
| `-a, --all`            | every project                                  |
| `-t, --tags a,b`       | projects having **all** these tags             |
| `--tags-any a,b`       | projects having **at least one** of these tags |
| `--paths services/`    | projects under these path prefixes             |
| `-p, --projects n1,n2` | projects by name                               |
| `--exclude-tags x`     | drop projects having any of these tags         |

Criteria combine with AND. Without any selector, `exec` and `run` refuse to run (exit code 2) while the other commands use every project.

### Running commands

```sh
overrepo exec --tags backend -- git status -s
overrepo exec --paths services/ -j 8 -- npm ci          # parallel, prefixed output
overrepo exec --all --output grouped "git log -1 --oneline"
overrepo run lint --tags-any node,php --exclude-tags legacy
```

- After `--`, arguments run directly (no shell); a **single quoted argument** goes through the shell (`&&`, pipes, `$VAR`).
- Sequential by default; `--parallel` uses `defaults.concurrency`, `-j <n>` sets it.
- `--output prefix` (default) streams lines prefixed by a colored project name; `grouped` prints one block per project as it finishes; `raw` hands the terminal to each command in turn (interactive tools).
- Commands receive `OVERREPO_ROOT`, `OVERREPO_PROJECT` and `OVERREPO_PROJECT_PATH`.
- Projects that are not cloned are skipped. A final summary repeats every failure.

### Exit codes

| Code  | Meaning                                                     |
| ----- | ----------------------------------------------------------- |
| `0`   | success                                                     |
| `1`   | at least one project failed (or `context --check` is stale) |
| `2`   | usage or configuration error                                |
| `130` | interrupted (Ctrl+C)                                        |

## Usage with AI agents

Run `overrepo context` and commit `ai/repos/`. Start your agent at the root of the meta-repo and point it to the index, e.g. in your `AGENTS.md` / `CLAUDE.md`:

```md
This workspace contains many repositories. Before working on one, read `ai/repos/index.md`,
then the card of the repository (`ai/repos/<path>.md`), then explore its directory.
```

You can also tag a card directly (`@billing-api.md`): cards are small, regular files that pickers can see even though the repositories themselves are git-ignored.

### The index — `ai/repos/index.md`

One row per project (name linked to its card, path, description, tags), grouped by top-level folder then by primary tag, with a short header telling the agent how to use it.

### Cards — `ai/repos/<path>.md`

Generated **without any LLM**, deterministically:

- front matter: `name`, `path`, `url`, `tags`, `owners`, `cloned`;
- description and links from the manifest;
- **agent instructions**: if the repository has its own `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules` or `.github/copilot-instructions.md`, the card links to it instead of copying it;
- **stack**: languages, frameworks, package managers, runtime constraints and tooling, detected from `package.json`, `composer.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, `pom.xml`/Gradle, `Gemfile`, `.csproj`, `Dockerfile`, compose files and CI configuration;
- **scripts**: `package.json` scripts, Composer scripts, Makefile targets, Taskfile tasks;
- **internal dependencies**: other projects of the manifest this one uses, and those using it, matched by published package name (npm, Composer, Go modules, Cargo) or by git URL in dependency specs;
- key files from `context.include`, the top-level structure (tracked files only), and a README excerpt.

Guarantees:

- **Idempotent**: no timestamps; regenerating without changes rewrites nothing. `overrepo context --check` in CI fails when a card is outdated.
- **Manual notes survive**: everything between `<!-- overrepo:manual -->` and `<!-- /overrepo:manual -->` is kept as-is.
- **Bounded size**: the README excerpt, then the tree, scripts and dependency lists shrink until the card fits `context.maxBytes`.
- Projects that are not cloned get a card built from the manifest only, marked as such.

Cards reflect the working tree of each clone (README, manifests) and the tracked files of its `HEAD`; generate them from up-to-date default branches (e.g. after `overrepo sync --pull`, or in CI) to avoid noise between teammates.

## Importing from a discovery script

`import` reads JSON on stdin (or `--file`): either an array or `{ "projects": [...] }`.

```json
{
  "projects": [
    {
      "name": "billing-api",
      "path": "backend/billing-api",
      "url": "git@github.com:client/billing-api.git",
      "desc": "Billing API",
      "tags": ["backend", "billing"],
      "owners": ["team-payments"],
      "links": { "docs": "https://docs.example.com/billing" },
      "sync": true
    }
  ]
}
```

Only `name` is required; unknown fields are ignored. Projects are matched by name, then by git URL (so `git@github.com:org/x.git` and `https://github.com/org/x` are the same project).

```sh
./discover-repos.sh | overrepo import --dry-run   # preview
./discover-repos.sh | overrepo import             # add new projects, fill missing fields
./discover-repos.sh | overrepo import --overwrite --prune
```

Existing values are never replaced without `--overwrite`, and projects are never removed without `--prune`. The result is validated before the manifest is written.

## Robustness

- One repository failing (authentication, network, conflict) never stops the others; the summary lists every error.
- git never prompts: `GIT_TERMINAL_PROMPT=0`, and SSH runs in batch mode (unless you configured `GIT_SSH_COMMAND` or `core.sshCommand`). git uses your own SSH keys and credential helpers.
- Per-operation timeout and retries with exponential backoff on transient network errors (not on authentication errors).
- Clones are made in a temporary `.<name>.overrepo-partial` directory and moved into place only when complete. On Ctrl+C, running processes are stopped, temporary directories removed, and `doctor` reports anything left behind.

## Programmatic API

Everything the CLI does is available without console output, e.g. to build other front-ends:

```ts
import { loadManifest, selectProjects, sync, status, generateContext } from "overrepo";

const manifest = await loadManifest({ cwd: "/path/to/meta-repo" });
const backend = selectProjects(manifest.projects, { tags: ["backend"] });
const report = await sync(manifest, { projects: backend, onEvent: (event) => {} });
await generateContext(manifest, { check: true });
```

Stack detection is pluggable: pass your own `Detector` list to `generateContext({ detectors })` (see `defaultDetectors`).

## Development

The toolchain is [Vite+](https://viteplus.dev) (`vp`): formatting, linting, type checking, tests and packaging. Dependencies are managed with [pnpm](https://pnpm.io), driven by `vp` (the pnpm and Node.js versions are pinned in `devEngines`).

```sh
vp install
vp check      # format, lint, types
vp test       # unit + integration tests (local git repositories, no network)
vp pack       # build dist/
```

Releases use [changesets](https://github.com/changesets/changesets): add one with `vp exec changeset`; merging the generated version PR publishes to npm with provenance.

## License

MIT
