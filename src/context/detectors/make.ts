import { parse } from "yaml";
import type { Detector, Script } from "../types.ts";
import { isRecord } from "./util.ts";

const MAKEFILES = ["Makefile", "makefile", "GNUmakefile"];

/** Explicit, non-special targets of a Makefile (`build:`, `test: deps`), in file order. */
export function makeTargets(makefile: string): string[] {
  const targets: string[] = [];
  for (const line of makefile.split("\n")) {
    const match = /^([A-Za-z0-9][A-Za-z0-9_./-]*)\s*:(?![:=])/.exec(line);
    const target = match?.[1];
    if (target && !target.includes("%") && !targets.includes(target)) targets.push(target);
  }
  return targets;
}

export const makeDetector: Detector = {
  id: "make",
  async detect(files) {
    const scripts: Script[] = [];
    const makefile = MAKEFILES.find((file) => files.topLevel.includes(file));
    if (makefile) {
      for (const name of makeTargets((await files.readText(makefile)) ?? ""))
        scripts.push({ runner: "make", name });
    }
    const taskfile = ["Taskfile.yml", "Taskfile.yaml"].find((file) =>
      files.topLevel.includes(file),
    );
    if (taskfile) {
      try {
        const parsed: unknown = parse((await files.readText(taskfile)) ?? "");
        if (isRecord(parsed) && isRecord(parsed.tasks)) {
          for (const name of Object.keys(parsed.tasks)) scripts.push({ runner: "task", name });
        }
      } catch {
        // Ignore unparsable Taskfile.
      }
    }
    return scripts.length > 0 ? { scripts } : undefined;
  },
};
