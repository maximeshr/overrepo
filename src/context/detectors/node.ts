import type { Detection, Detector, RepoFiles, VersionSpec } from "../types.ts";
import { isObject, isRecord, isString } from "../../core/json.ts";
import { known, stringRecord } from "./util.ts";
import type { JsonObject, JsonValue } from "../../core/json.ts";

const FRAMEWORKS = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@nestjs/core", "NestJS"],
  ["@adonisjs/core", "AdonisJS"],
  ["@remix-run/react", "Remix"],
  ["@sveltejs/kit", "SvelteKit"],
  ["astro", "Astro"],
  ["gatsby", "Gatsby"],
  ["@strapi/strapi", "Strapi"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["koa", "Koa"],
  ["hono", "Hono"],
  ["@apollo/server", "Apollo Server"],
  ["@angular/core", "Angular"],
  ["react-native", "React Native"],
  ["expo", "Expo"],
  ["electron", "Electron"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["solid-js", "Solid"],
  ["@prisma/client", "Prisma"],
  ["prisma", "Prisma"],
  ["drizzle-orm", "Drizzle ORM"],
  ["typeorm", "TypeORM"],
  ["sequelize", "Sequelize"],
  ["mongoose", "Mongoose"],
] as const;

const TOOLS = [
  ["vite", "Vite"],
  ["vite-plus", "Vite+"],
  ["webpack", "webpack"],
  ["vitest", "Vitest"],
  ["jest", "Jest"],
  ["mocha", "Mocha"],
  ["@japa/runner", "Japa"],
  ["@playwright/test", "Playwright"],
  ["cypress", "Cypress"],
  ["storybook", "Storybook"],
  ["eslint", "ESLint"],
  ["@biomejs/biome", "Biome"],
  ["prettier", "Prettier"],
] as const;

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
] as const;

/** Top-level files that pin the Node.js version for version managers (nvm, fnm, nodenv, volta…) */
const NODE_VERSION_FILES = [".nvmrc", ".node-version"] as const;

const runnerFor = (manager: string): string => (manager === "yarn" ? "yarn" : `${manager} run`);

/** First non-empty line of a version file, comments removed */
export const versionFileValue = (text: string): string | undefined => {
  for (const line of text.split(/\r?\n/u)) {
    const value = line.replace(/#.*/u, "").trim();

    if (value) {
      return value;
    }
  }

  return undefined;
};

/** Parses the Corepack `packageManager` field: `pnpm@10.4.1+sha512.…` → pnpm, 10.4.1 */
export const parsePackageManagerField = (
  value: string,
): { name: string; version: string | undefined } | undefined => {
  const groups = /^(?<name>[a-z]+)(?:@(?<version>[^+\s]+)|$)/u.exec(value.trim())?.groups;

  if (groups?.name === undefined || groups.name === "") {
    return undefined;
  }

  return { name: groups.name, version: groups.version };
};

/** Entries of a `devEngines` field (`runtime`, `packageManager`): one object or an array of them */
const devEngineEntries = (
  devEngines: JsonValue | undefined,
  key: "runtime" | "packageManager",
): { name: string; version: string | undefined }[] => {
  if (!isObject(devEngines)) {
    return [];
  }

  const value = devEngines[key];
  const entries = Array.isArray(value) ? value : [value];

  return entries.flatMap((entry) =>
    isObject(entry) && isString(entry.name) && entry.name !== ""
      ? [
          {
            name: entry.name,
            version: isString(entry.version) && entry.version !== "" ? entry.version : undefined,
          },
        ]
      : [],
  );
};

/** Node.js versions declared by the repository, in order: engines, devEngines, version files */
const nodeVersions = async (
  pkg: JsonObject | undefined,
  files: RepoFiles,
): Promise<VersionSpec[]> => {
  const specs: VersionSpec[] = [];
  const engine = stringRecord(pkg?.engines).node;

  if (engine !== undefined && engine !== "") {
    specs.push({ name: "node", version: engine, source: "package.json#engines.node" });
  }

  for (const entry of devEngineEntries(pkg?.devEngines, "runtime")) {
    if (entry.name === "node" && entry.version !== undefined && entry.version !== "") {
      specs.push({
        name: "node",
        version: entry.version,
        source: "package.json#devEngines.runtime",
      });
    }
  }

  const texts = await Promise.all(
    NODE_VERSION_FILES.map(async (file) =>
      files.topLevel.includes(file) ? await files.readText(file) : undefined,
    ),
  );

  for (const [index, file] of NODE_VERSION_FILES.entries()) {
    const text = texts[index];
    const version = text === undefined ? undefined : versionFileValue(text);

    if (version !== undefined && version !== "") {
      specs.push({ name: "node", version, source: file });
    }
  }

  return specs;
};

/** Human label of a runtime spec, e.g. `Node >=20` (engines) or `Node 20.11.0 (.nvmrc)`. */
const runtimeLabel = (spec: VersionSpec): string => {
  let source = ` (${spec.source})`;

  if (spec.source === "package.json#engines.node") {
    source = "";
  } else if (spec.source === "package.json#devEngines.runtime") {
    source = " (devEngines)";
  }

  return `Node ${spec.version ?? "?"}${source}`;
};

/**
 * Package managers declared by `packageManager` and `devEngines.packageManager`. Without a
 * declaration, the lockfile names the manager but not its version, and npm is the default.
 */
const packageManagerVersions = (pkg: JsonObject, files: RepoFiles): VersionSpec[] => {
  const specs: VersionSpec[] = [];

  const field = isString(pkg.packageManager)
    ? parsePackageManagerField(pkg.packageManager)
    : undefined;

  if (field) {
    specs.push({ ...field, source: "package.json#packageManager" });
  }

  for (const entry of devEngineEntries(pkg.devEngines, "packageManager")) {
    specs.push({ ...entry, source: "package.json#devEngines.packageManager" });
  }

  if (specs.length > 0) {
    return specs;
  }

  const lock = LOCKFILES.find(([file]) => files.topLevel.includes(file));

  return [
    lock
      ? { name: lock[1], version: undefined, source: lock[0] }
      : { name: "npm", version: undefined, source: "default" },
  ];
};

/** `workspaces` as an array, or the `packages` array of its object form */
const workspacePatterns = (workspaces: JsonValue | undefined): JsonValue[] | undefined => {
  if (Array.isArray(workspaces)) {
    return workspaces;
  }

  if (isObject(workspaces) && Array.isArray(workspaces.packages)) {
    return workspaces.packages;
  }

  return undefined;
};

export const nodeDetector: Detector = {
  id: "node",
  async detect(files): Promise<Detection | undefined> {
    const json = await files.readJson("package.json");
    const pkg = isRecord(json) ? json : undefined;
    const runtimeVersions = await nodeVersions(pkg, files);

    if (!pkg) {
      // A version file alone still tells which Node.js the repository expects (tooling, CI)
      if (runtimeVersions.length === 0) {
        return undefined;
      }

      return { runtimes: runtimeVersions.map(runtimeLabel), runtimeVersions };
    }

    const deps = {
      ...stringRecord(pkg.optionalDependencies),
      ...stringRecord(pkg.peerDependencies),
      ...stringRecord(pkg.devDependencies),
      ...stringRecord(pkg.dependencies),
    };

    const has = (name: string) => name in deps;

    const managers = packageManagerVersions(pkg, files);
    const manager = managers[0]?.name ?? "npm";

    const detection: Detection = {
      languages: [
        has("typescript") || files.topLevel.includes("tsconfig.json") ? "TypeScript" : "JavaScript",
      ],
      frameworks: known(has, FRAMEWORKS),
      packageManagers: [manager],
      packageManagerVersions: managers,
      tools: known(has, TOOLS),
      scripts: Object.entries(stringRecord(pkg.scripts)).map(([name, cmd]) => ({
        runner: runnerFor(manager),
        name,
        cmd,
      })),
      dependencies: Object.keys(deps).map((name) => ({ ecosystem: "npm", name })),
      references: Object.values(deps),
      packages: isString(pkg.name) && pkg.name !== "" ? [{ ecosystem: "npm", name: pkg.name }] : [],
      notes: [],
    };

    if (runtimeVersions.length > 0) {
      detection.runtimes = runtimeVersions.map(runtimeLabel);
      detection.runtimeVersions = runtimeVersions;
    }

    const workspaces = workspacePatterns(pkg.workspaces);

    if (workspaces) {
      detection.notes?.push(
        `Monorepo (workspaces: ${workspaces.filter((w) => isString(w)).join(", ")})`,
      );
    } else if (files.topLevel.includes("pnpm-workspace.yaml")) {
      detection.notes?.push("Monorepo (pnpm workspace)");
    }

    return detection;
  },
};
