import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import picocolors from "picocolors";
import { afterAll } from "vite-plus/test";
import type { z } from "zod";
import type { Io } from "../src/cli/io.ts";
import { runCli } from "../src/cli/main.ts";

const isolatedGitConfig = path.join(
  mkdtempSync(path.join(tmpdir(), "overrepo-gitconfig-")),
  "gitconfig",
);

writeFileSync(
  isolatedGitConfig,
  '[user]\n\tname = overrepo tests\n\temail = tests@overrepo.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[protocol "file"]\n\tallow = always\n',
);

process.env.GIT_CONFIG_GLOBAL = isolatedGitConfig;

process.env.GIT_CONFIG_NOSYSTEM = "1";

// Git hooks export these (e.g. GIT_DIR in a worktree's pre-push); they would redirect every test repository.
delete process.env.GIT_DIR;

delete process.env.GIT_WORK_TREE;

delete process.env.GIT_INDEX_FILE;

delete process.env.GIT_COMMON_DIR;

delete process.env.GIT_PREFIX;

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

export const tempDir = (prefix = "overrepo-"): string => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);

  return dir;
};

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const writeFiles = (dir: string, files: Record<string, string>): void => {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
};

/** Creates a repository with one commit and returns its `file://` URL */
export const createRemote = (
  base: string,
  name: string,
  files?: Record<string, string>,
): string => {
  const dir = path.join(base, `${name}.git-src`);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  writeFiles(dir, files ?? { "README.md": `# ${name}\n` });
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");

  return `file://${dir}`;
};

/** Resolves to `value`, for fakes of async interfaces that have nothing to wait for */
// oxlint-disable-next-line eslint/require-await -- the fake has no I/O, yet the interface it implements is async
export const resolved = async <T>(value: T): Promise<T> => value;

/** Parses the JSON a command printed, failing the test when it does not match `schema` */
export const parseJson = <T>(schema: z.ZodType<T>, text: string): T =>
  schema.parse(JSON.parse(text));

export interface TestRun {
  code: number;
  stdout: string;
  stderr: string;
}

export const cli = async (cwd: string, args: string[], stdin = ""): Promise<TestRun> => {
  const out: string[] = [];
  const err: string[] = [];

  const io: Io = {
    cwd,
    write: (text) => {
      out.push(text);
    },
    error: (text) => {
      err.push(text);
    },
    readStdin: async () => await resolved(stdin),
    stdinIsTTY: false,
    stdoutIsTTY: false,
    stderrIsTTY: false,
    colors: picocolors.createColors(false),
    signal: new AbortController().signal,
  };

  const code = await runCli(args, io);

  return { code, stdout: out.join(""), stderr: err.join("") };
};
