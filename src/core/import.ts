import { readFile, writeFile } from "node:fs/promises";
import { isMap, isSeq, YAMLMap } from "yaml";
import type { Document } from "yaml";
import { z } from "zod";
import { errorMessage, ManifestError, OverrepoError } from "./errors.ts";
import { isRecord } from "./json.ts";
import type { JsonValue } from "./json.ts";
import { parseManifest, parseManifestDocument } from "./manifest.ts";
import type { Manifest } from "./model.ts";
import { normalizeGitUrl } from "./urls.ts";

/**
 * Import format (JSON). Either an array of projects or `{ "projects": [...] }`.
 * `name` is the project path (the manifest key). Unknown fields are ignored.
 */
const importProjectSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[^\s,]+$/u, "must not contain whitespace or commas"),
  path: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  desc: z.string().optional(),
  tags: z.array(z.string().regex(/^[^\s,]+$/u)).optional(),
});

export const importSourceSchema = z.union([
  z.array(importProjectSchema),
  z.object({ projects: z.array(importProjectSchema) }),
]);

export type ImportProject = z.output<typeof importProjectSchema>;

export interface ImportOptions {
  /** Replace existing field values with the source ones (by default only missing fields are filled) */
  overwrite?: boolean;
  /** Remove manifest projects absent from the source */
  prune?: boolean;
  /** Report the changes without writing the manifest */
  dryRun?: boolean;
}

export interface ImportReport {
  added: string[];
  /** Project name → updated fields */
  updated: Record<string, string[]>;
  /** In the manifest but not in the source */
  missing: string[];
  removed: string[];
  changed: boolean;
  text: string;
}

const FIELDS = ["url", "desc", "tags"] as const;

/** Value of an imported field: `url` and `desc` are strings, `tags` a list */
type FieldValue = string | string[];

export const parseImportSource = (json: string): ImportProject[] => {
  let data: unknown;

  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new OverrepoError(`import: invalid JSON (${errorMessage(error)})`, 2);
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
    if (project.path !== undefined && project.path !== project.name) {
      throw new OverrepoError(
        `import: "${project.name}" is the path; got a different path "${project.path}"`,
        2,
      );
    }

    if (seen.has(project.name)) {
      throw new OverrepoError(`import: duplicate project name "${project.name}"`, 2);
    }

    seen.add(project.name);
  }

  return projects;
};

const sameValue = (current: JsonValue | undefined, value: FieldValue): boolean =>
  JSON.stringify(current) === JSON.stringify(value);

const projectsMap = (doc: Document): YAMLMap => {
  const projects = doc.get("projects", true);

  if (isMap(projects)) {
    // A flow map (`projects: {}`) inlines every project onto one line
    projects.flow = false;

    return projects;
  }

  const created = new YAMLMap();
  created.flow = false;
  created.spaceBefore = true;
  doc.set("projects", created);

  return created;
};

const setField = (doc: Document, project: YAMLMap, key: string, value: FieldValue): void => {
  const node = doc.createNode(value);

  if (isSeq(node)) {
    node.flow = true;
  }

  project.set(key, node);
};

/** Manifest project names by normalized git URL */
const namesByUrl = (manifest: Manifest): Map<string, string> => {
  const byUrl = new Map<string, string>();

  for (const project of manifest.projects) {
    const key = normalizeGitUrl(project.url);

    if (key !== undefined && key !== "") {
      byUrl.set(key, project.name);
    }
  }

  return byUrl;
};

/** The manifest project a source project updates: same name, else same git URL */
const targetOf = (
  source: ImportProject,
  known: Set<string>,
  byUrl: Map<string, string>,
): string | undefined => {
  if (known.has(source.name)) {
    return source.name;
  }

  const urlKey =
    source.url !== undefined && source.url !== "" ? normalizeGitUrl(source.url) : undefined;

  return urlKey !== undefined && urlKey !== "" ? byUrl.get(urlKey) : undefined;
};

const newProject = (doc: Document, source: ImportProject): YAMLMap => {
  if (source.url === undefined || source.url === "") {
    throw new OverrepoError(`import: project "${source.name}" needs a url`, 2);
  }

  const node = new YAMLMap();

  for (const field of FIELDS) {
    const value = source[field];

    if (value !== undefined) {
      setField(doc, node, field, value);
    }
  }

  return node;
};

/** Sets the source fields on an existing project, returns the names of the fields changed */
const updateProject = (
  doc: Document,
  map: YAMLMap,
  source: ImportProject,
  overwrite: boolean,
): string[] => {
  const fields: string[] = [];
  const currentValues: unknown = map.toJSON();

  for (const field of FIELDS) {
    const value = source[field];

    if (value === undefined) {
      continue;
    }

    const current = isRecord(currentValues) ? currentValues[field] : undefined;

    if (sameValue(current, value)) {
      continue;
    }

    if (current !== undefined && !overwrite) {
      continue;
    }

    setField(doc, map, field, value);
    fields.push(field);
  }

  return fields;
};

/** Merges external project definitions into the manifest, keeping comments and formatting */
export const importProjects = async (
  manifest: Manifest,
  incoming: ImportProject[],
  options: ImportOptions = {},
): Promise<ImportReport> => {
  const original = await readFile(manifest.file, "utf-8");
  const { doc } = parseManifestDocument(original, manifest.file);
  const projects = projectsMap(doc);
  const byUrl = namesByUrl(manifest);
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
    const target = targetOf(source, known, byUrl);

    if (target === undefined) {
      projects.set(source.name, newProject(doc, source));
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

    const fields = updateProject(doc, map, source, options.overwrite === true);

    if (fields.length > 0) {
      report.updated[target] = fields;
    }
  }

  report.missing = manifest.projects
    .map((project) => project.name)
    .filter((name) => !matched.has(name));

  if (options.prune === true) {
    for (const name of report.missing) {
      projects.delete(name);
    }

    report.removed = [...report.missing];
  }

  const text = doc.toString({ lineWidth: 0 });
  report.text = text;
  report.changed = text !== original;

  try {
    parseManifest(text, manifest.file);
  } catch (error) {
    if (error instanceof ManifestError) {
      throw new OverrepoError(
        `import would produce an invalid manifest, nothing was written:\n${error.message}`,
        2,
      );
    }

    throw error;
  }

  if (report.changed && options.dryRun !== true) {
    await writeFile(manifest.file, text);
  }

  return report;
};
