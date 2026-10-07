import { isGitRepo } from "../../git/git.ts";
import { contextOf, load, select, withSelection, type SelectionOptions } from "../options.ts";
import { json, table } from "../output.ts";
import type { Register } from "./types.ts";

export const registerList: Register = (program, run, io) => {
  withSelection(
    program
      .command("list")
      .alias("ls")
      .description("list projects (all unless filtered)")
      .option("--json", "print projects as JSON")
      .option("--names", "print project names only, one per line"),
  ).action(
    run(async (options: SelectionOptions & { json?: boolean; names?: boolean }, command) => {
      const manifest = await load(contextOf(io, command), { quiet: options.json });
      const projects = select(manifest, options);
      if (options.json) {
        json(
          io,
          projects.map((project) => ({
            name: project.name,
            path: project.path,
            url: project.url ?? null,
            desc: project.desc ?? null,
            tags: project.tags,
            owners: project.owners,
            links: project.links,
            sync: project.sync,
            cloned: isGitRepo(project.dir),
          })),
        );
        return 0;
      }
      if (options.names) {
        io.write(projects.map((project) => `${project.name}\n`).join(""));
        return 0;
      }
      const { colors } = io;
      const rows = projects.map((project) => [
        isGitRepo(project.dir) ? colors.green("●") : colors.dim("○"),
        colors.bold(project.name),
        project.path,
        colors.cyan(project.tags.join(",")),
        colors.dim(project.desc ?? ""),
      ]);
      io.write(
        table(
          rows,
          ["", "NAME", "PATH", "TAGS", "DESCRIPTION"].map((cell) => colors.dim(cell)),
        ),
      );
      io.error(colors.dim(`${projects.length} project(s), ● cloned ○ not cloned\n`));
      return 0;
    }),
  );
};
