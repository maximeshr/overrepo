import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, isMap, isSeq } from "yaml";
import { originUrl } from "../git/git.ts";
import { scanRepos } from "./discover.ts";
import { ManifestError, OverrepoError } from "./errors.ts";
import { parseManifest } from "./manifest.ts";
import { MANIFEST_FILES } from "./model.ts";

export interface InitOptions {
  /** Directory to scan. Project paths are relative to it. */
  root: string;
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

function sanitizeTag(name: string): string {
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
      const list = pair.value.get("tags", true);
      if (isSeq(list)) list.flow = true;
    }
    projects.spaceBefore = true;
  }
  return doc;
}

async function scanManifest(
  root: string,
  depth: number | undefined,
  warnings: string[],
): Promise<Record<string, unknown>> {
  const { repos } = await scanRepos(root, { maxDepth: depth });
  const projects: Record<string, Record<string, unknown>> = {};
  const details = await Promise.all(
    repos.map(async (repo) => {
      const dir = path.join(root, ...repo.split("/"));
      return { repo, url: await originUrl(dir), desc: await readDescription(dir) };
    }),
  );
  for (const { repo, url, desc } of details) {
    if (!url) {
      warnings.push(`${repo}: no "origin" remote, skipped`);
      continue;
    }
    const project: Record<string, unknown> = { url };
    if (desc) project.desc = desc;
    const parent = path.posix.dirname(repo);
    if (parent !== ".") project.tags = [sanitizeTag(path.posix.basename(parent))];
    projects[repo] = project;
  }
  return { projects };
}

/** Creates `overrepo.yaml` from the git repositories found below `root`. */
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
  const manifest = await scanManifest(root, options.depth, warnings);
  const text = createManifestDocument(manifest).toString({ lineWidth: 0 });

  try {
    parseManifest(text, file);
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
