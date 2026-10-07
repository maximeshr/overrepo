import { doctor, type CheckLevel } from "../../core/doctor.ts";
import { contextOf, positiveNumber } from "../options.ts";
import { json } from "../output.ts";
import type { Register } from "./types.ts";

export const registerDoctor: Register = (program, run, io) => {
  program
    .command("doctor")
    .description("check git, remote access, the manifest and the state of the workspace")
    .option("--no-network", "skip remote access checks")
    .option("--timeout <seconds>", "timeout per remote check", positiveNumber, 20)
    .option("--json", "print checks as JSON")
    .action(
      run(async (options: { network: boolean; timeout: number; json?: boolean }, command) => {
        const context = contextOf(io, command);
        const report = await doctor({
          cwd: context.cwd,
          file: context.config,
          network: options.network,
          timeout: options.timeout,
        });
        // An unusable manifest is a configuration error (2), other failures are runtime failures (1).
        const exitCode = !report.manifest ? 2 : report.failed ? 1 : 0;
        if (options.json) {
          json(io, { failed: report.failed, checks: report.checks });
          return exitCode;
        }
        const { colors } = io;
        const icons: Record<CheckLevel, string> = {
          ok: colors.green("✔"),
          info: colors.cyan("ℹ"),
          warn: colors.yellow("!"),
          fail: colors.red("✖"),
        };
        for (const check of report.checks) {
          io.write(`${icons[check.level]} ${check.message}\n`);
          const details = check.details ?? [];
          for (const detail of details.slice(0, 20)) io.write(colors.dim(`    ${detail}\n`));
          if (details.length > 20) io.write(colors.dim(`    … ${details.length - 20} more\n`));
        }
        return exitCode;
      }),
    );
};
