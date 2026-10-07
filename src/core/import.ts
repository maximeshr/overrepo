import { readFile, writeFile } from "node:fs/promises";
import { isMap, isSeq, YAMLMap, type Document } from "yaml";
import { z } from "zod";
import { ManifestError, OverrepoError } from "./errors.ts";
import { parseManifest, parseManifestDocument } from "./manifest.ts";
import type { Manifest } from "./model.ts";
import { normalizeGitUrl } from "./urls.ts";

/**
 * Import format (JSON). Either an array of projects or `{ "projects": [...] }`.
 * Unknown fields are ignored so discovery scripts can emit extra metadata.
 */
export const importProjectSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[^\s,]+$/, "must not contain whitespace or commas"),
  path: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  desc: z.string().optional(),
  tags: z.array(z.string().regex(/^[^\s,]+$/)).optional(),
  owners: z.array(z.string().min(1)).optional(),
  links: z.record(z.string(), z.string().min(1)).optional(),
  sync: z.boolean().optional(),
});

export const importSourceSchema = z.union([
  z.array(importProjectSchema),
  z.object({ projects: z.array(importProjectSchema) }),
]);

export type ImportProject = z.output<typeof importProjectSchema>;

export interface ImportOptions {
  /** Replace existing field values with the source ones (by default only missing fields are filled). */
  overwrite?: boolean;
  /** Remove manifest projects absent from the source. */
  prune?: boolean;
  dryRun?: boolean;
}

export interface ImportReport {
  added: string[];
  /** Project name → updated fields. */
  updated: Record<string, string[]>;
  /** In the manifest but not in the source. */
  missing: string[];
  removed: string[];
  changed: boolean;
  text: string;
}

const FIELDS = ["path", "url", "desc", "tags", "owners", "links", "sync"] as const;

export function parseImportSource(json: string): ImportProject[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new OverrepoError(`import: invalid JSON (${(error as Error).message})`, 2);
  }
  const result = importSourceSchema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new OverrepoError(`import: input does not match the import format:\n${details}`, 2);
  }
  const projects = Array.isArray(result.data) ? result.data : result.data.projects;
  const seen = new Set<string>();
  for (const project of projects) {
    if (seen.has(project.name))
      throw new OverrepoError(`import: duplicate project name "${project.name}"`, 2);
    seen.add(project.name);
  }
  return projects;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function projectsMap(doc: Document): YAMLMap {
  const projects = doc.get("projects", true);
  if (isMap(projects)) return projects;
  const created = new YAMLMap();
  created.spaceBefore = true;
  doc.set("projects", created);
  return created;
}

function setField(doc: Document, project: YAMLMap, key: string, value: unknown): void {
  const node = doc.createNode(value);
  if (isSeq(node)) node.flow = true;
  project.set(key, node);
}

/** Merges external project definitions into the manifest, keeping comments and formatting. */
export async function importProjects(
  manifest: Manifest,
  incoming: ImportProject[],
  options: ImportOptions = {},
): Promise<ImportReport> {
  if (manifest.format === "mani") {
    throw new OverrepoError(
      "import does not write mani.yaml; convert it first with `overrepo init --from-mani`",
      2,
    );
  }
  const original = await readFile(manifest.file, "utf8");
  const { doc } = parseManifestDocument(original, manifest.file);
  const projects = projectsMap(doc);

  const byUrl = new Map<string, string>();
  for (const project of manifest.projects) {
    const key = project.url && normalizeGitUrl(project.url);
    if (key) byUrl.set(key, project.name);
  }
  const known = new Set(manifest.projects.map((project) => project.name));

  const report: ImportReport = {
    added: [],
    updated: {},
    missing: [],
    removed: [],
    changed: false,
    text: original,
  };
  const matched = new Set<string>();

  for (const source of incoming) {
    const urlKey = source.url ? normalizeGitUrl(source.url) : undefined;
    const target = known.has(source.name) ? source.name : urlKey ? byUrl.get(urlKey) : undefined;

    if (target === undefined) {
      const node = new YAMLMap();
      for (const field of FIELDS)
        if (source[field] !== undefined) setField(doc, node, field, source[field]);
      projects.set(source.name, node);
      report.added.push(source.name);
      continue;
    }

    matched.add(target);
    const existing: unknown = projects.get(target, true);
    let map: YAMLMap;
    if (isMap(existing)) {
      map = existing;
    } else {
      map = new YAMLMap();
      projects.set(target, map);
    }
    const fields: string[] = [];
    const currentValues = (map.toJSON() ?? {}) as Record<string, unknown>;
    for (const field of FIELDS) {
      const value = source[field];
      if (value === undefined) continue;
      const current = currentValues[field];
      if (sameValue(current, value)) continue;
      if (current !== undefined && !options.overwrite) continue;
      setField(doc, map, field, value);
      fields.push(field);
    }
    if (fields.length > 0) report.updated[target] = fields;
  }

  report.missing = manifest.projects
    .map((project) => project.name)
    .filter((name) => !matched.has(name));
  if (options.prune) {
    for (const name of report.missing) projects.delete(name);
    report.removed = [...report.missing];
  }

  const text = doc.toString({ lineWidth: 0 });
  report.text = text;
  report.changed = text !== original;

  // Validate the merged result before touching the file.
  try {
    parseManifest(text, manifest.file, "overrepo");
  } catch (error) {
    if (error instanceof ManifestError)
      throw new OverrepoError(
        `import would produce an invalid manifest, nothing was written:\n${error.message}`,
        2,
      );
    throw error;
  }

  if (report.changed && !options.dryRun) await writeFile(manifest.file, text);
  return report;
}
