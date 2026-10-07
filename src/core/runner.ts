import pLimit from "p-limit";
import { errorMessage } from "./errors.ts";
import type { Project } from "./model.ts";

export type ResultStatus = "ok" | "failed" | "skipped";

export interface ProjectResult<T = undefined> {
  project: Project;
  status: ResultStatus;
  /** Short human-readable outcome ("cloned", "up to date", "not cloned"…). */
  message?: string;
  value?: T;
  error?: string;
  durationMs: number;
}

export interface Outcome<T> {
  status: ResultStatus;
  message?: string;
  value?: T;
  error?: string;
}

export const ok = <T>(message?: string, value?: T): Outcome<T> => ({
  status: "ok",
  message,
  value,
});
export const skipped = <T>(message: string, value?: T): Outcome<T> => ({
  status: "skipped",
  message,
  value,
});
export const failed = <T>(error: string, value?: T): Outcome<T> => ({
  status: "failed",
  error,
  value,
});

export type RunEvent<T> =
  | { type: "start"; project: Project }
  | { type: "done"; result: ProjectResult<T> };

export interface RunOptions<T> {
  concurrency: number;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent<T>) => void;
}

/**
 * Runs `task` for each project with bounded concurrency.
 * A failing project never stops the others; results keep the input order.
 * Once `signal` aborts, pending projects are reported as skipped ("interrupted").
 */
export async function forEachProject<T>(
  projects: Project[],
  task: (project: Project) => Promise<Outcome<T>>,
  options: RunOptions<T>,
): Promise<ProjectResult<T>[]> {
  const limit = pLimit(Math.max(1, options.concurrency));
  return Promise.all(
    projects.map((project) =>
      limit(async (): Promise<ProjectResult<T>> => {
        const started = Date.now();
        let outcome: Outcome<T>;
        if (options.signal?.aborted) {
          outcome = skipped("interrupted");
        } else {
          options.onEvent?.({ type: "start", project });
          try {
            outcome = await task(project);
          } catch (error) {
            outcome = options.signal?.aborted ? failed("interrupted") : failed(errorMessage(error));
          }
        }
        const result: ProjectResult<T> = { project, durationMs: Date.now() - started, ...outcome };
        options.onEvent?.({ type: "done", result });
        return result;
      }),
    ),
  );
}

export interface Summary {
  ok: number;
  failed: number;
  skipped: number;
}

export function summarize(results: ProjectResult<unknown>[]): Summary {
  const summary: Summary = { ok: 0, failed: 0, skipped: 0 };
  for (const result of results) summary[result.status]++;
  return summary;
}
