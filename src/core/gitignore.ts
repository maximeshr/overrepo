import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const GITIGNORE_BEGIN = "# >>> overrepo (managed) >>>";
export const GITIGNORE_END = "# <<< overrepo (managed) <<<";
/** Temporary clone directories are named `.<name>.overrepo-partial` next to their target. */
export const PARTIAL_SUFFIX = ".overrepo-partial";

function escapePattern(projectPath: string): string {
  return projectPath.replace(/[\\*?[\]!#]/g, (char) => `\\${char}`).replace(/ $/, "\\ ");
}

export function renderGitignoreBlock(projectPaths: string[]): string[] {
  const entries = [...new Set(projectPaths)]
    .sort()
    .map((projectPath) => `/${escapePattern(projectPath)}/`);
  return [GITIGNORE_BEGIN, ...entries, `.*${PARTIAL_SUFFIX}/`, GITIGNORE_END];
}

/** Replaces (or appends) the managed block; everything outside of it is kept byte for byte. */
export function updateGitignoreContent(content: string, projectPaths: string[]): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const block = renderGitignoreBlock(projectPaths).join(eol);
  const begin = content.indexOf(GITIGNORE_BEGIN);
  const end = begin === -1 ? -1 : content.indexOf(GITIGNORE_END, begin);
  if (begin !== -1 && end !== -1) {
    return content.slice(0, begin) + block + content.slice(end + GITIGNORE_END.length);
  }
  if (content === "") return block + eol;
  const separator = content.endsWith(eol) ? eol : eol + eol;
  return content + separator + block + eol;
}

export interface GitignoreUpdate {
  file: string;
  changed: boolean;
}

export async function syncGitignore(
  root: string,
  projectPaths: string[],
  options: { dryRun?: boolean } = {},
): Promise<GitignoreUpdate> {
  const file = path.join(root, ".gitignore");
  const current = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const next = updateGitignoreContent(current, projectPaths);
  const changed = next !== current;
  if (changed && !options.dryRun) await writeFile(file, next);
  return { file, changed };
}
