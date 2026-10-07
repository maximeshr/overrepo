import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import picocolors from "picocolors";
import { afterAll } from "vite-plus/test";
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

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = "overrepo-"): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

/** Creates a repository with one commit and returns its `file://` URL. */
export function createRemote(
  base: string,
  name: string,
  files: Record<string, string> = { "README.md": `# ${name}\n` },
): string {
  const dir = path.join(base, `${name}.git-src`);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  writeFiles(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");
  return `file://${dir}`;
}

export interface TestRun {
  code: number;
  stdout: string;
  stderr: string;
}

export async function cli(cwd: string, args: string[], stdin = ""): Promise<TestRun> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd,
    write: (text) => void out.push(text),
    error: (text) => void err.push(text),
    readStdin: async () => stdin,
    stdinIsTTY: false,
    stdoutIsTTY: false,
    colors: picocolors.createColors(false),
    signal: new AbortController().signal,
  };
  const code = await runCli(args, io);
  return { code, stdout: out.join(""), stderr: err.join("") };
}
