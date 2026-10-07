import { readdir } from "node:fs/promises";
import path from "node:path";
import { PARTIAL_SUFFIX } from "./gitignore.ts";
import { toPosixRelative } from "./paths.ts";

const SKIPPED_DIRS = new Set(["node_modules", "vendor", "dist", "build", "target"]);

export interface ScanOptions {
  /** Maximum directory depth below root (root = 0). */
  maxDepth?: number;
  /** POSIX relative paths that must not be descended into (e.g. `ai/repos`). */
  ignore?: string[];
}

export interface ScanResult {
  /** POSIX relative paths of git repositories (not descended into). */
  repos: string[];
  /** POSIX relative paths of interrupted clones (`.name.overrepo-partial`). */
  partials: string[];
}

/** Walks the tree below `root` looking for git repositories. The root repository itself is ignored. */
export async function scanRepos(root: string, options: ScanOptions = {}): Promise<ScanResult> {
  const maxDepth = options.maxDepth ?? 4;
  const ignore = new Set(options.ignore ?? []);
  const result: ScanResult = { repos: [], partials: [] };

  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const children: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      const relative = toPosixRelative(root, child);
      if (entry.name.endsWith(PARTIAL_SUFFIX) && entry.name.startsWith(".")) {
        result.partials.push(relative);
        continue;
      }
      if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name) || ignore.has(relative))
        continue;
      children.push(child);
    }
    await Promise.all(
      children.map(async (child) => {
        const names = await readdir(child).catch(() => [] as string[]);
        if (names.includes(".git")) result.repos.push(toPosixRelative(root, child));
        else if (depth + 1 < maxDepth) await walk(child, depth + 1);
      }),
    );
  };

  await walk(root, 0);
  result.repos.sort();
  result.partials.sort();
  return result;
}
