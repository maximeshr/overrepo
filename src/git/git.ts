import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { OverrepoError } from "../core/errors.ts";

export interface GitRunOptions {
  cwd?: string;
  /** Milliseconds; the process is killed when exceeded. */
  timeout?: number;
  signal?: AbortSignal;
}

export class GitError extends OverrepoError {
  readonly args: string[];
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;

  constructor(
    args: string[],
    stderr: string,
    details: { exitCode?: number; timedOut: boolean; aborted: boolean },
  ) {
    const reason = details.aborted
      ? "interrupted"
      : details.timedOut
        ? "timed out"
        : lastMeaningfulLine(stderr) || `exited with code ${details.exitCode ?? "?"}`;
    super(`git ${args[0] ?? ""} failed: ${reason}`);
    this.name = "GitError";
    this.args = args;
    this.stderr = stderr;
    this.timedOut = details.timedOut;
    this.aborted = details.aborted;
  }
}

function lastMeaningfulLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(hint|warning):/i.test(line));
  const fatal = lines.find((line) => /^(fatal|error):/i.test(line));
  return (fatal ?? lines.at(-1) ?? "").replace(/^(fatal|error):\s*/i, "");
}

let sshCommandProbe: Promise<boolean> | undefined;

/** True when the user configured `core.sshCommand`, which `GIT_SSH_COMMAND` would override. */
function hasCustomSshCommand(): Promise<boolean> {
  sshCommandProbe ??= execa("git", ["config", "--get", "core.sshCommand"], {
    reject: false,
    stdin: "ignore",
  }).then(
    (result) => result.exitCode === 0 && result.stdout.trim() !== "",
    () => false,
  );
  return sshCommandProbe;
}

/**
 * Environment that guarantees git never waits for interactive input:
 * no credential prompt, and SSH in batch mode unless the user customized SSH.
 */
export async function nonInteractiveEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
  if (!process.env.GIT_SSH_COMMAND && !process.env.GIT_SSH && !(await hasCustomSshCommand())) {
    env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  }
  return env;
}

/** Runs git and returns trimmed stdout. Throws `GitError` on failure. */
export async function git(args: string[], options: GitRunOptions = {}): Promise<string> {
  const result = await execa("git", args, {
    cwd: options.cwd,
    timeout: options.timeout,
    cancelSignal: options.signal,
    // git spawns ssh and remote helpers that must not outlive a timeout or Ctrl+C.
    killDescendants: true,
    env: await nonInteractiveEnv(),
    stdin: "ignore",
    reject: false,
    stripFinalNewline: true,
  });
  if (result.failed) {
    if (
      result.code === "ENOENT" ||
      (result.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ) {
      throw new OverrepoError("git executable not found in PATH", 2);
    }
    throw new GitError(args, String(result.stderr ?? ""), {
      exitCode: result.exitCode,
      timedOut: Boolean(result.timedOut),
      aborted: Boolean(result.isCanceled),
    });
  }
  return String(result.stdout ?? "");
}

export async function gitVersion(): Promise<string | undefined> {
  try {
    return (await git(["--version"])).replace(/^git version\s*/, "");
  } catch {
    return undefined;
  }
}

/** A directory is a repo when it has a `.git` directory or file (worktrees, submodules). */
export function isGitRepo(dir: string): boolean {
  return existsSync(path.join(dir, ".git"));
}

export function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Clones the remote default branch. Blobs are fetched on demand. */
export async function clone(url: string, dest: string, options: GitRunOptions = {}): Promise<void> {
  await git(["clone", "--no-progress", "--filter=blob:none", "--", url, dest], options);
}

export async function originUrl(
  dir: string,
  options: GitRunOptions = {},
): Promise<string | undefined> {
  try {
    return (await git(["remote", "get-url", "origin"], { ...options, cwd: dir })) || undefined;
  } catch {
    return undefined;
  }
}

export interface RepoStatus {
  /** `undefined` when HEAD is detached. */
  branch: string | undefined;
  /** Commit hash (short) of HEAD, `undefined` on an empty repo. */
  head: string | undefined;
  upstream: string | undefined;
  ahead: number;
  behind: number;
  /** Number of changed/untracked entries. */
  changes: number;
}

/** Parses `git status --porcelain=v2 --branch`. */
export function parseStatus(output: string): RepoStatus {
  const status: RepoStatus = {
    branch: undefined,
    head: undefined,
    upstream: undefined,
    ahead: 0,
    behind: 0,
    changes: 0,
  };
  for (const line of output.split("\n")) {
    if (!line) continue;
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length);
      status.head = oid === "(initial)" ? undefined : oid.slice(0, 7);
    } else if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length);
      status.branch = head === "(detached)" ? undefined : head;
    } else if (line.startsWith("# branch.upstream ")) {
      status.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (!line.startsWith("#")) {
      status.changes++;
    }
  }
  return status;
}

export async function repoStatus(dir: string, options: GitRunOptions = {}): Promise<RepoStatus> {
  return parseStatus(await git(["status", "--porcelain=v2", "--branch"], { ...options, cwd: dir }));
}

export async function fetch(dir: string, options: GitRunOptions = {}): Promise<void> {
  await git(["fetch", "--prune", "--no-progress"], { ...options, cwd: dir });
}

export async function pullFastForward(dir: string, options: GitRunOptions = {}): Promise<void> {
  await git(["pull", "--ff-only", "--no-progress"], { ...options, cwd: dir });
}

export async function lsRemote(url: string, options: GitRunOptions = {}): Promise<void> {
  await git(["ls-remote", "--exit-code", "--heads", url], options);
}
