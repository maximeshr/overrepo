export interface Script {
  /** How to invoke it, e.g. `pnpm run`, `composer run`, `make`. */
  runner: string;
  name: string;
  /** Underlying command, when known. */
  cmd?: string;
}

/** A package identity, e.g. `{ ecosystem: "npm", name: "@client/shared" }`. */
export interface PackageId {
  ecosystem: string;
  name: string;
}

export interface Detection {
  languages?: string[];
  frameworks?: string[];
  packageManagers?: string[];
  /** Runtime constraints, e.g. `Node >=20`, `PHP ^8.2`. */
  runtimes?: string[];
  /** Tooling worth knowing: test runners, containers, CI. */
  tools?: string[];
  scripts?: Script[];
  /** Packages this repository publishes / declares. */
  packages?: PackageId[];
  /** Packages this repository depends on. */
  dependencies?: PackageId[];
  /** Raw strings that may contain git URLs of other repositories (dependency specs, VCS repositories…). */
  references?: string[];
  notes?: string[];
}

/** Read-only access to a repository working tree. Paths are POSIX and relative to the repo root. */
export interface RepoFiles {
  /** Top-level entry names (directories end with `/`). */
  readonly topLevel: string[];
  exists(file: string): Promise<boolean>;
  readText(file: string): Promise<string | undefined>;
  readJson<T = unknown>(file: string): Promise<T | undefined>;
}

/** A detector inspects a repository and reports what it recognizes. One detector = one module. */
export interface Detector {
  id: string;
  detect(files: RepoFiles): Promise<Detection | undefined>;
}
