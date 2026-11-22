import { mkdir, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { clone, fetch, isDirectory, isGitRepo, pullFastForward, repoStatus } from "../git/git.ts";
import { withRetry } from "../git/retry.ts";
import { PARTIAL_SUFFIX } from "./model.ts";
import type { Manifest, Project } from "./model.ts";
import { failed, forEachProject, ok } from "./runner.ts";
import type { Outcome, ProjectResult, RunEvent } from "./runner.ts";

export type SyncAction = "cloned" | "would-clone" | "present" | "pulled" | "fetched" | "would-pull";

export interface SyncOptions {
  /** Defaults to every project of the manifest */
  projects?: Project[];
  /** Fetch and fast-forward existing clones */
  pull?: boolean;
  /** Report what would happen without touching the disk */
  dryRun?: boolean;
  /** Projects synced in parallel, `defaults.concurrency` of the manifest by default */
  concurrency?: number;
  /** Seconds, per git operation */
  timeout?: number;
  /** Retries of a failed network operation, `defaults.retries` of the manifest by default */
  retries?: number;
  /** Stops the remaining projects once aborted */
  signal?: AbortSignal;
  /** Called when a project starts and when it is done */
  onEvent?: (event: RunEvent<SyncAction>) => void;
}

export interface SyncReport {
  results: ProjectResult<SyncAction>[];
}

const partialCloneDir = (project: Project): string =>
  path.join(path.dirname(project.dir), `.${path.basename(project.dir)}${PARTIAL_SUFFIX}`);

const isEmptyDir = async (dir: string): Promise<boolean> => (await readdir(dir)).length === 0;

export const sync = async (manifest: Manifest, options: SyncOptions = {}): Promise<SyncReport> => {
  const projects = options.projects ?? manifest.projects;
  const timeout = (options.timeout ?? manifest.defaults.timeout) * 1000;
  const retries = options.retries ?? manifest.defaults.retries;
  const { signal } = options;

  const cloneProject = async (project: Project): Promise<Outcome<SyncAction>> => {
    if (options.dryRun === true) {
      return ok("would clone", "would-clone");
    }

    const partial = partialCloneDir(project);
    await mkdir(path.dirname(project.dir), { recursive: true });
    await rm(partial, { recursive: true, force: true });

    try {
      await withRetry(
        async () => {
          await clone(project.url, partial, { timeout, signal });
        },
        {
          retries,
          signal,
          onRetry: async () => {
            await rm(partial, { recursive: true, force: true });
          },
        },
      );

      if (isDirectory(project.dir)) {
        await rmdir(project.dir);
      }

      await rename(partial, project.dir);
    } catch (error) {
      await rm(partial, { recursive: true, force: true }).catch(() => {
        // Best-effort cleanup: the clone error below is the one to report
      });
      throw error;
    }

    return ok("cloned", "cloned");
  };

  const updateProject = async (project: Project): Promise<Outcome<SyncAction>> => {
    if (options.pull !== true) {
      return ok("present", "present");
    }

    if (options.dryRun === true) {
      return ok("would pull", "would-pull");
    }

    const status = await repoStatus(project.dir, { timeout, signal });

    if (status.branch === undefined || status.branch === "") {
      await withRetry(
        async () => {
          await fetch(project.dir, { timeout, signal });
        },
        {
          retries,
          signal,
        },
      );

      return ok("fetched (detached HEAD)", "fetched");
    }

    if (status.upstream === undefined || status.upstream === "") {
      await withRetry(
        async () => {
          await fetch(project.dir, { timeout, signal });
        },
        {
          retries,
          signal,
        },
      );

      return ok(`fetched (${status.branch} has no upstream)`, "fetched");
    }

    await withRetry(
      async () => {
        await pullFastForward(project.dir, { timeout, signal });
      },
      {
        retries,
        signal,
      },
    );

    return ok(`pulled ${status.branch}`, "pulled");
  };

  const results = await forEachProject<SyncAction>(
    projects,
    async (project) => {
      if (isGitRepo(project.dir)) {
        return await updateProject(project);
      }

      if (isDirectory(project.dir) && !(await isEmptyDir(project.dir))) {
        return failed("directory exists but is not a git repository");
      }

      return await cloneProject(project);
    },
    {
      concurrency: options.concurrency ?? manifest.defaults.concurrency,
      signal,
      onEvent: options.onEvent,
    },
  );

  return { results };
};
