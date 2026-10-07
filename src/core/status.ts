import { isGitRepo, repoStatus, type RepoStatus } from "../git/git.ts";
import type { Manifest, Project } from "./model.ts";
import { forEachProject, ok, skipped, type ProjectResult, type RunEvent } from "./runner.ts";

export type ProjectState = { state: "absent" } | ({ state: "present" } & RepoStatus);

export interface StatusOptions {
  projects?: Project[];
  concurrency?: number;
  timeout?: number;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent<ProjectState>) => void;
}

/** Aggregated git state. Missing clones are reported as `skipped` with an `absent` state, not as failures. */
export async function status(
  manifest: Manifest,
  options: StatusOptions = {},
): Promise<ProjectResult<ProjectState>[]> {
  const timeout = (options.timeout ?? manifest.defaults.timeout) * 1000;
  return forEachProject<ProjectState>(
    options.projects ?? manifest.projects,
    async (project) => {
      if (!isGitRepo(project.dir)) return skipped("not cloned", { state: "absent" });
      const state = await repoStatus(project.dir, { timeout, signal: options.signal });
      return ok(undefined, { state: "present", ...state });
    },
    {
      concurrency: options.concurrency ?? manifest.defaults.concurrency,
      signal: options.signal,
      onEvent: options.onEvent,
    },
  );
}
