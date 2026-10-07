#!/usr/bin/env node
import { processIo } from "./cli/io.ts";
import { runCli } from "./cli/main.ts";

const controller = new AbortController();
let interrupts = 0;
process.on("SIGINT", () => {
  interrupts++;
  // First Ctrl+C: stop scheduling work and let children terminate cleanly. Second one: leave now.
  if (interrupts === 1) controller.abort();
  else process.exit(130);
});
process.on("SIGTERM", () => controller.abort());

process.exitCode = await runCli(process.argv.slice(2), processIo(controller.signal));
