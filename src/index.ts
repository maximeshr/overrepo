/**
 * Programmatic API. Everything here is free of console I/O so it can back other
 * front-ends as well as the `overrepo` CLI.
 */
export { ManifestError, OverrepoError, UsageError, type ManifestIssue } from "./core/errors.ts";
export {
  loadManifest,
  locateManifest,
  parseManifest,
  type LocateOptions,
  type ManifestLocation,
} from "./core/manifest.ts";
export type { Defaults, Manifest, Project } from "./core/model.ts";
export { manifestSchema } from "./core/schema.ts";
export {
  selectProjects,
  hasExplicitSelection,
  type Selection,
  type SelectOptions,
} from "./core/selection.ts";
export {
  forEachProject,
  summarize,
  type ProjectResult,
  type ResultStatus,
  type RunEvent,
  type Summary,
} from "./core/runner.ts";
export { sync, type SyncAction, type SyncOptions, type SyncReport } from "./core/sync.ts";
export { status, type ProjectState, type StatusOptions } from "./core/status.ts";
export { execInProjects, type ExecOptions, type ExecValue, type OutputLine } from "./core/exec.ts";
export { init, type InitOptions, type InitResult } from "./core/init.ts";
export {
  importProjects,
  parseImportSource,
  importSourceSchema,
  type ImportOptions,
  type ImportProject,
  type ImportReport,
} from "./core/import.ts";
export {
  doctor,
  type Check,
  type CheckLevel,
  type DoctorOptions,
  type DoctorReport,
} from "./core/doctor.ts";
export { normalizeGitUrl } from "./core/urls.ts";
export {
  generateContext,
  cardPath,
  type ContextFile,
  type ContextOptions,
  type ContextReport,
  type FileStatus,
} from "./context/generate.ts";
export { analyzeProject, type Analysis } from "./context/analyze.ts";
export { defaultDetectors } from "./context/detectors/index.ts";
export type { Detection, Detector, PackageId, RepoFiles, Script } from "./context/types.ts";
