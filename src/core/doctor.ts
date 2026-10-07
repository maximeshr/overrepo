import path from "node:path";
import pLimit from "p-limit";
import { gitVersion, isDirectory, isGitRepo, lsRemote } from "../git/git.ts";
import { scanRepos } from "./discover.ts";
import { errorMessage } from "./errors.ts";
import { loadManifest, type LocateOptions } from "./manifest.ts";
import type { Manifest } from "./model.ts";
import { isInsideDir, isWithin } from "./paths.ts";
import { normalizeGitUrl } from "./urls.ts";

export type CheckLevel = "ok" | "info" | "warn" | "fail";

export interface Check {
  id: string;
  level: CheckLevel;
  message: string;
  details?: string[];
}

export interface DoctorOptions extends LocateOptions {
  /** Skip remote access checks. */
  network?: boolean;
  /** Seconds per remote check. */
  timeout?: number;
}

export interface DoctorReport {
  checks: Check[];
  manifest: Manifest | undefined;
  failed: boolean;
}

/** The manifest's own git (when it lives under the fleet root) is not a leaf clone. */
function scanIgnores(manifest: Manifest): string[] {
  const absolute = manifest.manifestDir;
  if (
    !isInsideDir(manifest.root, absolute) ||
    path.resolve(absolute) === path.resolve(manifest.root)
  ) {
    return [];
  }
  const relative = path.relative(manifest.root, absolute).split(path.sep).join("/");
  return relative ? [relative] : [];
}

/** Remote checks run once per host; local remotes (`file://`, paths) count as one "local" host. */
function hostOf(url: string): string | undefined {
  if (url.startsWith("file:") || path.isAbsolute(url)) return "local";
  return normalizeGitUrl(url)?.split("/")[0];
}

export async function doctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);

  const version = await gitVersion();
  add(
    version
      ? { id: "git", level: "ok", message: `git ${version}` }
      : { id: "git", level: "fail", message: "git not found in PATH" },
  );

  let manifest: Manifest | undefined;
  try {
    manifest = await loadManifest(options);
    add({
      id: "manifest",
      level: "ok",
      message: `${path.basename(manifest.file)} is valid (${manifest.projects.length} projects)`,
    });
  } catch (error) {
    add({ id: "manifest", level: "fail", message: errorMessage(error) });
  }
  if (!manifest || !version) return { checks, manifest, failed: true };

  const missing = manifest.projects.filter((project) => !isDirectory(project.dir));
  const notRepos = manifest.projects.filter(
    (project) => isDirectory(project.dir) && !isGitRepo(project.dir),
  );
  add(
    missing.length === 0
      ? { id: "clones", level: "ok", message: "every project is cloned" }
      : {
          id: "clones",
          level: "info",
          message: `${missing.length} project(s) not cloned yet (run \`overrepo sync\`)`,
          details: missing.map((project) => project.path),
        },
  );
  if (notRepos.length > 0) {
    add({
      id: "not-a-repo",
      level: "fail",
      message: `${notRepos.length} project path(s) exist but are not git repositories`,
      details: notRepos.map((project) => project.path),
    });
  }

  const scan = await scanRepos(manifest.root, {
    maxDepth: 6,
    ignore: scanIgnores(manifest),
  });
  const known = manifest.projects.map((project) => project.path);
  const orphans = scan.repos.filter(
    (repo) => !known.some((projectPath) => isWithin(repo, projectPath)),
  );
  add(
    orphans.length === 0
      ? { id: "orphans", level: "ok", message: "no orphan repositories" }
      : {
          id: "orphans",
          level: "warn",
          message: `${orphans.length} repositor${orphans.length === 1 ? "y is" : "ies are"} on disk but not in the manifest`,
          details: orphans,
        },
  );
  add(
    scan.partials.length === 0
      ? { id: "partial-clones", level: "ok", message: "no interrupted clones" }
      : {
          id: "partial-clones",
          level: "fail",
          message: `${scan.partials.length} interrupted clone(s) left on disk; delete them and run \`overrepo sync\``,
          details: scan.partials,
        },
  );

  if (options.network !== false) {
    const byHost = new Map<string, string>();
    for (const project of manifest.projects) {
      const host = hostOf(project.url);
      if (host && !byHost.has(host)) byHost.set(host, project.url);
    }
    const limit = pLimit(4);
    await Promise.all(
      [...byHost].map(([host, url]) =>
        limit(async () => {
          try {
            await lsRemote(url, { timeout: (options.timeout ?? 20) * 1000 });
            add({ id: `access:${host}`, level: "ok", message: `access to ${host} works (${url})` });
          } catch (error) {
            add({
              id: `access:${host}`,
              level: "fail",
              message: `cannot access ${host}: ${errorMessage(error)}`,
              details: [`tested with ${url}`],
            });
          }
        }),
      ),
    );
  }

  return { checks, manifest, failed: checks.some((check) => check.level === "fail") };
}
