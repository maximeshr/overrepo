import { describe, expect, it } from "vite-plus/test";
import {
  nodeDetector,
  parsePackageManagerField,
  versionFileValue,
} from "../src/context/detectors/node.ts";
import type { RepoFiles } from "../src/context/types.ts";

/** In-memory repository: keys are root-relative paths, values their contents. */
function memoryFiles(entries: Record<string, string>): RepoFiles {
  const readText = async (file: string) => entries[file];
  return {
    topLevel: Object.keys(entries)
      .map((file) => (file.includes("/") ? `${file.split("/")[0]}/` : file))
      .filter((file, index, all) => all.indexOf(file) === index)
      .sort(),
    exists: async (file) => file in entries,
    readText,
    async readJson<T>(file: string) {
      const text = await readText(file);
      return text === undefined ? undefined : (JSON.parse(text) as T);
    },
  };
}

const pkg = (fields: Record<string, unknown>) => JSON.stringify({ name: "app", ...fields });

describe("parsePackageManagerField", () => {
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
    expect(parsePackageManagerField(value)).toEqual({ name, version });
  });

  it("rejects values that are not a package manager spec", () => {
    expect(parsePackageManagerField("")).toBeUndefined();
    expect(parsePackageManagerField("pnpm-fork@1.0.0")).toBeUndefined();
  });
});

describe("versionFileValue", () => {
  it("keeps the first meaningful line as written", () => {
    expect(versionFileValue("v20.11.0\n")).toBe("v20.11.0");
    expect(versionFileValue("# pinned for CI\n\n  lts/iron  \n22\n")).toBe("lts/iron");
    expect(versionFileValue("\n# only a comment\n")).toBeUndefined();
  });
});

describe("nodeDetector", () => {
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
    expect(detection?.runtimeVersions).toEqual([
      { name: "node", version: ">=20", source: "package.json#engines.node" },
      { name: "node", version: "22.12.0", source: "package.json#devEngines.runtime" },
      { name: "node", version: "v20.11.0", source: ".nvmrc" },
      { name: "node", version: "20.11", source: ".node-version" },
    ]);
    expect(detection?.runtimes).toEqual([
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
    expect(detection).toEqual({
      runtimes: ["Node 18 (.nvmrc)"],
      runtimeVersions: [{ name: "node", version: "18", source: ".nvmrc" }],
    });
    expect(await nodeDetector.detect(memoryFiles({ "composer.json": "{}" }))).toBeUndefined();
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
    expect(detection?.packageManagers).toEqual(["pnpm"]);
    expect(detection?.packageManagerVersions).toEqual([
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
    expect(single?.packageManagers).toEqual(["pnpm"]);
    expect(single?.packageManagerVersions).toEqual([
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
    expect(both?.packageManagers).toEqual(["yarn"]);
    expect(both?.packageManagerVersions).toEqual([
      { name: "yarn", version: "4.5.0", source: "package.json#packageManager" },
      { name: "yarn", version: undefined, source: "package.json#devEngines.packageManager" },
      { name: "npm", version: "11", source: "package.json#devEngines.packageManager" },
    ]);
  });

  it("names the manager from the lockfile without guessing its version", async () => {
    const yarn = await nodeDetector.detect(
      memoryFiles({ "package.json": pkg({}), "yarn.lock": "" }),
    );
    expect(yarn?.packageManagers).toEqual(["yarn"]);
    expect(yarn?.packageManagerVersions).toEqual([
      { name: "yarn", version: undefined, source: "yarn.lock" },
    ]);

    const none = await nodeDetector.detect(memoryFiles({ "package.json": pkg({}) }));
    expect(none?.packageManagers).toEqual(["npm"]);
    expect(none?.packageManagerVersions).toEqual([
      { name: "npm", version: undefined, source: "default" },
    ]);
  });
});
