import { gitPathExists, readGitFile, trackedTopLevel } from "../git/git.ts";
import type { RepoFiles } from "./types.ts";

/** Files larger than this are never read by detectors */
const MAX_FILE_BYTES = 1024 * 1024;

const compareEntries = (a: string, b: string): number => {
  const aDir = a.endsWith("/");
  const bDir = b.endsWith("/");

  if (aDir !== bDir) {
    return aDir ? -1 : 1;
  }

  if (a < b) {
    return -1;
  }

  return a > b ? 1 : 0;
};

/**
 * Creates the file accessor of a cloned repository at `ref`.
 * Every read uses that revision. The working tree is never consulted.
 * A missing revision yields an empty listing.
 */
export const openRepoFiles = async (dir: string, ref: string): Promise<RepoFiles> => {
  const topLevel = (await trackedTopLevel(dir, ref)) ?? [];
  topLevel.sort(compareEntries);

  const texts = new Map<string, Promise<string | undefined>>();

  const readText = async (file: string): Promise<string | undefined> => {
    let cached = texts.get(file);

    if (!cached) {
      cached = readGitFile(dir, ref, file, MAX_FILE_BYTES);
      texts.set(file, cached);
    }

    return await cached;
  };

  return {
    topLevel,
    exists: async (file) => await gitPathExists(dir, ref, file),
    readText,
    async readJson<T>(file: string): Promise<T | undefined> {
      const text = await readText(file);

      if (text === undefined) {
        return undefined;
      }

      try {
        // SAFETY: unchecked by design. Like JSON.parse, readJson<T> trusts the T its caller names
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- public RepoFiles API, the caller names T and validates the value
        return JSON.parse(text) as T;
      } catch {
        return undefined;
      }
    },
  };
};
