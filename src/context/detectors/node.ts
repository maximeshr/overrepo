import type { Detection, Detector, RepoFiles, VersionSpec } from "../types.ts";
import { isRecord, known, stringRecord } from "./util.ts";

interface PackageJson {
  name?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
  engines?: unknown;
  packageManager?: unknown;
  devEngines?: unknown;
  workspaces?: unknown;
}

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

/** Top-level files that pin the Node.js version for version managers (nvm, fnm, nodenv, volta…). */
const NODE_VERSION_FILES = [".nvmrc", ".node-version"] as const;

function runnerFor(manager: string): string {
  return manager === "yarn" ? "yarn" : `${manager} run`;
}

/** First non-empty line of a version file, comments removed. */
export function versionFileValue(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const value = line.replace(/#.*/, "").trim();
    if (value) return value;
  }
  return undefined;
}

/** Parses the Corepack `packageManager` field: `pnpm@10.4.1+sha512.…` → pnpm, 10.4.1. */
export function parsePackageManagerField(
  value: string,
): { name: string; version: string | undefined } | undefined {
  const match = /^([a-z]+)(?:@([^+\s]+)|$)/.exec(value.trim());
  if (!match?.[1]) return undefined;
  return { name: match[1], version: match[2] };
}

/** Entries of a `devEngines` field (`runtime`, `packageManager`): one object or an array of them. */
function devEngineEntries(
  devEngines: unknown,
  key: "runtime" | "packageManager",
): Array<{ name: string; version: string | undefined }> {
  if (!isRecord(devEngines)) return [];
  const value = devEngines[key];
  const entries = Array.isArray(value) ? value : [value];
  return entries.flatMap((entry) =>
    isRecord(entry) && typeof entry.name === "string" && entry.name
      ? [
          {
            name: entry.name,
            version: typeof entry.version === "string" && entry.version ? entry.version : undefined,
          },
        ]
      : [],
  );
}

/** Node.js versions declared by the repository, in order: engines, devEngines, version files. */
async function nodeVersions(
  pkg: PackageJson | undefined,
  files: RepoFiles,
): Promise<VersionSpec[]> {
  const specs: VersionSpec[] = [];
  const engine = stringRecord(pkg?.engines).node;
  if (engine) specs.push({ name: "node", version: engine, source: "package.json#engines.node" });
  for (const entry of devEngineEntries(pkg?.devEngines, "runtime"))
    if (entry.name === "node" && entry.version)
      specs.push({
        name: "node",
        version: entry.version,
        source: "package.json#devEngines.runtime",
      });
  for (const file of NODE_VERSION_FILES) {
    if (!files.topLevel.includes(file)) continue;
    const text = await files.readText(file);
    const version = text === undefined ? undefined : versionFileValue(text);
    if (version) specs.push({ name: "node", version, source: file });
  }
  return specs;
}

/** Human label of a runtime spec, e.g. `Node >=20` (engines) or `Node 20.11.0 (.nvmrc)`. */
function runtimeLabel(spec: VersionSpec): string {
  const source =
    spec.source === "package.json#engines.node"
      ? ""
      : spec.source === "package.json#devEngines.runtime"
        ? " (devEngines)"
        : ` (${spec.source})`;
  return `Node ${spec.version ?? "?"}${source}`;
}

/**
 * Package managers declared by `packageManager` and `devEngines.packageManager`. Without a
 * declaration, the lockfile names the manager but not its version, and npm is the default.
 */
function packageManagerVersions(pkg: PackageJson, files: RepoFiles): VersionSpec[] {
  const specs: VersionSpec[] = [];
  const field =
    typeof pkg.packageManager === "string"
      ? parsePackageManagerField(pkg.packageManager)
      : undefined;
  if (field) specs.push({ ...field, source: "package.json#packageManager" });
  for (const entry of devEngineEntries(pkg.devEngines, "packageManager"))
    specs.push({ ...entry, source: "package.json#devEngines.packageManager" });
  if (specs.length > 0) return specs;
  const lock = LOCKFILES.find(([file]) => files.topLevel.includes(file));
  return [
    lock
      ? { name: lock[1], version: undefined, source: lock[0] }
      : { name: "npm", version: undefined, source: "default" },
  ];
}

export const nodeDetector: Detector = {
  id: "node",
  async detect(files) {
    const json = await files.readJson<PackageJson>("package.json");
    const pkg = isRecord(json) ? (json as PackageJson) : undefined;
    const runtimeVersions = await nodeVersions(pkg, files);
    if (!pkg) {
      // A version file alone still tells which Node.js the repository expects (tooling, CI).
      if (runtimeVersions.length === 0) return undefined;
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
      packages:
        typeof pkg.name === "string" && pkg.name ? [{ ecosystem: "npm", name: pkg.name }] : [],
      notes: [],
    };

    if (runtimeVersions.length > 0) {
      detection.runtimes = runtimeVersions.map(runtimeLabel);
      detection.runtimeVersions = runtimeVersions;
    }

    const workspaces = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : isRecord(pkg.workspaces) && Array.isArray(pkg.workspaces.packages)
        ? pkg.workspaces.packages
        : undefined;
    if (workspaces)
      detection.notes?.push(
        `Monorepo (workspaces: ${workspaces.filter((w) => typeof w === "string").join(", ")})`,
      );
    else if (files.topLevel.includes("pnpm-workspace.yaml"))
      detection.notes?.push("Monorepo (pnpm workspace)");

    return detection;
  },
};
