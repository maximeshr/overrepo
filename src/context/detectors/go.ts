import type { Detection, Detector } from "../types.ts";
import { known } from "./util.ts";

const FRAMEWORKS = [
  ["github.com/gin-gonic/gin", "Gin"],
  ["github.com/labstack/echo", "Echo"],
  ["github.com/gofiber/fiber", "Fiber"],
  ["github.com/go-chi/chi", "chi"],
  ["github.com/gorilla/mux", "gorilla/mux"],
  ["google.golang.org/grpc", "gRPC"],
  ["gorm.io/gorm", "GORM"],
  ["github.com/spf13/cobra", "Cobra"],
] as const;

/** Parses the `module`, `go` and `require` directives of a go.mod file. */
export function parseGoMod(text: string): { module?: string; go?: string; requires: string[] } {
  const result: { module?: string; go?: string; requires: string[] } = { requires: [] };
  let inRequire = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (inRequire) {
      if (line === ")") inRequire = false;
      else if (line.split(/\s+/)[0]) result.requires.push(line.split(/\s+/)[0] as string);
      continue;
    }
    const [directive, ...rest] = line.split(/\s+/);
    if (directive === "module") result.module = rest[0];
    else if (directive === "go") result.go = rest[0];
    else if (directive === "require") {
      if (rest[0] === "(") inRequire = true;
      else if (rest[0]) result.requires.push(rest[0]);
    }
  }
  return result;
}

const stripMajor = (modulePath: string) => modulePath.replace(/\/v\d+$/, "");

export const goDetector: Detector = {
  id: "go",
  async detect(files) {
    const text = await files.readText("go.mod");
    if (text === undefined) return undefined;
    const mod = parseGoMod(text);
    const requires = mod.requires.map(stripMajor);
    const detection: Detection = {
      languages: ["Go"],
      frameworks: known((name) => requires.includes(name), FRAMEWORKS),
      packageManagers: ["go modules"],
      packages: mod.module ? [{ ecosystem: "go", name: stripMajor(mod.module) }] : [],
      dependencies: requires.map((name) => ({ ecosystem: "go", name })),
      references: requires.map((name) => `https://${name}`),
    };
    if (mod.go) detection.runtimes = [`Go ${mod.go}`];
    return detection;
  },
};
