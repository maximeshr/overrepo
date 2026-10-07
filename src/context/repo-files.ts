import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { trackedTopLevel } from "../git/git.ts";
import type { RepoFiles } from "./types.ts";

const UNTRACKED_NOISE = new Set([".git", "node_modules", "vendor", ".DS_Store"]);
/** Files larger than this are never read by detectors. */
const MAX_FILE_BYTES = 1024 * 1024;

function compareEntries(a: string, b: string): number {
  const aDir = a.endsWith("/");
  const bDir = b.endsWith("/");
  if (aDir !== bDir) return aDir ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Creates the file accessor of a cloned repository. The top-level listing comes from
 * `git ls-tree HEAD` (tracked files only, so local build output never leaks into cards),
 * falling back to the working tree for repositories without commits.
 */
export async function openRepoFiles(dir: string): Promise<RepoFiles> {
  let topLevel = await trackedTopLevel(dir);
  if (!topLevel) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    topLevel = entries
      .filter((entry) => !UNTRACKED_NOISE.has(entry.name))
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  }
  topLevel.sort(compareEntries);

  const texts = new Map<string, Promise<string | undefined>>();
  const resolve = (file: string) => path.join(dir, ...file.split("/"));

  const readText = (file: string): Promise<string | undefined> => {
    let cached = texts.get(file);
    if (!cached) {
      cached = (async () => {
        try {
          const info = await stat(resolve(file));
          if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined;
          return await readFile(resolve(file), "utf8");
        } catch {
          return undefined;
        }
      })();
      texts.set(file, cached);
    }
    return cached;
  };

  return {
    topLevel,
    async exists(file) {
      try {
        await stat(resolve(file));
        return true;
      } catch {
        return false;
      }
    },
    readText,
    async readJson<T>(file: string) {
      const text = await readText(file);
      if (text === undefined) return undefined;
      try {
        return JSON.parse(text) as T;
      } catch {
        return undefined;
      }
    },
  };
}
