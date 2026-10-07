export interface Project {
  /** Project key. It is the path. */
  name: string;
  /** POSIX path relative to the fleet root, normalized, without a trailing slash. */
  path: string;
  /** Absolute path on disk. */
  dir: string;
  url: string;
  desc: string | undefined;
  tags: string[];
}

export interface Defaults {
  concurrency: number;
  /** Seconds. */
  timeout: number;
  retries: number;
}

export interface SummaryConfig {
  /** POSIX path relative to the manifest file. */
  outDir: string;
  /** POSIX path of the index, relative to the manifest file. */
  index: string;
  include: string[];
  maxBytes: number;
  readmeMaxChars: number;
  treeMaxEntries: number;
}

export interface Manifest {
  /**
   * Absolute fleet root. Project directories are resolved from it.
   * Equals `manifestDir` when `root` is omitted.
   */
  root: string;
  /** Absolute directory containing the manifest file. Summaries are written relative to it. */
  manifestDir: string;
  /** Absolute path of the manifest file. */
  file: string;
  defaults: Defaults;
  summary: SummaryConfig;
  projects: Project[];
}

export const DEFAULT_SUMMARY = {
  outDir: "ai/repos",
  include: [
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "composer.json",
    "go.mod",
    "Dockerfile",
  ],
  maxBytes: 16_000,
  readmeMaxChars: 3_000,
  treeMaxEntries: 40,
} as const;

export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_RETRIES = 2;

/** Temporary clone directories are named `.<name>.overrepo-partial` next to their target. */
export const PARTIAL_SUFFIX = ".overrepo-partial";

export const MANIFEST_FILES = ["overrepo.yaml", "overrepo.yml"] as const;
