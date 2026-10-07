/**
 * Read-only support for the useful subset of mani's config format
 * (https://manicli.com): `projects` (path, url, desc, tags, sync, branch) and `tasks` (desc, cmd).
 * Everything else is ignored with a warning; the mani file itself is never written.
 */

type Json = Record<string, unknown>;

const SUPPORTED_PROJECT_KEYS = new Set(["path", "url", "desc", "tags", "sync", "branch"]);
const SUPPORTED_TASK_KEYS = new Set(["desc", "cmd"]);
const IGNORED_TOP_LEVEL_KEYS = new Set([
  "import",
  "env",
  "shell",
  "specs",
  "targets",
  "themes",
  "sync_remotes",
  "reload_tui_on_change",
]);

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ManiConversion {
  /** Object shaped like an overrepo manifest, ready for schema validation. */
  manifest: Json;
  /** Projects mani lets you declare but overrepo cannot manage (e.g. the root itself, `path: .`). */
  skippedProjects: string[];
  warnings: string[];
}

export function convertMani(raw: unknown): ManiConversion {
  const warnings: string[] = [];
  const skippedProjects: string[] = [];
  const manifest: Json = { version: 1 };
  if (!isObject(raw)) return { manifest, skippedProjects, warnings };

  for (const key of Object.keys(raw)) {
    if (IGNORED_TOP_LEVEL_KEYS.has(key))
      warnings.push(`mani: top-level "${key}" is not supported and was ignored`);
  }

  if (typeof raw.sync_gitignore === "boolean") manifest.gitignore = { sync: raw.sync_gitignore };

  if (isObject(raw.projects)) {
    const projects: Json = {};
    for (const [name, value] of Object.entries(raw.projects)) {
      const project = isObject(value) ? value : {};
      const projectPath = typeof project.path === "string" ? project.path.trim() : name;
      if (projectPath === "." || projectPath === "./" || projectPath === "") {
        skippedProjects.push(name);
        warnings.push(`mani: project "${name}" points to the root itself and was skipped`);
        continue;
      }
      const converted: Json = {};
      for (const [key, fieldValue] of Object.entries(project)) {
        if (!SUPPORTED_PROJECT_KEYS.has(key)) {
          warnings.push(`mani: projects.${name}.${key} is not supported and was ignored`);
          continue;
        }
        if (key === "branch") {
          if (fieldValue != null) converted.clone = { branch: fieldValue };
        } else {
          converted[key] = fieldValue;
        }
      }
      projects[name] = converted;
    }
    manifest.projects = projects;
  }

  if (isObject(raw.tasks)) {
    const tasks: Json = {};
    for (const [name, value] of Object.entries(raw.tasks)) {
      if (typeof value === "string") {
        tasks[name] = value;
        continue;
      }
      if (!isObject(value) || typeof value.cmd !== "string") {
        warnings.push(
          `mani: task "${name}" has no "cmd" (multi-command tasks are not supported) and was ignored`,
        );
        continue;
      }
      const task: Json = { cmd: value.cmd };
      if (typeof value.desc === "string") task.desc = value.desc;
      for (const key of Object.keys(value)) {
        if (!SUPPORTED_TASK_KEYS.has(key))
          warnings.push(`mani: tasks.${name}.${key} is not supported and was ignored`);
      }
      tasks[name] = task;
    }
    manifest.tasks = tasks;
  }

  return { manifest, skippedProjects, warnings };
}
