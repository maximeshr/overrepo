import { gitPathExists, readGitFile, trackedTopLevel } from "../git/git.ts";
import type { RepoFiles } from "./types.ts";

/** Files larger than this are never read by detectors. */
const MAX_FILE_BYTES = 1024 * 1024;

function compareEntries(a: string, b: string): number {
  const aDir = a.endsWith("/");
  const bDir = b.endsWith("/");
  if (aDir !== bDir) return aDir ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Creates the file accessor of a cloned repository at `ref`.
 * Every read uses that revision. The working tree is never consulted.
 * A missing revision yields an empty listing.
 */
export async function openRepoFiles(dir: string, ref: string): Promise<RepoFiles> {
  const topLevel = (await trackedTopLevel(dir, ref)) ?? [];
  topLevel.sort(compareEntries);

  const texts = new Map<string, Promise<string | undefined>>();

  const readText = (file: string): Promise<string | undefined> => {
    let cached = texts.get(file);
    if (!cached) {
      cached = readGitFile(dir, ref, file, MAX_FILE_BYTES);
      texts.set(file, cached);
    }
    return cached;
  };

  return {
    topLevel,
    exists: (file) => gitPathExists(dir, ref, file),
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
