import path from "node:path";
import { init } from "../../core/init.ts";
import { contextOf, positiveInt } from "../options.ts";
import { warn } from "../output.ts";
import type { Register } from "./types.ts";

export const registerInit: Register = (program, run, io) => {
  program
    .command("init")
    .description("create overrepo.yaml from the git repositories found below the current directory")
    .option("--from-mani", "convert an existing mani.yaml instead of scanning")
    .option("--depth <n>", "maximum scan depth", positiveInt, 4)
    .option("-f, --force", "overwrite an existing overrepo.yaml")
    .option("--dry-run", "print the manifest instead of writing it")
    .action(
      run(
        async (
          options: { fromMani?: boolean; depth: number; force?: boolean; dryRun?: boolean },
          command,
        ) => {
          const { cwd } = contextOf(io, command);
          const result = await init({
            root: cwd,
            fromMani: options.fromMani,
            depth: options.depth,
            force: options.force,
            dryRun: options.dryRun,
          });
          for (const warning of result.warnings) warn(io, warning);
          if (options.dryRun) {
            io.write(result.text);
            return 0;
          }
          io.error(
            `${io.colors.green("✔")} wrote ${path.relative(cwd, result.file) || result.file} with ${result.projectCount} project(s)\n`,
          );
          io.error(
            io.colors.dim("next: review it, then run `overrepo sync` and `overrepo context`\n"),
          );
          return 0;
        },
      ),
    );
};
