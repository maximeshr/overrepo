import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, isMap, isSeq, YAMLMap } from "yaml";
import { originUrl } from "../git/git.ts";
import { scanRepos } from "./discover.ts";
import { ManifestError, OverrepoError } from "./errors.ts";
import { convertMani } from "./mani.ts";
import { parseManifest, parseManifestDocument } from "./manifest.ts";
import { DEFAULT_CONTEXT, MANI_FILES, MANIFEST_FILES } from "./model.ts";

export interface InitOptions {
  /** Directory that becomes the manifest root. */
  root: string;
  /** Convert an existing `mani.yaml` instead of scanning. */
  fromMani?: boolean;
  /** Overwrite an existing `overrepo.yaml`. */
  force?: boolean;
  dryRun?: boolean;
  /** Scan depth (default 4). */
  depth?: number;
}

export interface InitResult {
  file: string;
  text: string;
  projectCount: number;
  warnings: string[];
  written: boolean;
}

const HEADER = " overrepo manifest — https://github.com/maximeshr/overrepo#manifest";

const DEFAULT_TASKS = {
  pull: { desc: "Fast-forward the current branch", cmd: "git pull --ff-only" },
  status: { desc: "Short git status", cmd: "git status -s" },
};

function sanitizeName(name: string): string {
  return name.replace(/[\s,]+/g, "-");
}

async function readDescription(dir: string): Promise<string | undefined> {
  for (const file of ["package.json", "composer.json"]) {
    try {
      const json = JSON.parse(await readFile(path.join(dir, file), "utf8")) as {
        description?: unknown;
      };
      if (typeof json.description === "string" && json.description.trim())
        return json.description.trim();
    } catch {
      // Missing or invalid file: no description.
    }
  }
  return undefined;
}

/** Builds the manifest document with flow-style tag lists and a header comment. */
export function createManifestDocument(manifest: Record<string, unknown>): Document {
  const doc = new Document(manifest);
  doc.commentBefore = HEADER;
  const projects = doc.get("projects");
  if (isMap(projects)) {
    for (const pair of projects.items) {
      if (!isMap(pair.value)) continue;
      for (const key of ["tags", "owners"]) {
        const list = pair.value.get(key, true);
        if (isSeq(list)) list.flow = true;
      }
    }
    projects.spaceBefore = true;
  }
  const tasks = doc.get("tasks", true);
  if (tasks instanceof YAMLMap) tasks.spaceBefore = true;
  return doc;
}

async function scanManifest(
  root: string,
  depth: number | undefined,
  warnings: string[],
): Promise<Record<string, unknown>> {
  const { repos } = await scanRepos(root, { maxDepth: depth, ignore: [DEFAULT_CONTEXT.outDir] });
  const baseNames = new Map<string, number>();
  for (const repo of repos)
    baseNames.set(path.posix.basename(repo), (baseNames.get(path.posix.basename(repo)) ?? 0) + 1);

  const projects: Record<string, Record<string, unknown>> = {};
  const details = await Promise.all(
    repos.map(async (repo) => {
      const dir = path.join(root, ...repo.split("/"));
      return { repo, url: await originUrl(dir), desc: await readDescription(dir) };
    }),
  );
  for (const { repo, url, desc } of details) {
    const base = path.posix.basename(repo);
    let name = sanitizeName((baseNames.get(base) ?? 0) > 1 ? repo.replaceAll("/", "-") : base);
    for (let suffix = 2; name in projects; suffix++) name = `${sanitizeName(base)}-${suffix}`;
    const parent = path.posix.dirname(repo);
    const project: Record<string, unknown> = { path: repo };
    if (url) project.url = url;
    else warnings.push(`${repo}: no "origin" remote, url left empty (sync will skip it)`);
    if (desc) project.desc = desc;
    if (parent !== ".") project.tags = [sanitizeName(path.posix.basename(parent))];
    projects[name] = project;
  }

  return {
    version: 1,
    defaults: { concurrency: 8, clone: { filter: "blob:none" } },
    context: { outDir: DEFAULT_CONTEXT.outDir },
    gitignore: { sync: true },
    projects,
    tasks: DEFAULT_TASKS,
  };
}

async function maniManifest(root: string, warnings: string[]): Promise<Record<string, unknown>> {
  const maniFile = MANI_FILES.map((name) => path.join(root, name)).find((file) => existsSync(file));
  if (!maniFile) throw new OverrepoError(`--from-mani: no mani.yaml found in ${root}`, 2);
  const { doc } = parseManifestDocument(await readFile(maniFile, "utf8"), maniFile);
  const converted = convertMani(doc.toJS());
  warnings.push(...converted.warnings);
  return {
    context: { outDir: DEFAULT_CONTEXT.outDir },
    gitignore: { sync: true },
    ...converted.manifest,
  };
}

/** Creates `overrepo.yaml` from the git repositories found below `root`, or from `mani.yaml`. */
export async function init(options: InitOptions): Promise<InitResult> {
  const root = path.resolve(options.root);
  const file = path.join(root, MANIFEST_FILES[0]);
  const existing = MANIFEST_FILES.map((name) => path.join(root, name)).find((candidate) =>
    existsSync(candidate),
  );
  if (existing && !options.force && !options.dryRun) {
    throw new OverrepoError(
      `${path.basename(existing)} already exists; use \`overrepo import\` to add projects or --force to overwrite`,
      2,
    );
  }

  const warnings: string[] = [];
  const manifest = options.fromMani
    ? await maniManifest(root, warnings)
    : await scanManifest(root, options.depth, warnings);
  const text = createManifestDocument(manifest).toString({ lineWidth: 0 });

  // Never write something `loadManifest` would reject.
  try {
    parseManifest(text, file, "overrepo");
  } catch (error) {
    if (error instanceof ManifestError) {
      throw new OverrepoError(
        `generated manifest is invalid, nothing was written:\n${error.message}`,
        1,
      );
    }
    throw error;
  }

  if (!options.dryRun) await writeFile(file, text);
  const projectCount = Object.keys(
    (manifest.projects as Record<string, unknown> | undefined) ?? {},
  ).length;
  return { file, text, projectCount, warnings, written: !options.dryRun };
}
