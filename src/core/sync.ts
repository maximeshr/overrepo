import { mkdir, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { clone, fetch, isDirectory, isGitRepo, pullFastForward, repoStatus } from "../git/git.ts";
import { withRetry } from "../git/retry.ts";
import { PARTIAL_SUFFIX, syncGitignore, type GitignoreUpdate } from "./gitignore.ts";
import type { Manifest, Project } from "./model.ts";
import {
  failed,
  forEachProject,
  ok,
  skipped,
  type Outcome,
  type ProjectResult,
  type RunEvent,
} from "./runner.ts";

export type SyncAction = "cloned" | "would-clone" | "present" | "pulled" | "fetched" | "would-pull";

export interface SyncOptions {
  /** Defaults to every project of the manifest. */
  projects?: Project[];
  /** Fetch and fast-forward existing clones. */
  pull?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  /** Seconds, per git operation. */
  timeout?: number;
  retries?: number;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent<SyncAction>) => void;
}

export interface SyncReport {
  results: ProjectResult<SyncAction>[];
  /** `undefined` when `gitignore.sync` is disabled. */
  gitignore: GitignoreUpdate | undefined;
}

export function partialCloneDir(project: Project): string {
  return path.join(path.dirname(project.dir), `.${path.basename(project.dir)}${PARTIAL_SUFFIX}`);
}

async function isEmptyDir(dir: string): Promise<boolean> {
  return (await readdir(dir)).length === 0;
}

export async function sync(manifest: Manifest, options: SyncOptions = {}): Promise<SyncReport> {
  const projects = options.projects ?? manifest.projects;
  const timeout = (options.timeout ?? manifest.defaults.timeout) * 1000;
  const retries = options.retries ?? manifest.defaults.retries;
  const signal = options.signal;

  // The ignore block covers every project of the manifest, whatever the selection, before anything is cloned.
  const gitignore = manifest.gitignore.sync
    ? await syncGitignore(
        manifest.root,
        manifest.projects.map((project) => project.path),
        { dryRun: options.dryRun },
      )
    : undefined;

  const cloneProject = async (project: Project, url: string): Promise<Outcome<SyncAction>> => {
    if (options.dryRun) return ok("would clone", "would-clone");
    const partial = partialCloneDir(project);
    await mkdir(path.dirname(project.dir), { recursive: true });
    await rm(partial, { recursive: true, force: true });
    try {
      await withRetry(() => clone(url, partial, project.clone, { timeout, signal }), {
        retries,
        signal,
        onRetry: () => rm(partial, { recursive: true, force: true }),
      });
      if (isDirectory(project.dir)) await rmdir(project.dir);
      await rename(partial, project.dir);
    } catch (error) {
      await rm(partial, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return ok(`cloned${project.clone.branch ? ` (${project.clone.branch})` : ""}`, "cloned");
  };

  const updateProject = async (project: Project): Promise<Outcome<SyncAction>> => {
    if (!options.pull) return ok("present", "present");
    if (options.dryRun) return ok("would pull", "would-pull");
    const status = await repoStatus(project.dir, { timeout, signal });
    if (!status.branch) {
      await withRetry(() => fetch(project.dir, { timeout, signal }), { retries, signal });
      return ok("fetched (detached HEAD)", "fetched");
    }
    if (!status.upstream) {
      await withRetry(() => fetch(project.dir, { timeout, signal }), { retries, signal });
      return ok(`fetched (${status.branch} has no upstream)`, "fetched");
    }
    await withRetry(() => pullFastForward(project.dir, { timeout, signal }), { retries, signal });
    return ok(`pulled ${status.branch}`, "pulled");
  };

  const results = await forEachProject<SyncAction>(
    projects,
    async (project) => {
      if (isGitRepo(project.dir)) return updateProject(project);
      if (isDirectory(project.dir) && !(await isEmptyDir(project.dir))) {
        return failed("directory exists but is not a git repository");
      }
      if (!project.sync) return skipped("sync: false");
      if (!project.url) return skipped("no url");
      return cloneProject(project, project.url);
    },
    {
      concurrency: options.concurrency ?? manifest.defaults.concurrency,
      signal,
      onEvent: options.onEvent,
    },
  );

  return { results, gitignore };
}
