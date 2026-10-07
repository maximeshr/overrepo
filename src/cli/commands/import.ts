import { readFile } from "node:fs/promises";
import path from "node:path";
import { UsageError } from "../../core/errors.ts";
import { importProjects, parseImportSource } from "../../core/import.ts";
import { contextOf, load } from "../options.ts";
import { json } from "../output.ts";
import type { Register } from "./types.ts";

export const registerImport: Register = (program, run, io) => {
  program
    .command("import")
    .description("merge projects from a JSON document (stdin or --file) into the manifest")
    .option("--file <path>", "read JSON from a file instead of stdin")
    .option("--overwrite", "replace existing field values with the imported ones")
    .option("--prune", "remove projects that are absent from the input")
    .option("--dry-run", "report changes without writing")
    .option("--json", "print the report as JSON")
    .action(
      run(
        async (
          options: {
            file?: string;
            overwrite?: boolean;
            prune?: boolean;
            dryRun?: boolean;
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
          const manifest = await load(context, { quiet: options.json });
          const report = await importProjects(manifest, parseImportSource(text), options);

          if (options.json) {
            json(io, {
              added: report.added,
              updated: report.updated,
              missing: report.missing,
              removed: report.removed,
              changed: report.changed,
              written: report.changed && !options.dryRun,
            });
            return 0;
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
          return 0;
        },
      ),
    );
};
