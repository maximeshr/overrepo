import { describe, expect, it } from "vite-plus/test";
import { dockerBaseImages, dockerDetector } from "../src/context/detectors/docker.ts";
import { goDetector } from "../src/context/detectors/go.ts";
import { makeTargets } from "../src/context/detectors/make.ts";
import { nodeDetector } from "../src/context/detectors/node.ts";
import { phpDetector } from "../src/context/detectors/php.ts";
import type { RepoFiles } from "../src/context/types.ts";

function memoryFiles(files: Record<string, string>): RepoFiles {
  const topLevel = [
    ...new Set(
      Object.keys(files).map((file) => (file.includes("/") ? `${file.split("/")[0]}/` : file)),
    ),
  ];
  return {
    topLevel,
    exists: async (file) =>
      Object.keys(files).some((name) => name === file || name.startsWith(`${file}/`)),
    readText: async (file) => files[file],
    readJson: async (file) =>
      files[file] === undefined ? undefined : JSON.parse(files[file] as string),
  };
}

describe("detectors", () => {
  it("node: language, frameworks, package manager, scripts, identity", async () => {
    const detection = await nodeDetector.detect(
      memoryFiles({
        "package.json": JSON.stringify({
          name: "@client/billing-api",
          packageManager: "pnpm@9.0.0",
          engines: { node: ">=20" },
          scripts: { build: "tsc", test: "japa" },
          dependencies: {
            "@adonisjs/core": "^6",
            "@client/shared": "workspace:*",
            sdk: "git+ssh://git@github.com/client/sdk.git",
          },
          devDependencies: { typescript: "^5", vitest: "^2" },
        }),
      }),
    );
    expect(detection).toMatchObject({
      languages: ["TypeScript"],
      frameworks: ["AdonisJS"],
      packageManagers: ["pnpm"],
      runtimes: ["Node >=20"],
      tools: ["Vitest"],
      scripts: [
        { runner: "pnpm run", name: "build", cmd: "tsc" },
        { runner: "pnpm run", name: "test", cmd: "japa" },
      ],
      packages: [{ ecosystem: "npm", name: "@client/billing-api" }],
    });
    expect(detection?.dependencies).toContainEqual({ ecosystem: "npm", name: "@client/shared" });
    expect(detection?.references).toContain("git+ssh://git@github.com/client/sdk.git");
  });

  it("node: falls back to lockfiles and JavaScript", async () => {
    const detection = await nodeDetector.detect(
      memoryFiles({ "package.json": "{}", "yarn.lock": "" }),
    );
    expect(detection).toMatchObject({ languages: ["JavaScript"], packageManagers: ["yarn"] });
  });

  it("php: composer metadata", async () => {
    const detection = await phpDetector.detect(
      memoryFiles({
        "composer.json": JSON.stringify({
          name: "client/billing",
          require: { php: "^8.2", "laravel/framework": "^11" },
          "require-dev": { "pestphp/pest": "^2" },
          scripts: { test: "pest", "post-install-cmd": "x" },
          repositories: [{ type: "vcs", url: "git@github.com:client/sdk-php.git" }],
        }),
      }),
    );
    expect(detection).toMatchObject({
      languages: ["PHP"],
      frameworks: ["Laravel"],
      runtimes: ["PHP ^8.2"],
      tools: ["Pest"],
      scripts: [{ runner: "composer run", name: "test", cmd: "pest" }],
      packages: [{ ecosystem: "composer", name: "client/billing" }],
      references: ["git@github.com:client/sdk-php.git"],
    });
  });

  it("go: go.mod directives", async () => {
    const detection = await goDetector.detect(
      memoryFiles({
        "go.mod":
          "module github.com/client/svc/v2\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0 // web\n\tgithub.com/client/lib v0.1.0\n)\nrequire github.com/spf13/cobra v1.8.0\n",
      }),
    );
    expect(detection).toMatchObject({
      languages: ["Go"],
      frameworks: ["Gin", "Cobra"],
      runtimes: ["Go 1.22"],
      packages: [{ ecosystem: "go", name: "github.com/client/svc" }],
    });
    expect(detection?.references).toContain("https://github.com/client/lib");
  });

  it("docker: base images and compose services", async () => {
    expect(
      dockerBaseImages(
        "FROM node:20 AS build\nFROM --platform=linux/amd64 nginx:alpine\nFROM build\n",
      ),
    ).toEqual(["node:20", "nginx:alpine"]);
    const detection = await dockerDetector.detect(
      memoryFiles({
        Dockerfile: "FROM php:8.3-fpm\n",
        "compose.yaml": "services:\n  app: {}\n  db: {}\n",
      }),
    );
    expect(detection?.tools).toEqual([
      "Docker (php:8.3-fpm)",
      "Docker Compose (services: app, db)",
    ]);
  });

  it("make: explicit targets only", () => {
    expect(
      makeTargets(".PHONY: build\nVAR := 1\nbuild: deps\n\tgo build\n%.o: %.c\ntest:\nCC ?= gcc\n"),
    ).toEqual(["build", "test"]);
  });
});
