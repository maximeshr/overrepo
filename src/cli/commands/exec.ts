import type { Command } from "commander";
import { UsageError } from "../../core/errors.ts";
import { execInProjects } from "../../core/exec.ts";
import type { Manifest, Project } from "../../core/model.ts";
import type { Io } from "../io.ts";
import {
  contextOf,
  load,
  positiveInt,
  positiveNumber,
  select,
  withSelection,
  type SelectionOptions,
} from "../options.ts";
import { json, prefixer, printSummary, projectColor, resultLine } from "../output.ts";
import type { Register } from "./types.ts";

type OutputMode = "prefix" | "grouped" | "raw";

interface ExecFlags extends SelectionOptions {
  parallel?: boolean;
  concurrency?: number;
  output?: OutputMode;
  timeout?: number;
  json?: boolean;
}

function withExecOptions(command: Command): Command {
  return withSelection(command)
    .option("--parallel", "run in parallel (concurrency from the manifest)")
    .option("-j, --concurrency <n>", "run in parallel with this concurrency", positiveInt)
    .option(
      "-o, --output <mode>",
      "prefix (live, prefixed lines) | grouped (one block per project) | raw (sequential, interactive)",
    )
    .option("--timeout <seconds>", "kill the command after this delay", positiveNumber)
    .option("--json", "capture output and print results as JSON");
}

/** Shared by `exec` and `run`. Returns the exit code. */
export async function runInProjects(
  io: Io,
  manifest: Manifest,
  projects: Project[],
  command: string | string[],
  flags: ExecFlags,
): Promise<number> {
  const concurrency = flags.concurrency ?? (flags.parallel ? manifest.defaults.concurrency : 1);
  const mode: OutputMode = flags.output ?? "prefix";
  if (!["prefix", "grouped", "raw"].includes(mode))
    throw new UsageError(`--output must be prefix, grouped or raw (got "${mode}")`);
  if (mode === "raw" && concurrency > 1)
    throw new UsageError("--output raw cannot be combined with parallel execution");
  if (mode === "raw" && flags.json)
    throw new UsageError("--output raw cannot be combined with --json");
  if (projects.length === 0) {
    io.error(io.colors.yellow("no project matches the selection\n"));
    return 0;
  }

  const { colors } = io;
  const prefix = prefixer(colors, projects);
  const width = Math.min(28, Math.max(0, ...projects.map((project) => project.name.length)));
  const results = await execInProjects(manifest, {
    command,
    projects,
    concurrency,
    timeout: flags.timeout,
    signal: io.signal,
    stdio: mode === "raw" ? "inherit" : "pipe",
    capture: flags.json || mode === "grouped",
    env:
      io.stdoutIsTTY && mode !== "raw" && !process.env.NO_COLOR ? { FORCE_COLOR: "1" } : undefined,
    onOutput:
      flags.json || mode !== "prefix"
        ? undefined
        : (project, { line }) => io.write(`${prefix(project)} ${line}\n`),
    onEvent: (event) => {
      if (flags.json) return;
      if (event.type === "start" && mode === "raw") {
        io.write(
          `\n${projectColor(colors, event.project.name)(colors.bold(`▸ ${event.project.name}`))} ${colors.dim(event.project.path)}\n`,
        );
      }
      if (event.type !== "done") return;
      const { result } = event;
      if (mode === "grouped" && result.value?.output) {
        io.write(
          `\n${projectColor(colors, result.project.name)(colors.bold(`▸ ${result.project.name}`))} ${colors.dim(result.project.path)}\n`,
        );
        for (const { line } of result.value.output) io.write(`${line}\n`);
      }
      if (result.status !== "ok" || mode !== "prefix")
        io.error(`${resultLine(colors, result, width)}\n`);
    },
  });

  if (flags.json) {
    json(
      io,
      results.map((result) => ({
        name: result.project.name,
        path: result.project.path,
        status: result.status,
        exitCode: result.value?.exitCode ?? null,
        error: result.error ?? result.message ?? null,
        durationMs: result.durationMs,
        stdout:
          result.value?.output
            ?.filter((line) => line.stream === "stdout")
            .map((line) => line.line)
            .join("\n") ?? "",
        stderr:
          result.value?.output
            ?.filter((line) => line.stream === "stderr")
            .map((line) => line.line)
            .join("\n") ?? "",
      })),
    );
    return results.some((result) => result.status === "failed") ? 1 : 0;
  }
  return printSummary(io, results);
}

export const registerExec: Register = (program, run, io) => {
  withExecOptions(
    program
      .command("exec")
      .description("run a shell command in each selected project (requires a selection)")
      .argument("<command...>", "command to run; a single quoted argument goes through the shell")
      .passThroughOptions(),
  ).action(
    run(async (commandArgs: string[], options: ExecFlags, command) => {
      const manifest = await load(contextOf(io, command));
      const projects = select(manifest, options, true);
      const cmd = commandArgs.length === 1 ? (commandArgs[0] as string) : commandArgs;
      return runInProjects(io, manifest, projects, cmd, options);
    }),
  );
};

export const registerRun: Register = (program, run, io) => {
  withExecOptions(
    program
      .command("run")
      .description(
        "run a task defined in the manifest in each selected project; without a task, list tasks",
      )
      .argument("[task]", "task name"),
  ).action(
    run(async (taskName: string | undefined, options: ExecFlags, command) => {
      const manifest = await load(contextOf(io, command));
      const tasks = Object.values(manifest.tasks);
      if (!taskName) {
        if (tasks.length === 0) {
          io.error("no tasks defined in the manifest\n");
          return 0;
        }
        const width = Math.max(...tasks.map((task) => task.name.length));
        for (const task of tasks)
          io.write(
            `${io.colors.bold(task.name.padEnd(width))}  ${task.desc ?? ""} ${io.colors.dim(`(${task.cmd})`)}\n`,
          );
        return 0;
      }
      const task = manifest.tasks[taskName];
      if (!task) {
        const available = tasks.map((t) => t.name).join(", ") || "none";
        throw new UsageError(`unknown task "${taskName}" (available: ${available})`);
      }
      const projects = select(manifest, options, true);
      return runInProjects(io, manifest, projects, task.cmd, options);
    }),
  );
};
