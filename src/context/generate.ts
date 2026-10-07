import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { OverrepoError } from "../core/errors.ts";
import type { Manifest, Project } from "../core/model.ts";
import { normalizeGitUrl } from "../core/urls.ts";
import { analyzeProject, type Analysis } from "./analyze.ts";
import { extractManual } from "./markdown.ts";
import { renderCard, type DependencyLink } from "./render-card.ts";
import { renderIndex } from "./render-index.ts";
import type { Detector } from "./types.ts";

export type FileStatus = "created" | "updated" | "unchanged" | "stale" | "orphan" | "removed";

export interface ContextFile {
  /** Path relative to the root. */
  path: string;
  status: FileStatus;
  project?: string;
}

export interface ContextOptions {
  /** Cards to (re)generate; the index always covers every project. Defaults to all. */
  projects?: Project[];
  /** Compare instead of writing; stale files are reported with status `stale` / `orphan`. */
  check?: boolean;
  /** Delete cards of projects no longer in the manifest. */
  prune?: boolean;
  concurrency?: number;
  detectors?: Detector[];
}

export interface ContextReport {
  files: ContextFile[];
  /** True when `check` found at least one stale, missing or orphan file. */
  stale: boolean;
}

export function cardPath(manifest: Manifest, project: Project): string {
  return `${manifest.context.outDir}/${project.path}.md`;
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Links projects through published package names and git URLs found in dependency specs. */
export function internalDependencies(
  analyses: Analysis[],
  cardOf: (project: Project) => string,
): Map<string, { uses: DependencyLink[]; usedBy: DependencyLink[] }> {
  const byPackage = new Map<string, Project>();
  const byUrl = new Map<string, Project>();
  for (const analysis of analyses) {
    for (const id of analysis.packages)
      byPackage.set(`${id.ecosystem}:${id.name}`, analysis.project);
    const url = analysis.project.url && normalizeGitUrl(analysis.project.url);
    if (url) byUrl.set(url, analysis.project);
  }

  const links = new Map(
    analyses.map((analysis) => [
      analysis.project.name,
      { uses: new Map<string, DependencyLink>(), usedBy: new Map<string, DependencyLink>() },
    ]),
  );
  const connect = (from: Project, to: Project, via: string) => {
    if (from.name === to.name) return;
    const outgoing = links.get(from.name)?.uses;
    if (outgoing && !outgoing.has(to.name))
      outgoing.set(to.name, { name: to.name, card: cardOf(to), via });
    const incoming = links.get(to.name)?.usedBy;
    if (incoming && !incoming.has(from.name))
      incoming.set(from.name, { name: from.name, card: cardOf(from), via });
  };

  for (const analysis of analyses) {
    for (const id of analysis.dependencies) {
      const target = byPackage.get(`${id.ecosystem}:${id.name}`);
      if (target)
        connect(analysis.project, target, `${id.ecosystem} package ${"`"}${id.name}${"`"}`);
    }
    for (const reference of analysis.references) {
      const url = normalizeGitUrl(reference);
      const target = url ? byUrl.get(url) : undefined;
      if (target) connect(analysis.project, target, "git dependency");
    }
  }

  const byName = (a: DependencyLink, b: DependencyLink) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  return new Map(
    [...links].map(([name, { uses, usedBy }]) => [
      name,
      { uses: [...uses.values()].sort(byName), usedBy: [...usedBy.values()].sort(byName) },
    ]),
  );
}

async function listMarkdown(dir: string, root: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listMarkdown(full, root);
      return entry.name.endsWith(".md")
        ? [path.relative(root, full).split(path.sep).join("/")]
        : [];
    }),
  );
  return files.flat();
}

/** Generates `index.md` and one card per project. Writes only files whose content changed. */
export async function generateContext(
  manifest: Manifest,
  options: ContextOptions = {},
): Promise<ContextReport> {
  const { context, root } = manifest;
  const cardOf = (project: Project) => cardPath(manifest, project);
  const collision = manifest.projects.find((project) => cardOf(project) === context.index);
  if (collision)
    throw new OverrepoError(
      `project "${collision.name}" would overwrite the index (${context.index}); change context.index`,
      2,
    );

  const limit = pLimit(Math.max(1, options.concurrency ?? manifest.defaults.concurrency));
  const analyses = await Promise.all(
    manifest.projects.map((project) =>
      limit(() => analyzeProject(project, context.include, options.detectors)),
    ),
  );
  const dependencies = internalDependencies(analyses, cardOf);

  const files: ContextFile[] = [];
  const emit = async (
    relative: string,
    render: (manual: string | undefined) => string,
    project?: string,
  ) => {
    const absolute = path.join(root, ...relative.split("/"));
    const existing = await readIfExists(absolute);
    const content = render(existing === undefined ? undefined : extractManual(existing));
    if (content === existing) {
      files.push({ path: relative, status: "unchanged", project });
      return;
    }
    if (options.check) {
      files.push({ path: relative, status: "stale", project });
      return;
    }
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
    files.push({ path: relative, status: existing === undefined ? "created" : "updated", project });
  };

  const selected = new Set((options.projects ?? manifest.projects).map((project) => project.name));
  for (const analysis of analyses) {
    if (!selected.has(analysis.project.name)) continue;
    const card = cardOf(analysis.project);
    const deps = dependencies.get(analysis.project.name) ?? { uses: [], usedBy: [] };
    await emit(
      card,
      (manual) =>
        renderCard({
          analysis,
          card,
          uses: deps.uses,
          usedBy: deps.usedBy,
          config: context,
          manual,
        }),
      analysis.project.name,
    );
  }

  await emit(context.index, (manual) =>
    renderIndex({
      projects: manifest.projects,
      index: context.index,
      cardOf,
      manifestName: path.basename(manifest.file),
      manual,
    }),
  );

  const expected = new Set([context.index, ...manifest.projects.map(cardOf)]);
  for (const file of await listMarkdown(path.join(root, ...context.outDir.split("/")), root)) {
    if (expected.has(file)) continue;
    const content = await readIfExists(path.join(root, ...file.split("/")));
    if (!content?.includes("generated-by: overrepo")) continue;
    if (options.prune && !options.check) {
      await rm(path.join(root, ...file.split("/")));
      files.push({ path: file, status: "removed" });
    } else {
      files.push({ path: file, status: "orphan" });
    }
  }

  return {
    files,
    stale: files.some((file) => file.status === "stale" || file.status === "orphan"),
  };
}
