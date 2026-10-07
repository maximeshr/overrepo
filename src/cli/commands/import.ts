import { readFile } from "node:fs/promises";
import path from "node:path";
import { UsageError } from "../../core/errors.ts";
import { importProjects, parseImportSource } from "../../core/import.ts";
import { sync } from "../../core/sync.ts";
import { contextOf, load } from "../options.ts";
import { json, printSummary, resultLine } from "../output.ts";
import type { Register } from "./types.ts";

export const registerImport: Register = (program, run, io) => {
  program
    .command("import")
    .description("merge projects from a JSON document (stdin or --file) into the manifest")
    .option("--file <path>", "read JSON from a file instead of stdin")
    .option("--overwrite", "replace existing field values with the imported ones")
    .option("--prune", "remove projects that are absent from the input")
    .option("--dry-run", "report changes without writing")
    .option("--sync", "clone projects that this import added")
    .option("--json", "print the report as JSON")
    .action(
      run(
        async (
          options: {
            file?: string;
            overwrite?: boolean;
            prune?: boolean;
            dryRun?: boolean;
            sync?: boolean;
            json?: boolean;
          },
          command,
        ) => {
          const context = contextOf(io, command);
          if (!options.file && io.stdinIsTTY)
            throw new UsageError(
              "import expects JSON on stdin (e.g. `my-script | overrepo import`) or --file <path>",
            );
          const text = options.file
            ? await readFile(path.resolve(context.cwd, options.file), "utf8")
            : await io.readStdin();
          const manifest = await load(context);
          const report = await importProjects(manifest, parseImportSource(text), options);
          const added = new Set(report.added);
          const fresh =
            options.sync && !options.dryRun && added.size > 0 ? await load(context) : undefined;
          const synced = fresh
            ? await sync(fresh, {
                projects: fresh.projects.filter((project) => added.has(project.name)),
                signal: io.signal,
                onEvent: (event) => {
                  if (options.json || event.type !== "done") return;
                  io.error(`${resultLine(io.colors, event.result, 28)}\n`);
                },
              })
            : undefined;

          if (options.json) {
            json(io, {
              added: report.added,
              updated: report.updated,
              missing: report.missing,
              removed: report.removed,
              changed: report.changed,
              written: report.changed && !options.dryRun,
              synced: synced
                ? synced.results.map((result) => ({
                    name: result.project.name,
                    status: result.status,
                    action: result.value ?? null,
                  }))
                : undefined,
            });
            return synced?.results.some((result) => result.status === "failed") ? 1 : 0;
          }
          const { colors } = io;
          for (const name of report.added) io.error(`  ${colors.green("+")} ${name}\n`);
          for (const [name, fields] of Object.entries(report.updated))
            io.error(`  ${colors.cyan("~")} ${name} ${colors.dim(`(${fields.join(", ")})`)}\n`);
          for (const name of report.removed) io.error(`  ${colors.red("-")} ${name}\n`);
          const notRemoved = report.missing.filter((name) => !report.removed.includes(name));
          if (notRemoved.length > 0) {
            io.error(
              colors.yellow(
                `${notRemoved.length} project(s) of the manifest are not in the input (kept; use --prune to remove): ${notRemoved.join(", ")}\n`,
              ),
            );
          }
          const verb = options.dryRun ? "would add" : "added";
          io.error(
            `\nimport: ${verb} ${report.added.length}, updated ${Object.keys(report.updated).length}, removed ${report.removed.length}${report.changed ? "" : " (no change)"}\n`,
          );
          if (!options.sync || report.added.length === 0) return 0;
          if (options.dryRun) {
            io.error(io.colors.dim(`import --sync: would clone ${report.added.join(", ")}\n`));
            return 0;
          }
          return printSummary(io, synced?.results ?? [], { label: "sync" });
        },
      ),
    );
};
