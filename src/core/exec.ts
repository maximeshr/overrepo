import type { Readable } from "node:stream";
import { execa } from "execa";
import { isGitRepo } from "../git/git.ts";
import type { Manifest, Project } from "./model.ts";
import {
  failed,
  forEachProject,
  ok,
  skipped,
  type ProjectResult,
  type RunEvent,
} from "./runner.ts";

export type OutputStream = "stdout" | "stderr";

export interface OutputLine {
  stream: OutputStream;
  line: string;
}

export interface ExecValue {
  exitCode: number | undefined;
  /** Captured output, only when `capture` is enabled. */
  output?: OutputLine[];
}

export interface ExecOptions {
  /** A single string runs through the shell; an array runs the binary directly (no quoting issues). */
  command: string | string[];
  projects: Project[];
  concurrency?: number;
  /** Seconds. No timeout by default: builds and installs can legitimately take long. */
  timeout?: number;
  signal?: AbortSignal;
  /** `inherit` hands the terminal to the child (sequential, interactive use). Default `pipe`. */
  stdio?: "pipe" | "inherit";
  /** Keep every output line in the result (JSON / grouped output). */
  capture?: boolean;
  /** Streaming callback, called line by line in `pipe` mode. */
  onOutput?: (project: Project, line: OutputLine) => void;
  onEvent?: (event: RunEvent<ExecValue>) => void;
  /** Extra environment variables for the child. */
  env?: Record<string, string>;
}

function forEachLine(
  stream: Readable | null | undefined,
  onLine: (line: string) => void,
): Promise<void> {
  if (!stream) return Promise.resolve();
  stream.setEncoding("utf8");
  let pending = "";
  stream.on("data", (chunk: string) => {
    const parts = (pending + chunk).split(/\r?\n/);
    pending = parts.pop() ?? "";
    for (const part of parts) onLine(part);
  });
  return new Promise((resolve) => {
    const flush = () => {
      if (pending) onLine(pending);
      pending = "";
      resolve();
    };
    stream.once("end", flush);
    stream.once("close", flush);
    stream.once("error", flush);
  });
}

/** Runs a command in each selected project directory. Projects that are not cloned are skipped. */
export async function execInProjects(
  manifest: Manifest,
  options: ExecOptions,
): Promise<ProjectResult<ExecValue>[]> {
  const [file, ...args] = typeof options.command === "string" ? [options.command] : options.command;
  if (!file) throw new Error("empty command");
  const shell = typeof options.command === "string";
  const stdio = options.stdio ?? "pipe";

  return forEachProject<ExecValue>(
    options.projects,
    async (project) => {
      if (!isGitRepo(project.dir)) return skipped("not cloned");
      const output: OutputLine[] = [];
      const emit = (stream: OutputStream) => (line: string) => {
        if (options.capture) output.push({ stream, line });
        options.onOutput?.(project, { stream, line });
      };
      const child = execa(file, args, {
        cwd: project.dir,
        shell,
        stdin: stdio === "inherit" ? "inherit" : "ignore",
        stdout: stdio,
        stderr: stdio,
        buffer: false,
        reject: false,
        timeout: options.timeout ? options.timeout * 1000 : undefined,
        cancelSignal: options.signal,
        // With `shell: true`, killing the shell alone would orphan the actual command.
        killDescendants: true,
        env: {
          OVERREPO_ROOT: manifest.root,
          OVERREPO_PROJECT: project.name,
          OVERREPO_PROJECT_PATH: project.path,
          ...options.env,
        },
      });
      const streams =
        stdio === "pipe"
          ? [forEachLine(child.stdout, emit("stdout")), forEachLine(child.stderr, emit("stderr"))]
          : [];
      const [result] = await Promise.all([child, ...streams]);
      const value: ExecValue = {
        exitCode: result.exitCode,
        ...(options.capture ? { output } : {}),
      };
      if (result.isCanceled) return failed("interrupted", value);
      if (result.timedOut) return failed("timed out", value);
      if (result.failed) {
        const reason =
          result.exitCode !== undefined
            ? `exit code ${result.exitCode}`
            : (result.shortMessage ?? "failed");
        return failed(reason, value);
      }
      return ok(undefined, value);
    },
    { concurrency: options.concurrency ?? 1, signal: options.signal, onEvent: options.onEvent },
  );
}
