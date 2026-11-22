import type { Detection, Detector } from "../types.ts";
import { known } from "./util.ts";

/** Rust (Cargo) */
export const rustDetector: Detector = {
  id: "rust",
  async detect(files): Promise<Detection | undefined> {
    const cargo = await files.readText("Cargo.toml");

    if (cargo === undefined) {
      return undefined;
    }

    const crates = (name: string) => new RegExp(`^${name}\\s*=`, "mu").test(cargo);

    const detection: Detection = {
      languages: ["Rust"],
      packageManagers: ["cargo"],
      frameworks: known(crates, [
        ["axum", "Axum"],
        ["actix-web", "Actix Web"],
        ["rocket", "Rocket"],
        ["tokio", "Tokio"],
      ]),
      notes: /^\[workspace\]/mu.test(cargo) ? ["Cargo workspace"] : [],
    };

    const name = /\[package\][^[]*?^name\s*=\s*"(?<name>[^"]+)"/msu.exec(cargo)?.groups?.name;

    if (name !== undefined && name !== "") {
      detection.packages = [{ ecosystem: "cargo", name }];
    }

    return detection;
  },
};

/** Java / Kotlin (Maven, Gradle) */
export const jvmDetector: Detector = {
  id: "jvm",
  async detect(files): Promise<Detection | undefined> {
    const pom = await files.readText("pom.xml");

    const gradleFile = ["build.gradle.kts", "build.gradle"].find((file) =>
      files.topLevel.includes(file),
    );

    if (pom === undefined && (gradleFile === undefined || gradleFile === "")) {
      return undefined;
    }

    const gradle =
      gradleFile !== undefined && gradleFile !== ""
        ? ((await files.readText(gradleFile)) ?? "")
        : "";

    const corpus = `${pom ?? ""}\n${gradle}`;
    const kotlin = gradleFile === "build.gradle.kts" || /kotlin/iu.test(gradle);

    return {
      languages: kotlin ? ["Kotlin"] : ["Java"],
      packageManagers: [pom === undefined ? "Gradle" : "Maven"],
      frameworks: known(
        (name) => corpus.includes(name),
        [
          ["spring-boot", "Spring Boot"],
          ["quarkus", "Quarkus"],
          ["micronaut", "Micronaut"],
          ["io.ktor", "Ktor"],
        ],
      ),
    };
  },
};

/** Ruby (Bundler) */
export const rubyDetector: Detector = {
  id: "ruby",
  async detect(files): Promise<Detection | undefined> {
    const gemfile = await files.readText("Gemfile");

    if (gemfile === undefined) {
      return undefined;
    }

    const gem = (name: string) => new RegExp(`^\\s*gem\\s+["']${name}["']`, "mu").test(gemfile);

    return {
      languages: ["Ruby"],
      packageManagers: ["bundler"],
      frameworks: known(gem, [
        ["rails", "Rails"],
        ["sinatra", "Sinatra"],
        ["hanami", "Hanami"],
      ]),
      tools: known(gem, [
        ["rspec", "RSpec"],
        ["rubocop", "RuboCop"],
      ]),
    };
  },
};

/** .NET (solution or project at the root) */
export const dotnetDetector: Detector = {
  id: "dotnet",
  // oxlint-disable-next-line eslint/require-await -- Detector.detect returns a promise, and this detector only reads the listing it already has
  async detect(files): Promise<Detection | undefined> {
    const csharp = files.topLevel.some((file) => /\.(?:sln|csproj)$/iu.test(file));
    const fsharp = files.topLevel.some((file) => /\.fsproj$/iu.test(file));

    if (!csharp && !fsharp) {
      return undefined;
    }

    return {
      languages: [fsharp && !csharp ? "F#" : "C#"],
      packageManagers: ["NuGet"],
      frameworks: [".NET"],
    };
  },
};

/** Continuous integration providers */
export const ciDetector: Detector = {
  id: "ci",
  async detect(files): Promise<Detection | undefined> {
    const tools: string[] = [];

    if (files.topLevel.includes(".github/") && (await files.exists(".github/workflows"))) {
      tools.push("GitHub Actions");
    }

    if (files.topLevel.includes(".gitlab-ci.yml")) {
      tools.push("GitLab CI");
    }

    if (files.topLevel.includes("Jenkinsfile")) {
      tools.push("Jenkins");
    }

    if (files.topLevel.includes("bitbucket-pipelines.yml")) {
      tools.push("Bitbucket Pipelines");
    }

    return tools.length > 0 ? { tools } : undefined;
  },
};
