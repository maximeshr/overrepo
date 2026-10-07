export interface CloneOptions {
  /** `null` = full history. */
  depth: number | null;
  /** `null` = no partial clone. */
  filter: string | null;
  /** `null` = remote default branch. */
  branch: string | null;
}

export interface Project {
  name: string;
  /** POSIX path relative to the manifest root, normalized, without trailing slash. */
  path: string;
  /** Absolute path on disk. */
  dir: string;
  url: string | undefined;
  desc: string | undefined;
  tags: string[];
  owners: string[];
  links: Record<string, string>;
  /** `false` = listed but never cloned by `sync`. */
  sync: boolean;
  clone: CloneOptions;
}

export interface Task {
  name: string;
  desc: string | undefined;
  cmd: string;
}

export interface ContextConfig {
  /** POSIX path relative to root. */
  outDir: string;
  /** POSIX path relative to root. */
  index: string;
  include: string[];
  maxBytes: number;
  readmeMaxChars: number;
  treeMaxEntries: number;
}

export interface Defaults {
  clone: CloneOptions;
  concurrency: number;
  /** Seconds. */
  timeout: number;
  retries: number;
}

export type ManifestFormat = "overrepo" | "mani";

export interface Manifest {
  /** Absolute directory containing the manifest; every project path is relative to it. */
  root: string;
  /** Absolute path of the manifest file. */
  file: string;
  format: ManifestFormat;
  defaults: Defaults;
  context: ContextConfig;
  gitignore: { sync: boolean };
  projects: Project[];
  tasks: Record<string, Task>;
  /** Non-fatal remarks (e.g. ignored mani keys). */
  warnings: string[];
}

export const DEFAULT_CLONE: CloneOptions = { depth: null, filter: "blob:none", branch: null };

export const DEFAULT_CONTEXT = {
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

export const MANIFEST_FILES = ["overrepo.yaml", "overrepo.yml"] as const;
export const MANI_FILES = ["mani.yaml", "mani.yml"] as const;
