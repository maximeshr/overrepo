export interface Script {
  /** How to invoke it, e.g. `pnpm run`, `composer run`, `make`. */
  runner: string;
  /** Script name as passed to the runner */
  name: string;
  /** Underlying command, when known */
  cmd?: string;
}

/** A package identity, e.g. `{ ecosystem: "npm", name: "@client/shared" }`. */
export interface PackageId {
  ecosystem: string;
  name: string;
}

/**
 * A tool version as one file declares it, e.g. `{ name: "node", version: "20.11.0", source: ".nvmrc" }`.
 * `version` is the raw value (a pin or a range) and is `undefined` when the tool is known but its
 * version is not declared anywhere (only a lockfile, or a default).
 */
export interface VersionSpec {
  name: string;
  version: string | undefined;
  /** Where it was read: a file (`.nvmrc`), a JSON field (`package.json#engines.node`), or `default` */
  source: string;
}

export interface Detection {
  /** Programming languages, e.g. `TypeScript` */
  languages?: string[];
  /** Frameworks and major libraries, e.g. `React` */
  frameworks?: string[];
  /** Package managers in use, e.g. `pnpm` */
  packageManagers?: string[];
  /** Runtime constraints, e.g. `Node >=20`, `PHP ^8.2`. */
  runtimes?: string[];
  /** Structured runtime versions, one entry per declaring source */
  runtimeVersions?: VersionSpec[];
  /** Structured package manager versions, one entry per declaring source */
  packageManagerVersions?: VersionSpec[];
  /** Tooling worth knowing: test runners, containers, CI */
  tools?: string[];
  /** Commands the repository defines (package scripts, Make targets, tasks) */
  scripts?: Script[];
  /** Packages this repository publishes / declares */
  packages?: PackageId[];
  /** Packages this repository depends on */
  dependencies?: PackageId[];
  /** Raw strings that may contain git URLs of other repositories (dependency specs, VCS repositories…) */
  references?: string[];
  /** Free-form facts worth a line in the card, e.g. `Cargo workspace` */
  notes?: string[];
}

/** Read-only access to a repository working tree. Paths are POSIX and relative to the repo root. */
export interface RepoFiles {
  /** Top-level entry names (directories end with `/`) */
  readonly topLevel: string[];
  // oxlint-disable-next-line typescript/method-signature-style -- public interface that users implement: property signatures would check their parameters strictly, a breaking change
  exists(file: string): Promise<boolean>;
  // oxlint-disable-next-line typescript/method-signature-style -- public interface that users implement: property signatures would check their parameters strictly, a breaking change
  readText(file: string): Promise<string | undefined>;
  // oxlint-disable-next-line typescript/method-signature-style -- public interface that users implement: property signatures would check their parameters strictly, a breaking change
  readJson<T = unknown>(file: string): Promise<T | undefined>;
}

/** A detector inspects a repository and reports what it recognizes. One detector = one module. */
export interface Detector {
  id: string;
  // oxlint-disable-next-line typescript/method-signature-style -- public interface that users implement: property signatures would check their parameters strictly, a breaking change
  detect(files: RepoFiles): Promise<Detection | undefined>;
}
