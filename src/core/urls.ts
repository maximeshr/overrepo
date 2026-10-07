/**
 * Reduces a git remote to `host/owner/repo` (lowercase, no `.git`), so that
 * `git@github.com:Org/Repo.git`, `https://github.com/org/repo` and `github:org/repo` compare equal.
 */
export function normalizeGitUrl(input: string): string | undefined {
  let url = input.trim();
  if (!url) return undefined;
  url = url.replace(/^git\+/, "");

  const shorthand = /^(github|gitlab|bitbucket):([^/\s]+\/[^/\s#]+)/.exec(url);
  if (shorthand) {
    const host = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" }[
      shorthand[1] as "github" | "gitlab" | "bitbucket"
    ];
    return clean(`${host}/${shorthand[2]}`);
  }

  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(url);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return clean(`${scp[1]}/${scp[2]}`);

  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return undefined;
    return clean(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return undefined;
  }
}

function clean(value: string): string {
  return value
    .replace(/#.*$/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}
