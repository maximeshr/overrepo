import picocolors from "picocolors";

export type Colors = ReturnType<typeof picocolors.createColors>;

export interface Io {
  cwd: string;
  write(text: string): void;
  error(text: string): void;
  /** Reads all of stdin (for `import`). */
  readStdin(): Promise<string>;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  /** Progress bars are drawn on stderr only when it is a terminal. */
  stderrIsTTY: boolean;
  colors: Colors;
  /** Aborted on Ctrl+C. */
  signal: AbortSignal;
}

export function processIo(signal: AbortSignal): Io {
  return {
    cwd: process.cwd(),
    write: (text) => process.stdout.write(text),
    error: (text) => process.stderr.write(text),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      return Buffer.concat(chunks).toString("utf8");
    },
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    stderrIsTTY: Boolean(process.stderr.isTTY),
    colors: picocolors.createColors(picocolors.isColorSupported),
    signal,
  };
}
