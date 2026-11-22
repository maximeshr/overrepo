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

interface GoMod {
  module?: string;
  go?: string;
  requires: string[];
}

/** Parses the `module`, `go` and `require` directives of a go.mod file */
const parseGoMod = (text: string): GoMod => {
  const result: GoMod = { requires: [] };
  let inRequire = false;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\/\/.*$/u, "").trim();

    if (!line) {
      continue;
    }

    if (inRequire) {
      if (line === ")") {
        inRequire = false;
      } else {
        const [dependency] = line.split(/\s+/u);

        if (dependency !== undefined && dependency !== "") {
          result.requires.push(dependency);
        }
      }

      continue;
    }

    const [directive, argument] = line.split(/\s+/u);

    if (directive === "module") {
      result.module = argument;
    } else if (directive === "go") {
      result.go = argument;
    } else if (directive === "require") {
      if (argument === "(") {
        inRequire = true;
      } else if (argument !== undefined && argument !== "") {
        result.requires.push(argument);
      }
    }
  }

  return result;
};

const stripMajor = (modulePath: string) => modulePath.replace(/\/v\d+$/u, "");

export const goDetector: Detector = {
  id: "go",
  async detect(files): Promise<Detection | undefined> {
    const text = await files.readText("go.mod");

    if (text === undefined) {
      return undefined;
    }

    const mod = parseGoMod(text);
    const requires = mod.requires.map(stripMajor);

    const detection: Detection = {
      languages: ["Go"],
      frameworks: known((name) => requires.includes(name), FRAMEWORKS),
      packageManagers: ["go modules"],
      packages:
        mod.module !== undefined && mod.module !== ""
          ? [{ ecosystem: "go", name: stripMajor(mod.module) }]
          : [],
      dependencies: requires.map((name) => ({ ecosystem: "go", name })),
      references: requires.map((name) => `https://${name}`),
    };

    if (mod.go !== undefined && mod.go !== "") {
      detection.runtimes = [`Go ${mod.go}`];
    }

    return detection;
  },
};
