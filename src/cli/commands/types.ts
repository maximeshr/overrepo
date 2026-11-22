import type { Command } from "commander";
import type { Io } from "../io.ts";

/** Registers a sub-command. `run` wraps actions so they can return an exit code. */
export type Register = (
  program: Command,
  run: <A extends unknown[]>(
    action: (...args: A) => Promise<number>,
  ) => (...args: A) => Promise<void>,
  io: Io,
) => void;
