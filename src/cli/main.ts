import { Command, CommanderError } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { OverrepoError } from "../core/errors.ts";
import { registerDoctor } from "./commands/doctor.ts";
import { registerExec } from "./commands/exec.ts";
import { registerImport } from "./commands/import.ts";
import { registerInit } from "./commands/init.ts";
import { registerList } from "./commands/list.ts";
import { registerStatus } from "./commands/status.ts";
import { registerSync } from "./commands/sync.ts";
import type { Io } from "./io.ts";

/** Exit codes: 0 success, 1 at least one project failed, 2 usage or configuration error, 130 interrupted. */
export async function runCli(argv: string[], io: Io): Promise<number> {
  let exitCode = 0;
  const run =
    (action: (...args: any[]) => Promise<number>) =>
    async (...args: any[]): Promise<void> => {
      exitCode = await action(...args);
    };

  const program = new Command("overrepo")
    .description("Manage a fleet of git repositories from one manifest.")
    .version(pkg.version, "-v, --version")
    .option("-C, --cwd <dir>", "run as if started in <dir>")
    .option("-c, --config <file>", "manifest file (default: overrepo.yaml, searched upwards)")
    .enablePositionalOptions()
    .showHelpAfterError("(run with --help for usage)")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.write(text),
      writeErr: (text) => io.error(text),
      outputError: (text, write) => write(io.colors.red(text)),
    });

  for (const register of [
    registerInit,
    registerSync,
    registerList,
    registerStatus,
    registerExec,
    registerImport,
    registerDoctor,
  ]) {
    register(program, run, io);
  }
  for (const command of program.commands) command.exitOverride();

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version" ||
        error.code === "commander.help"
      )
        return 0;
      return 2;
    }
    if (io.signal.aborted) {
      io.error(io.colors.yellow("interrupted\n"));
      return 130;
    }
    if (error instanceof OverrepoError) {
      io.error(`${io.colors.red("error")} ${error.message}\n`);
      return error.exitCode;
    }
    io.error(
      `${io.colors.red("unexpected error")} ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    return 1;
  }
  if (io.signal.aborted) {
    io.error(
      io.colors.yellow(
        "interrupted: partial clones were cleaned up; run `overrepo doctor` if in doubt\n",
      ),
    );
    return 130;
  }
  return exitCode;
}
