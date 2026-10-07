import { isGitRepo } from "../git/git.ts";
import type { Project } from "../core/model.ts";
import { defaultDetectors } from "./detectors/index.ts";
import { openRepoFiles } from "./repo-files.ts";
import type { Detection, Detector, PackageId, Script } from "./types.ts";

export const AGENT_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
];
const README_PATTERN = /^readme(\.(md|markdown|mdx|txt|rst))?$/i;

export interface Stack {
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  runtimes: string[];
  tools: string[];
  notes: string[];
}

export interface Analysis {
  project: Project;
  cloned: boolean;
  stack: Stack;
  scripts: Script[];
  packages: PackageId[];
  dependencies: PackageId[];
  references: string[];
  /** Top-level entries (directories end with `/`). */
  tree: string[];
  /** Repo-relative README path, when present. */
  readmeFile: string | undefined;
  readme: string | undefined;
  /** Repo-relative paths of agent instruction files present in the repo. */
  agentFiles: string[];
  /** `context.include` entries present in the repo (README and agent files excluded). */
  keyFiles: string[];
}

function emptyAnalysis(project: Project, cloned: boolean): Analysis {
  return {
    project,
    cloned,
    stack: {
      languages: [],
      frameworks: [],
      packageManagers: [],
      runtimes: [],
      tools: [],
      notes: [],
    },
    scripts: [],
    packages: [],
    dependencies: [],
    references: [],
    tree: [],
    readmeFile: undefined,
    readme: undefined,
    agentFiles: [],
    keyFiles: [],
  };
}

function pushUnique<T>(
  target: T[],
  values: T[] | undefined,
  key: (value: T) => string = String,
): void {
  const seen = new Set(target.map(key));
  for (const value of values ?? []) {
    if (seen.has(key(value))) continue;
    seen.add(key(value));
    target.push(value);
  }
}

function merge(analysis: Analysis, detection: Detection): void {
  const { stack } = analysis;
  pushUnique(stack.languages, detection.languages);
  pushUnique(stack.frameworks, detection.frameworks);
  pushUnique(stack.packageManagers, detection.packageManagers);
  pushUnique(stack.runtimes, detection.runtimes);
  pushUnique(stack.tools, detection.tools);
  pushUnique(stack.notes, detection.notes);
  pushUnique(analysis.scripts, detection.scripts, (script) => `${script.runner} ${script.name}`);
  pushUnique(analysis.packages, detection.packages, (id) => `${id.ecosystem}:${id.name}`);
  pushUnique(analysis.dependencies, detection.dependencies, (id) => `${id.ecosystem}:${id.name}`);
  pushUnique(analysis.references, detection.references);
}

/** Inspects a project on disk. Projects that are not cloned get an empty analysis. */
export async function analyzeProject(
  project: Project,
  include: string[],
  detectors: Detector[] = defaultDetectors,
  ref = "origin/HEAD",
): Promise<Analysis> {
  if (!isGitRepo(project.dir)) return emptyAnalysis(project, false);
  const analysis = emptyAnalysis(project, true);
  const files = await openRepoFiles(project.dir, ref);
  analysis.tree = files.topLevel;

  const detections: Detection[] = [];
  for (const detector of detectors) {
    try {
      const detection = await detector.detect(files);
      if (detection) detections.push(detection);
    } catch {
      // A broken manifest file in one repo must not break the whole generation.
    }
  }
  // Ecosystems that bring a framework come first: a Laravel app with a Vite package.json is PHP before JavaScript.
  const weight = (detection: Detection) => ((detection.frameworks?.length ?? 0) > 0 ? 0 : 1);
  for (const detection of detections.sort((a, b) => weight(a) - weight(b)))
    merge(analysis, detection);

  const readmeFile = [
    "README.md",
    ...files.topLevel.filter((file) => README_PATTERN.test(file)).sort(),
  ].find((file) => files.topLevel.includes(file));
  if (readmeFile) {
    analysis.readmeFile = readmeFile;
    analysis.readme = await files.readText(readmeFile);
  }

  // Root files are matched against the (case-sensitive) listing, not the possibly case-insensitive filesystem.
  const present = async (file: string) =>
    file.includes("/") ? files.exists(file) : files.topLevel.includes(file);
  for (const file of AGENT_FILES) {
    if (await present(file)) analysis.agentFiles.push(file);
  }

  const covered = new Set(
    [...analysis.agentFiles, ...(readmeFile ? [readmeFile] : [])].map((file) => file.toLowerCase()),
  );
  for (const file of include) {
    const normalized = file.replace(/^\.\//, "");
    if (covered.has(normalized.toLowerCase()) || README_PATTERN.test(normalized)) continue;
    if (await present(normalized)) analysis.keyFiles.push(normalized);
  }
  return analysis;
}
