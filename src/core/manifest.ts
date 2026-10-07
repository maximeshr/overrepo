import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isNode, LineCounter, parseDocument, type Document } from "yaml";
import type { z } from "zod";
import { ManifestError, type ManifestIssue } from "./errors.ts";
import { convertMani } from "./mani.ts";
import {
  DEFAULT_CLONE,
  DEFAULT_CONCURRENCY,
  DEFAULT_CONTEXT,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECONDS,
  MANI_FILES,
  MANIFEST_FILES,
  type CloneOptions,
  type Manifest,
  type ManifestFormat,
  type Project,
  type Task,
} from "./model.ts";
import { normalizeRelativePath } from "./paths.ts";
import { manifestSchema, type CloneOptionsInput, type RawManifest } from "./schema.ts";

export interface LocateOptions {
  /** Directory to start searching from (walks up to the filesystem root). Defaults to `process.cwd()`. */
  cwd?: string;
  /** Explicit manifest file; disables the search. */
  file?: string;
}

export interface ManifestLocation {
  file: string;
  format: ManifestFormat;
}

function formatOf(file: string): ManifestFormat {
  return /^mani\.ya?ml$/i.test(path.basename(file)) ? "mani" : "overrepo";
}

/** Finds `overrepo.yaml` (preferred) or `mani.yaml` in `cwd` or any parent directory. */
export function locateManifest(options: LocateOptions = {}): ManifestLocation | undefined {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (options.file) {
    const file = path.resolve(cwd, options.file);
    return existsSync(file) ? { file, format: formatOf(file) } : undefined;
  }
  let dir = cwd;
  for (;;) {
    for (const name of [...MANIFEST_FILES, ...MANI_FILES]) {
      const file = path.join(dir, name);
      if (existsSync(file)) return { file, format: formatOf(file) };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function loadManifest(options: LocateOptions = {}): Promise<Manifest> {
  const location = locateManifest(options);
  if (!location) {
    const where = options.file
      ? `"${options.file}"`
      : `overrepo.yaml or mani.yaml in ${options.cwd ?? process.cwd()} or its parents`;
    throw new ManifestError(undefined, [
      { path: "", message: `no manifest found (looked for ${where}); run \`overrepo init\`` },
    ]);
  }
  const text = await readFile(location.file, "utf8");
  return parseManifest(text, location.file, location.format);
}

export interface ParsedDocument {
  doc: Document;
  lineCounter: LineCounter;
}

/** Parses YAML keeping comments, for loss-less rewrites. Throws `ManifestError` on syntax errors. */
export function parseManifestDocument(text: string, file: string): ParsedDocument {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    throw new ManifestError(
      displayName(file),
      doc.errors.map((error) => {
        const pos = lineCounter.linePos(error.pos[0]);
        return {
          path: "",
          message: error.message.split("\n")[0] ?? error.message,
          line: pos.line,
          column: pos.col,
        };
      }),
    );
  }
  return { doc, lineCounter };
}

/** Validates manifest text and resolves it into the runtime model. */
export function parseManifest(
  text: string,
  file: string,
  format: ManifestFormat = formatOf(file),
): Manifest {
  const { doc, lineCounter } = parseManifestDocument(text, file);
  const raw: unknown = doc.toJS() ?? {};
  const warnings: string[] = [];
  let input = raw;
  if (format === "mani") {
    const converted = convertMani(raw);
    input = converted.manifest;
    warnings.push(...converted.warnings);
  }

  const locate = (keyPath: PropertyKey[]): Pick<ManifestIssue, "line" | "column"> =>
    locateNode(doc, lineCounter, keyPath);
  const result = manifestSchema.safeParse(input);
  if (!result.success) {
    throw new ManifestError(
      displayName(file),
      result.error.issues.map((issue) => toIssue(issue, locate)),
    );
  }
  return resolveManifest(
    result.data,
    path.dirname(path.resolve(file)),
    path.resolve(file),
    format,
    warnings,
    locate,
  );
}

function displayName(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith("..") ? relative : file;
}

function toIssue(
  issue: z.core.$ZodIssue,
  locate: (keyPath: PropertyKey[]) => Pick<ManifestIssue, "line" | "column">,
): ManifestIssue {
  let keyPath = issue.path;
  let message = issue.message;
  if (issue.code === "unrecognized_keys") {
    message = `unknown key${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((key) => `"${key}"`).join(", ")}`;
    if (issue.keys.length === 1) keyPath = [...issue.path, issue.keys[0] as string];
  }
  return { path: keyPath.map(String).join("."), message, ...locate(keyPath) };
}

/** Maps a key path to the closest YAML node position (falls back to parents when the key is missing). */
function locateNode(
  doc: Document,
  lineCounter: LineCounter,
  keyPath: PropertyKey[],
): Pick<ManifestIssue, "line" | "column"> {
  for (let depth = keyPath.length; depth >= 0; depth--) {
    const node: unknown =
      depth === 0 ? doc.contents : doc.getIn(keyPath.slice(0, depth) as unknown[], true);
    if (isNode(node) && node.range) {
      const pos = lineCounter.linePos(node.range[0]);
      return { line: pos.line, column: pos.col };
    }
  }
  return {};
}

function resolveClone(base: CloneOptions, override: CloneOptionsInput | undefined): CloneOptions {
  if (!override) return base;
  return {
    depth: override.depth === undefined ? base.depth : override.depth,
    filter: override.filter === undefined ? base.filter : override.filter,
    branch: override.branch === undefined ? base.branch : override.branch,
  };
}

function resolveManifest(
  raw: RawManifest,
  root: string,
  file: string,
  format: ManifestFormat,
  warnings: string[],
  locate: (keyPath: PropertyKey[]) => Pick<ManifestIssue, "line" | "column">,
): Manifest {
  const issues: ManifestIssue[] = [];
  const relPath = (value: string, keyPath: string[]): string => {
    const normalized = normalizeRelativePath(value);
    if ("error" in normalized) {
      issues.push({ path: keyPath.join("."), message: normalized.error, ...locate(keyPath) });
      return value;
    }
    return normalized.path;
  };

  const defaults = {
    clone: resolveClone(DEFAULT_CLONE, raw.defaults?.clone),
    concurrency: raw.defaults?.concurrency ?? DEFAULT_CONCURRENCY,
    timeout: raw.defaults?.timeout ?? DEFAULT_TIMEOUT_SECONDS,
    retries: raw.defaults?.retries ?? DEFAULT_RETRIES,
  };

  const outDir = relPath(raw.context?.outDir ?? DEFAULT_CONTEXT.outDir, ["context", "outDir"]);
  const context = {
    outDir,
    index: raw.context?.index
      ? relPath(raw.context.index, ["context", "index"])
      : `${outDir}/index.md`,
    include: raw.context?.include ?? [...DEFAULT_CONTEXT.include],
    maxBytes: raw.context?.maxBytes ?? DEFAULT_CONTEXT.maxBytes,
    readmeMaxChars: raw.context?.readmeMaxChars ?? DEFAULT_CONTEXT.readmeMaxChars,
    treeMaxEntries: raw.context?.treeMaxEntries ?? DEFAULT_CONTEXT.treeMaxEntries,
  };

  const projects: Project[] = [];
  const byPath = new Map<string, string>();
  for (const [name, value] of Object.entries(raw.projects ?? {})) {
    const project = value ?? {};
    const projectPath = relPath(project.path ?? name, [
      "projects",
      name,
      ...(project.path ? ["path"] : []),
    ]);
    const pathKey = projectPath.toLowerCase();
    const existing = byPath.get(pathKey);
    if (existing !== undefined) {
      const keyPath = ["projects", name, "path"];
      issues.push({
        path: keyPath.join("."),
        message: `path "${projectPath}" is already used by project "${existing}"`,
        ...locate(keyPath),
      });
    } else {
      byPath.set(pathKey, name);
    }
    if (projectPath === outDir || projectPath.startsWith(`${outDir}/`)) {
      const keyPath = ["projects", name, "path"];
      issues.push({
        path: keyPath.join("."),
        message: `path must not be inside context.outDir ("${outDir}")`,
        ...locate(keyPath),
      });
    }
    projects.push({
      name,
      path: projectPath,
      dir: path.join(root, ...projectPath.split("/")),
      url: project.url,
      desc: project.desc?.trim() || undefined,
      tags: [...new Set(project.tags ?? [])],
      owners: [...new Set(project.owners ?? [])],
      links: project.links ?? {},
      sync: project.sync ?? true,
      clone: resolveClone(defaults.clone, project.clone),
    });
  }

  if (issues.length > 0) throw new ManifestError(displayName(file), issues);

  const tasks: Record<string, Task> = {};
  for (const [name, task] of Object.entries(raw.tasks ?? {})) {
    tasks[name] =
      typeof task === "string"
        ? { name, desc: undefined, cmd: task }
        : { name, desc: task.desc, cmd: task.cmd };
  }

  return {
    root,
    file,
    format,
    defaults,
    context,
    gitignore: { sync: raw.gitignore?.sync ?? true },
    projects,
    tasks,
    warnings,
  };
}
