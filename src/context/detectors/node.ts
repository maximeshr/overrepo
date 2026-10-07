import type { Detection, Detector } from "../types.ts";
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

function runnerFor(manager: string): string {
  return manager === "yarn" ? "yarn" : `${manager} run`;
}

export const nodeDetector: Detector = {
  id: "node",
  async detect(files) {
    const pkg = await files.readJson<PackageJson>("package.json");
    if (!isRecord(pkg)) return undefined;

    const deps = {
      ...stringRecord(pkg.optionalDependencies),
      ...stringRecord(pkg.peerDependencies),
      ...stringRecord(pkg.devDependencies),
      ...stringRecord(pkg.dependencies),
    };
    const has = (name: string) => name in deps;

    const declared =
      typeof pkg.packageManager === "string"
        ? /^([a-z]+)@/.exec(pkg.packageManager)?.[1]
        : undefined;
    const fromLock = LOCKFILES.find(([lock]) => files.topLevel.includes(lock))?.[1];
    const manager = declared ?? fromLock ?? "npm";

    const detection: Detection = {
      languages: [
        has("typescript") || files.topLevel.includes("tsconfig.json") ? "TypeScript" : "JavaScript",
      ],
      frameworks: known(has, FRAMEWORKS),
      packageManagers: [manager],
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

    const engines = stringRecord(pkg.engines);
    if (engines.node) detection.runtimes = [`Node ${engines.node}`];

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
