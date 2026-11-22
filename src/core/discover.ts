import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PARTIAL_SUFFIX } from "./model.ts";
import { toPosixRelative } from "./paths.ts";

const SKIPPED_DIRS = new Set(["node_modules", "vendor", "dist", "build", "target"]);

export interface ScanOptions {
  /** Maximum directory depth below root (root = 0) */
  maxDepth?: number;
  /** POSIX relative paths that must not be descended into */
  ignore?: string[];
}

export interface ScanResult {
  /** POSIX relative paths of git repositories (not descended into) */
  repos: string[];
  /** POSIX relative paths of interrupted clones (`.name.overrepo-partial`) */
  partials: string[];
}

interface Candidate {
  /** An interrupted clone (`.name.overrepo-partial`), never descended into */
  partial: boolean;
  /** Absolute path of the directory entry */
  child: string;
  /** Resolved path, to visit a directory reached through symlinks once */
  real: string;
}

const directoryChild = async (parent: string, entry: Dirent): Promise<string | undefined> => {
  const child = path.join(parent, entry.name);

  if (entry.isSymbolicLink()) {
    try {
      const stats = await stat(child);

      if (!stats.isDirectory()) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    return child;
  }

  return entry.isDirectory() ? child : undefined;
};

/** Walks the tree below `root` looking for git repositories. The root repository itself is ignored. */
export const scanRepos = async (root: string, options: ScanOptions = {}): Promise<ScanResult> => {
  const maxDepth = options.maxDepth ?? 4;
  const ignore = new Set(options.ignore);
  const result: ScanResult = { repos: [], partials: [] };
  const seen = new Set<string>();
  seen.add(await realpath(root).catch(() => path.resolve(root)));

  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Resolved in parallel, then checked in directory order: the first path to a directory wins
    const candidates = await Promise.all(
      entries.map(async (entry): Promise<Candidate | undefined> => {
        const partial = entry.name.endsWith(PARTIAL_SUFFIX) && entry.name.startsWith(".");

        if (!partial && (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name))) {
          return undefined;
        }

        const child = await directoryChild(dir, entry);

        if (child === undefined || child === "") {
          return undefined;
        }

        const real = partial ? child : await realpath(child).catch(() => child);

        return { partial, child, real };
      }),
    );

    const children: string[] = [];

    for (const candidate of candidates) {
      if (candidate === undefined) {
        continue;
      }

      const relative = toPosixRelative(root, candidate.child);

      if (candidate.partial) {
        result.partials.push(relative);
        continue;
      }

      if (ignore.has(relative) || relative === "." || relative.startsWith("../")) {
        continue;
      }

      if (seen.has(candidate.real)) {
        continue;
      }

      seen.add(candidate.real);
      children.push(candidate.child);
    }

    await Promise.all(
      children.map(async (child) => {
        const names = await readdir(child).catch((): string[] => []);

        if (names.includes(".git")) {
          result.repos.push(toPosixRelative(root, child));
        } else if (depth + 1 < maxDepth) {
          await walk(child, depth + 1);
        }
      }),
    );
  };

  await walk(root, 0);
  result.repos.sort();
  result.partials.sort();

  return result;
};
