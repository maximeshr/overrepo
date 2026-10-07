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

export interface Manifest {
  /**
   * Absolute fleet root. Project directories are resolved from it.
   * Equals `manifestDir` when `root` is omitted.
   */
  root: string;
  /** Absolute directory containing the manifest file. */
  manifestDir: string;
  /** Absolute path of the manifest file. */
  file: string;
  defaults: Defaults;
  projects: Project[];
}

export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const DEFAULT_RETRIES = 2;

/** Temporary clone directories are named `.<name>.overrepo-partial` next to their target. */
export const PARTIAL_SUFFIX = ".overrepo-partial";

export const MANIFEST_FILES = ["overrepo.yaml", "overrepo.yml"] as const;
