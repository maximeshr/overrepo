import { status } from "../../core/status.ts";
import {
  contextOf,
  load,
  positiveInt,
  select,
  withSelection,
  type SelectionOptions,
} from "../options.ts";
import { json, table } from "../output.ts";
import type { Register } from "./types.ts";

export const registerStatus: Register = (program, run, io) => {
  withSelection(
    program
      .command("status")
      .alias("st")
      .description(
        "aggregated git status: branch, ahead/behind, local changes (all unless filtered)",
      )
      .option("-j, --concurrency <n>", "parallel git processes", positiveInt)
      .option("--dirty", "only show projects with local changes or unsynced commits")
      .option("--json", "print status as JSON"),
  ).action(
    run(
      async (
        options: SelectionOptions & { concurrency?: number; dirty?: boolean; json?: boolean },
        command,
      ) => {
        const manifest = await load(contextOf(io, command));
        const results = await status(manifest, {
          projects: select(manifest, options),
          concurrency: options.concurrency,
          signal: io.signal,
        });
        const exitCode = results.some((result) => result.status === "failed") ? 1 : 0;

        const visible = options.dirty
          ? results.filter(
              (result) =>
                result.status === "failed" ||
                (result.value?.state === "present" &&
                  (result.value.changes > 0 || result.value.ahead > 0 || result.value.behind > 0)),
            )
          : results;

        if (options.json) {
          json(
            io,
            visible.map(({ project, status: outcome, value, error }) => ({
              name: project.name,
              path: project.path,
              status: outcome,
              error: error ?? null,
              ...(value?.state === "present"
                ? {
                    state: "present",
                    branch: value.branch ?? null,
                    head: value.head ?? null,
                    upstream: value.upstream ?? null,
                    ahead: value.ahead,
                    behind: value.behind,
                    changes: value.changes,
                    dirty: value.changes > 0,
                  }
                : { state: "absent" }),
            })),
          );
          return exitCode;
        }

        const { colors } = io;
        const rows = visible.map(({ project, status: outcome, value, error }) => {
          if (outcome === "failed")
            return [colors.bold(project.name), colors.red("error"), "", colors.red(error ?? "")];
          if (value?.state !== "present")
            return [colors.bold(project.name), colors.dim("not cloned"), "", ""];
          const branch = value.branch ?? colors.yellow(`detached@${value.head ?? "?"}`);
          const sync = !value.upstream
            ? colors.dim("no upstream")
            : value.ahead === 0 && value.behind === 0
              ? colors.green("✓")
              : [
                  value.ahead ? colors.yellow(`↑${value.ahead}`) : "",
                  value.behind ? colors.magenta(`↓${value.behind}`) : "",
                ]
                  .filter(Boolean)
                  .join(" ");
          const changes =
            value.changes > 0 ? colors.red(`${value.changes} changed`) : colors.dim("clean");
          return [colors.bold(project.name), branch, sync, changes];
        });
        io.write(
          table(
            rows,
            ["PROJECT", "BRANCH", "SYNC", "CHANGES"].map((cell) => colors.dim(cell)),
          ),
        );
        return exitCode;
      },
    ),
  );
};
