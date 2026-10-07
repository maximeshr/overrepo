import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isNode, LineCounter, parseDocument, type Document } from "yaml";
import type { z } from "zod";
import { ManifestError, type ManifestIssue } from "./errors.ts";
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_RETRIES,
  DEFAULT_SUMMARY,
  DEFAULT_TIMEOUT_SECONDS,
  MANIFEST_FILES,
  type Manifest,
  type Project,
} from "./model.ts";
import { isInsideDir, normalizeRelativePath } from "./paths.ts";
import { manifestSchema, type RawManifest } from "./schema.ts";

export interface LocateOptions {
  /** Directory to start searching from (walks up to the filesystem root). Defaults to `process.cwd()`. */
  cwd?: string;
  /** Explicit manifest file; disables the search. */
  file?: string;
}

export interface ManifestLocation {
  file: string;
}

/** Finds `overrepo.yaml` in `cwd` or any parent directory. */
export function locateManifest(options: LocateOptions = {}): ManifestLocation | undefined {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (options.file) {
    const file = path.resolve(cwd, options.file);
    return existsSync(file) ? { file } : undefined;
  }
  let dir = cwd;
  for (;;) {
    for (const name of MANIFEST_FILES) {
      const file = path.join(dir, name);
      if (existsSync(file)) return { file };
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
      : `overrepo.yaml in ${options.cwd ?? process.cwd()} or its parents`;
    throw new ManifestError(undefined, [
      { path: "", message: `no manifest found (looked for ${where}); run \`overrepo init\`` },
    ]);
  }
  const text = await readFile(location.file, "utf8");
  return parseManifest(text, location.file);
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
export function parseManifest(text: string, file: string): Manifest {
  const { doc, lineCounter } = parseManifestDocument(text, file);
  const locate = (keyPath: PropertyKey[]): Pick<ManifestIssue, "line" | "column"> =>
    locateNode(doc, lineCounter, keyPath);
  const result = manifestSchema.safeParse(doc.toJS() ?? {});
  if (!result.success) {
    throw new ManifestError(
      displayName(file),
      result.error.issues.map((issue) => toIssue(issue, locate)),
    );
  }
  const manifestDir = path.dirname(path.resolve(file));
  return resolveManifest(result.data, manifestDir, path.resolve(file), locate);
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

function resolveFleetRoot(
  manifestDir: string,
  spec: string | undefined,
): { root: string } | { error: string } {
  if (spec === undefined) return { root: manifestDir };
  const slashed = spec.trim().replaceAll("\\", "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed) || path.isAbsolute(spec)) {
    return { error: `root must be relative to the manifest file, got "${spec}"` };
  }
  return { root: path.resolve(manifestDir, slashed) };
}

function resolveManifest(
  raw: RawManifest,
  manifestDir: string,
  file: string,
  locate: (keyPath: PropertyKey[]) => Pick<ManifestIssue, "line" | "column">,
): Manifest {
  const issues: ManifestIssue[] = [];
  const fleet = resolveFleetRoot(manifestDir, raw.root);
  if ("error" in fleet) {
    issues.push({ path: "root", message: fleet.error, ...locate(["root"]) });
  }
  const root = "error" in fleet ? manifestDir : fleet.root;

  const outDirResult = normalizeRelativePath(raw.summary?.outDir ?? DEFAULT_SUMMARY.outDir);
  const outDir =
    "error" in outDirResult ? (raw.summary?.outDir ?? DEFAULT_SUMMARY.outDir) : outDirResult.path;
  if ("error" in outDirResult) {
    issues.push({
      path: "summary.outDir",
      message: outDirResult.error,
      ...locate(["summary", "outDir"]),
    });
  }
  const summary = {
    outDir,
    index: `${outDir}/index.md`,
    include: [...DEFAULT_SUMMARY.include],
    maxBytes: DEFAULT_SUMMARY.maxBytes,
    readmeMaxChars: DEFAULT_SUMMARY.readmeMaxChars,
    treeMaxEntries: DEFAULT_SUMMARY.treeMaxEntries,
  };
  const outDirAbs = path.resolve(manifestDir, ...outDir.split("/"));

  const projects: Project[] = [];
  const byPath = new Map<string, string>();
  for (const [name, project] of Object.entries(raw.projects)) {
    const normalized = normalizeRelativePath(name);
    const projectPath = "error" in normalized ? name : normalized.path;
    if ("error" in normalized) {
      issues.push({
        path: `projects.${name}`,
        message: normalized.error,
        ...locate(["projects", name]),
      });
    }
    const pathKey = projectPath.toLowerCase();
    const existing = byPath.get(pathKey);
    if (existing !== undefined) {
      issues.push({
        path: `projects.${name}`,
        message: `path "${projectPath}" is already used by project "${existing}"`,
        ...locate(["projects", name]),
      });
    } else {
      byPath.set(pathKey, projectPath);
    }
    const projectDir = path.resolve(root, ...projectPath.split("/"));
    if (!("error" in outDirResult) && isInsideDir(outDirAbs, projectDir)) {
      issues.push({
        path: `projects.${name}`,
        message: `path must not be inside summary.outDir ("${outDir}")`,
        ...locate(["projects", name]),
      });
    }
    projects.push({
      name: projectPath,
      path: projectPath,
      dir: projectDir,
      url: project.url,
      desc: project.desc?.trim() || undefined,
      tags: [...new Set(project.tags ?? [])],
    });
  }

  if (issues.length > 0) throw new ManifestError(displayName(file), issues);

  return {
    root,
    manifestDir,
    file,
    defaults: {
      concurrency: DEFAULT_CONCURRENCY,
      timeout: DEFAULT_TIMEOUT_SECONDS,
      retries: DEFAULT_RETRIES,
    },
    summary,
    projects,
  };
}
