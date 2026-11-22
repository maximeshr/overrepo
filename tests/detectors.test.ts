import { describe, expect, it } from "vite-plus/test";
import { dockerDetector } from "../src/context/detectors/docker.ts";
import { goDetector } from "../src/context/detectors/go.ts";
import { makeDetector } from "../src/context/detectors/make.ts";
import {
  ciDetector,
  dotnetDetector,
  jvmDetector,
  rubyDetector,
  rustDetector,
} from "../src/context/detectors/misc.ts";
import {
  nodeDetector,
  parsePackageManagerField,
  versionFileValue,
} from "../src/context/detectors/node.ts";
import { phpDetector } from "../src/context/detectors/php.ts";
import { pythonDetector } from "../src/context/detectors/python.ts";
import type { RepoFiles } from "../src/context/types.ts";
import type { JsonValue } from "../src/core/json.ts";
import { resolved } from "./helpers.ts";

/** In-memory repository: keys are root-relative paths, values their contents */
const memoryFiles = (entries: Record<string, string>): RepoFiles => {
  const readText = async (file: string) => await resolved(entries[file]);

  return {
    topLevel: Object.keys(entries)
      .map((file) => (file.includes("/") ? `${file.split("/")[0]}/` : file))
      .filter((file, index, all) => all.indexOf(file) === index)
      .toSorted(),
    exists: async (file) => await resolved(file in entries),
    readText,
    async readJson<T>(file: string): Promise<T | undefined> {
      const text = await readText(file);

      // SAFETY: unchecked by design, like RepoFiles.readJson, the caller names T
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fake of the public RepoFiles.readJson, whose caller names T
      return text === undefined ? undefined : (JSON.parse(text) as T);
    },
  };
};

const pkg = (fields: Record<string, JsonValue>) => JSON.stringify({ name: "app", ...fields });

describe(parsePackageManagerField, () => {
  it.each([
    [
      "pnpm@10.4.1+sha512.c753b6c3ad7afa13af388fa6d808035a008e30ea9993f58c6663e2bc5ff21679",
      "pnpm",
      "10.4.1",
    ],
    ["yarn@4.5.0", "yarn", "4.5.0"],
    ["npm@11.0.0-pre.1", "npm", "11.0.0-pre.1"],
    ["pnpm", "pnpm", undefined],
  ])("%s", (value, name, version) => {
    expect(parsePackageManagerField(value)).toStrictEqual({ name, version });
  });

  it("rejects values that are not a package manager spec", () => {
    expect(parsePackageManagerField("")).toBeUndefined();
    expect(parsePackageManagerField("pnpm-fork@1.0.0")).toBeUndefined();
  });
});

describe(versionFileValue, () => {
  it("keeps the first meaningful line as written", () => {
    expect(versionFileValue("v20.11.0\n")).toBe("v20.11.0");
    expect(versionFileValue("# pinned for CI\n\n  lts/iron  \n22\n")).toBe("lts/iron");
    expect(versionFileValue("\n# only a comment\n")).toBeUndefined();
  });
});

describe("node detector", () => {
  it("reads engines, devEngines, .nvmrc and .node-version with their source", async () => {
    const detection = await nodeDetector.detect(
      memoryFiles({
        "package.json": pkg({
          engines: { node: ">=20" },
          devEngines: { runtime: { name: "node", version: "22.12.0" } },
        }),
        ".nvmrc": "v20.11.0\n",
        ".node-version": "20.11\n",
      }),
    );

    expect(detection?.runtimeVersions).toStrictEqual([
      { name: "node", version: ">=20", source: "package.json#engines.node" },
      { name: "node", version: "22.12.0", source: "package.json#devEngines.runtime" },
      { name: "node", version: "v20.11.0", source: ".nvmrc" },
      { name: "node", version: "20.11", source: ".node-version" },
    ]);
    expect(detection?.runtimes).toStrictEqual([
      "Node >=20",
      "Node 22.12.0 (devEngines)",
      "Node v20.11.0 (.nvmrc)",
      "Node 20.11 (.node-version)",
    ]);
  });

  it("reports a version file even without package.json", async () => {
    const detection = await nodeDetector.detect(
      memoryFiles({ ".nvmrc": "18\n", "composer.json": "{}" }),
    );

    expect(detection).toStrictEqual({
      runtimes: ["Node 18 (.nvmrc)"],
      runtimeVersions: [{ name: "node", version: "18", source: ".nvmrc" }],
    });
    await expect(
      nodeDetector.detect(memoryFiles({ "composer.json": "{}" })),
    ).resolves.toBeUndefined();
  });

  it("ignores version files outside the root and empty ones", async () => {
    const detection = await nodeDetector.detect(
      memoryFiles({ "package.json": pkg({}), ".nvmrc": "\n", "web/.nvmrc": "20\n" }),
    );

    expect(detection?.runtimeVersions).toBeUndefined();
    expect(detection?.runtimes).toBeUndefined();
  });

  it("keeps the packageManager version without the integrity hash", async () => {
    const detection = await nodeDetector.detect(
      memoryFiles({
        "package.json": pkg({
          packageManager: "pnpm@10.4.1+sha512.abcdef",
          scripts: { test: "vitest" },
        }),
        "pnpm-lock.yaml": "",
      }),
    );

    expect(detection?.packageManagers).toStrictEqual(["pnpm"]);
    expect(detection?.packageManagerVersions).toStrictEqual([
      { name: "pnpm", version: "10.4.1", source: "package.json#packageManager" },
    ]);
    expect(detection?.scripts?.[0]?.runner).toBe("pnpm run");
  });

  it("reads devEngines.packageManager as an object or an array", async () => {
    const single = await nodeDetector.detect(
      memoryFiles({
        "package.json": pkg({
          devEngines: { packageManager: { name: "pnpm", version: "^12.0.0" } },
        }),
      }),
    );

    expect(single?.packageManagers).toStrictEqual(["pnpm"]);
    expect(single?.packageManagerVersions).toStrictEqual([
      { name: "pnpm", version: "^12.0.0", source: "package.json#devEngines.packageManager" },
    ]);

    const both = await nodeDetector.detect(
      memoryFiles({
        "package.json": pkg({
          packageManager: "yarn@4.5.0",
          devEngines: { packageManager: [{ name: "yarn" }, { name: "npm", version: "11" }] },
        }),
      }),
    );

    expect(both?.packageManagers).toStrictEqual(["yarn"]);
    expect(both?.packageManagerVersions).toStrictEqual([
      { name: "yarn", version: "4.5.0", source: "package.json#packageManager" },
      { name: "yarn", version: undefined, source: "package.json#devEngines.packageManager" },
      { name: "npm", version: "11", source: "package.json#devEngines.packageManager" },
    ]);
  });

  it("names the manager from the lockfile without guessing its version", async () => {
    const yarn = await nodeDetector.detect(
      memoryFiles({ "package.json": pkg({}), "yarn.lock": "" }),
    );

    expect(yarn?.packageManagers).toStrictEqual(["yarn"]);
    expect(yarn?.packageManagerVersions).toStrictEqual([
      { name: "yarn", version: undefined, source: "yarn.lock" },
    ]);

    const none = await nodeDetector.detect(memoryFiles({ "package.json": pkg({}) }));
    expect(none?.packageManagers).toStrictEqual(["npm"]);
    expect(none?.packageManagerVersions).toStrictEqual([
      { name: "npm", version: undefined, source: "default" },
    ]);
  });
});

describe("ecosystem detectors", () => {
  it.each([
    [
      "go modules",
      goDetector,
      {
        "go.mod":
          "module github.com/acme/svc/v2 // c\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgithub.com/acme/lib v0.1.0 // indirect\n)\nrequire github.com/spf13/cobra v1.0.0\n",
      },
      {
        languages: ["Go"],
        frameworks: ["Gin", "Cobra"],
        packageManagers: ["go modules"],
        packages: [{ ecosystem: "go", name: "github.com/acme/svc" }],
        dependencies: [
          { ecosystem: "go", name: "github.com/gin-gonic/gin" },
          { ecosystem: "go", name: "github.com/acme/lib" },
          { ecosystem: "go", name: "github.com/spf13/cobra" },
        ],
        references: [
          "https://github.com/gin-gonic/gin",
          "https://github.com/acme/lib",
          "https://github.com/spf13/cobra",
        ],
        runtimes: ["Go 1.22"],
      },
    ],
    [
      "Docker base images and Compose services",
      dockerDetector,
      {
        Dockerfile:
          "FROM --platform=linux/amd64 golang:1.22 AS build\nFROM build AS test\nfrom alpine:3.20\n",
        "compose.yaml": "services:\n  web: {}\n  db: {}\n",
      },
      { tools: ["Docker (golang:1.22, alpine:3.20)", "Docker Compose (services: web, db)"] },
    ],
    [
      "Make targets and Taskfile tasks",
      makeDetector,
      {
        Makefile: "build: deps\n\tgo build\n%.o: %.c\n.PHONY: build\ntest:\nx := 1\n",
        "Taskfile.yml": "tasks:\n  lint: {}\n",
      },
      {
        scripts: [
          { runner: "make", name: "build" },
          { runner: "make", name: "test" },
          { runner: "task", name: "lint" },
        ],
      },
    ],
    [
      "Composer with Laravel",
      phpDetector,
      {
        "composer.json": JSON.stringify({
          name: "acme/app",
          require: { php: "^8.2", "laravel/framework": "^11" },
          "require-dev": { "phpunit/phpunit": "^10" },
          scripts: { "pre-install-cmd": "x", test: "phpunit", multi: ["a", "b"] },
          repositories: { r: { type: "vcs", url: "https://github.com/acme/lib" } },
        }),
        artisan: "",
      },
      {
        languages: ["PHP"],
        frameworks: ["Laravel"],
        packageManagers: ["composer"],
        tools: ["PHPUnit"],
        scripts: [
          { runner: "composer run", name: "test", cmd: "phpunit" },
          { runner: "composer run", name: "multi", cmd: undefined },
        ],
        dependencies: [
          { ecosystem: "composer", name: "phpunit/phpunit" },
          { ecosystem: "composer", name: "laravel/framework" },
        ],
        references: ["https://github.com/acme/lib"],
        packages: [{ ecosystem: "composer", name: "acme/app" }],
        runtimes: ["PHP ^8.2"],
      },
    ],
    ["PHP without Composer", phpDetector, { "index.php": "<?php" }, { languages: ["PHP"] }],
    [
      "Python with pyproject.toml",
      pythonDetector,
      {
        "pyproject.toml":
          '[project]\nname = "Py-Svc"\nrequires-python = ">=3.11"\ndependencies = ["fastapi"]\n[tool.poetry]\n',
        "requirements.txt": "django==5\nruff\n",
      },
      {
        languages: ["Python"],
        frameworks: ["Django", "FastAPI"],
        packageManagers: ["pip"],
        tools: ["Ruff"],
        packages: [{ ecosystem: "pypi", name: "py-svc" }],
        runtimes: ["Python >=3.11"],
      },
    ],
    [
      "a Cargo workspace",
      rustDetector,
      {
        "Cargo.toml":
          '[workspace]\n[package]\nname = "rust-svc"\n\n[dependencies]\naxum = "0.7"\ntokio = { version = "1" }\n',
      },
      {
        languages: ["Rust"],
        packageManagers: ["cargo"],
        frameworks: ["Axum", "Tokio"],
        notes: ["Cargo workspace"],
        packages: [{ ecosystem: "cargo", name: "rust-svc" }],
      },
    ],
    [
      "a .NET solution",
      dotnetDetector,
      { "App.sln": "", "Lib.fsproj": "" },
      { languages: ["C#"], packageManagers: ["NuGet"], frameworks: [".NET"] },
    ],
    [
      "an F# project",
      dotnetDetector,
      { "Lib.fsproj": "" },
      { languages: ["F#"], packageManagers: ["NuGet"], frameworks: [".NET"] },
    ],
    [
      "Gradle with Kotlin",
      jvmDetector,
      { "build.gradle.kts": 'kotlin("jvm")\nio.ktor\n' },
      { languages: ["Kotlin"], packageManagers: ["Gradle"], frameworks: ["Ktor"] },
    ],
    [
      "Maven",
      jvmDetector,
      { "pom.xml": "<project><artifactId>spring-boot</artifactId></project>" },
      { languages: ["Java"], packageManagers: ["Maven"], frameworks: ["Spring Boot"] },
    ],
    [
      "Bundler",
      rubyDetector,
      { Gemfile: "gem \"rails\"\n  gem 'rspec'\n" },
      {
        languages: ["Ruby"],
        packageManagers: ["bundler"],
        frameworks: ["Rails"],
        tools: ["RSpec"],
      },
    ],
    [
      "CI providers",
      ciDetector,
      {
        ".github/workflows": "",
        ".gitlab-ci.yml": "",
        Jenkinsfile: "",
        "bitbucket-pipelines.yml": "",
      },
      { tools: ["GitHub Actions", "GitLab CI", "Jenkins", "Bitbucket Pipelines"] },
    ],
  ] as const)("detects %s", async (_name, detector, entries, expected) => {
    await expect(detector.detect(memoryFiles(entries))).resolves.toStrictEqual(expected);
  });

  it("finds nothing in an empty repository", async () => {
    const files = memoryFiles({});

    const detections = await Promise.all(
      [goDetector, dockerDetector, makeDetector, phpDetector, pythonDetector].map(
        async (detector) => await detector.detect(files),
      ),
    );

    expect(detections).toStrictEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
