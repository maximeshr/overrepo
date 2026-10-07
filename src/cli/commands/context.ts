import { generateContext } from "../../context/generate.ts";
import { contextOf, load, select, withSelection, type SelectionOptions } from "../options.ts";
import { json } from "../output.ts";
import type { Register } from "./types.ts";

export const registerContext: Register = (program, run, io) => {
  withSelection(
    program
      .command("context")
      .description(
        "generate the agent index and one context card per project (all unless filtered)",
      )
      .option("--check", "do not write; exit 1 if any file is outdated (for CI)")
      .option("--prune", "delete cards of projects that left the manifest")
      .option("--json", "print the report as JSON"),
  ).action(
    run(
      async (
        options: SelectionOptions & { check?: boolean; prune?: boolean; json?: boolean },
        command,
      ) => {
        const manifest = await load(contextOf(io, command), { quiet: options.json });
        const report = await generateContext(manifest, {
          projects: select(manifest, options),
          check: options.check,
          prune: options.prune,
        });
        const exitCode = options.check && report.stale ? 1 : 0;

        if (options.json) {
          json(io, { stale: report.stale, files: report.files });
          return exitCode;
        }

        const { colors } = io;
        const labels = {
          created: colors.green("created"),
          updated: colors.cyan("updated"),
          stale: colors.red("stale"),
          orphan: colors.yellow("orphan"),
          removed: colors.yellow("removed"),
        } as const;
        for (const file of report.files) {
          if (file.status === "unchanged") continue;
          io.error(`  ${labels[file.status]} ${file.path}\n`);
        }
        const counts = new Map<string, number>();
        for (const file of report.files)
          counts.set(file.status, (counts.get(file.status) ?? 0) + 1);
        const summary = [...counts].map(([status, count]) => `${count} ${status}`).join(", ");
        io.error(`\ncontext: ${summary}\n`);
        if (options.check && report.stale)
          io.error(
            colors.red("context is outdated: run `overrepo context` and commit the result\n"),
          );
        else if (report.files.some((file) => file.status === "orphan"))
          io.error(
            colors.yellow("orphan cards found: run `overrepo context --prune` to delete them\n"),
          );
        return exitCode;
      },
    ),
  );
};
