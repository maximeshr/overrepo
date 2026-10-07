import path from "node:path";
import { sync } from "../../core/sync.ts";
import {
  contextOf,
  load,
  nonNegativeInt,
  positiveInt,
  positiveNumber,
  select,
  withSelection,
  type SelectionOptions,
} from "../options.ts";
import { json, printSummary, resultLine } from "../output.ts";
import type { Register } from "./types.ts";

interface SyncFlags extends SelectionOptions {
  pull?: boolean;
  dryRun?: boolean;
  concurrency?: number;
  timeout?: number;
  retries?: number;
  json?: boolean;
  quiet?: boolean;
}

export const registerSync: Register = (program, run, io) => {
  withSelection(
    program
      .command("sync")
      .description(
        "clone missing projects and update the managed .gitignore block (all projects unless filtered)",
      )
      .option("--pull", "also fetch and fast-forward existing clones")
      .option("--dry-run", "show what would be done")
      .option("-j, --concurrency <n>", "parallel operations", positiveInt)
      .option("--timeout <seconds>", "timeout per git operation", positiveNumber)
      .option("--retries <n>", "retries on transient network errors", nonNegativeInt)
      .option("-q, --quiet", "only print failures and the summary")
      .option("--json", "print results as JSON"),
  ).action(
    run(async (options: SyncFlags, command) => {
      const context = contextOf(io, command);
      const manifest = await load(context);
      const projects = select(manifest, options);
      const width = Math.min(28, Math.max(0, ...projects.map((project) => project.name.length)));
      const report = await sync(manifest, {
        projects,
        pull: options.pull,
        dryRun: options.dryRun,
        concurrency: options.concurrency,
        timeout: options.timeout,
        retries: options.retries,
        signal: io.signal,
        onEvent: (event) => {
          if (options.json || event.type !== "done") return;
          if (options.quiet && event.result.status !== "failed") return;
          io.error(`${resultLine(io.colors, event.result, width)}\n`);
        },
      });

      if (options.json) {
        json(io, {
          gitignore: report.gitignore
            ? { file: report.gitignore.file, changed: report.gitignore.changed }
            : null,
          results: report.results.map((result) => ({
            name: result.project.name,
            path: result.project.path,
            status: result.status,
            action: result.value ?? null,
            message: result.message ?? null,
            error: result.error ?? null,
          })),
        });
        return report.results.some((result) => result.status === "failed") ? 1 : 0;
      }

      if (report.gitignore?.changed) {
        const verb = options.dryRun ? "would update" : "updated";
        io.error(
          `${io.colors.cyan("ℹ")} ${verb} ${path.relative(context.cwd, report.gitignore.file) || ".gitignore"}\n`,
        );
      }
      return printSummary(io, report.results, {
        label: options.dryRun ? "sync (dry run)" : "sync",
      });
    }),
  );
};
