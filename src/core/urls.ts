/**
 * Reduces a git remote to `host/owner/repo` (lowercase, no `.git`), so that
 * `git@github.com:Org/Repo.git`, `https://github.com/org/repo` and `github:org/repo` compare equal
 */
export const normalizeGitUrl = (input: string): string | undefined => {
  let url = input.trim();

  if (!url) {
    return undefined;
  }

  url = url.replace(/^git\+/u, "");

  const shorthand = /^(?<provider>github|gitlab|bitbucket):(?<repo>[^/\s]+\/[^/\s#]+)/u.exec(
    url,
  )?.groups;

  if (shorthand) {
    const host = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" }[
      shorthand.provider as "github" | "gitlab" | "bitbucket"
    ];

    return clean(`${host}/${shorthand.repo}`);
  }

  const scp = /^(?:[^@/\s]+@)?(?<host>[^:/\s]+):(?!\/\/)(?<repo>.+)$/u.exec(url)?.groups;

  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//iu.test(url)) {
    return clean(`${scp.host}/${scp.repo}`);
  }

  try {
    const parsed = new URL(url);

    if (!parsed.hostname) {
      return undefined;
    }

    return clean(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return undefined;
  }
};

const clean = (value: string): string =>
  value
    .replace(/#.*$/u, "")
    .replace(/\/+$/u, "")
    .replace(/\.git$/iu, "")
    .replaceAll(/\/+/gu, "/")
    .toLowerCase();
