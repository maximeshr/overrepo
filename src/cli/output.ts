import type { Project } from "../core/model.ts";
import { summarize, type ProjectResult, type ResultStatus } from "../core/runner.ts";
import type { Colors, Io } from "./io.ts";

// oxlint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;]*m/g;

export function visibleLength(text: string): number {
  return text.replace(ANSI, "").length;
}

function padEnd(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

/** Left-aligned columns; the last column is not padded. */
export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const widths: number[] = [];
  for (const row of all)
    row.forEach(
      (cell, index) => (widths[index] = Math.max(widths[index] ?? 0, visibleLength(cell))),
    );
  return all
    .map((row) =>
      row
        .map((cell, index) => (index === row.length - 1 ? cell : padEnd(cell, widths[index] ?? 0)))
        .join("  ")
        .trimEnd(),
    )
    .map((line) => `${line}\n`)
    .join("");
}

export function json(io: Io, value: unknown): void {
  io.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function statusIcon(colors: Colors, status: ResultStatus): string {
  if (status === "ok") return colors.green("✔");
  if (status === "failed") return colors.red("✖");
  return colors.dim("○");
}

/** Stable color per project name, so parallel output is easy to follow. */
export function projectColor(colors: Colors, name: string): (text: string) => string {
  const palette = [
    colors.cyan,
    colors.magenta,
    colors.blue,
    colors.yellow,
    colors.green,
    colors.red,
  ];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length] ?? colors.cyan;
}

export function prefixer(colors: Colors, projects: Project[]): (project: Project) => string {
  const width = Math.min(28, Math.max(0, ...projects.map((project) => project.name.length)));
  return (project) => projectColor(colors, project.name)(`${project.name.padEnd(width)} │`);
}

/** One line per finished project: `✔ name  message`. */
export function resultLine(colors: Colors, result: ProjectResult<unknown>, width: number): string {
  const detail =
    result.status === "failed"
      ? colors.red(result.error ?? "failed")
      : colors.dim(result.message ?? "");
  return `${statusIcon(colors, result.status)} ${result.project.name.padEnd(width)}  ${detail}`.trimEnd();
}

/** Final recap, with every failure repeated so it is not lost in long output. Returns the exit code. */
export function printSummary(
  io: Io,
  results: ProjectResult<unknown>[],
  options: { label?: string } = {},
): 0 | 1 {
  const { colors } = io;
  const counts = summarize(results);
  const failures = results.filter((result) => result.status === "failed");
  if (failures.length > 0) {
    io.error(`\n${colors.red(colors.bold(`${failures.length} failed:`))}\n`);
    for (const failure of failures)
      io.error(`  ${colors.red("✖")} ${failure.project.path}: ${failure.error ?? "failed"}\n`);
  }
  const parts = [
    colors.green(`${counts.ok} ok`),
    counts.failed > 0 ? colors.red(`${counts.failed} failed`) : `${counts.failed} failed`,
    colors.dim(`${counts.skipped} skipped`),
  ];
  io.error(`\n${options.label ? `${options.label}: ` : ""}${parts.join(", ")}\n`);
  return counts.failed > 0 ? 1 : 0;
}

export function warn(io: Io, message: string): void {
  io.error(`${io.colors.yellow("warning")} ${message}\n`);
}

export interface ProgressBar {
  update(done: number, total: number, label?: string): void;
  /** Erases the bar so the next output starts on a clean line. */
  clear(): void;
}

/** Single-line bar redrawn in place on stderr; a no-op when stderr is not a terminal. */
export function progressBar(io: Io, title: string, width = 24): ProgressBar {
  if (!io.stderrIsTTY) return { update: () => {}, clear: () => {} };
  const { colors } = io;
  let drawn = false;
  return {
    update(done, total, label = "") {
      const ratio = total > 0 ? Math.min(1, done / total) : 1;
      const filled = Math.round(ratio * width);
      const bar = colors.cyan("█".repeat(filled)) + colors.dim("░".repeat(width - filled));
      const name = label.length > 32 ? `${label.slice(0, 31)}…` : label;
      io.error(`\r\u001B[2K${title} ${bar} ${done}/${total} ${colors.dim(name)}`);
      drawn = true;
    },
    clear() {
      if (drawn) io.error("\r\u001B[2K");
      drawn = false;
    },
  };
}
