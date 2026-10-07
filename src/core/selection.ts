import { UsageError } from "./errors.ts";
import type { Project } from "./model.ts";
import { isWithin, normalizeRelativePath } from "./paths.ts";

export interface Selection {
  all?: boolean;
  /** Project must have every tag (AND). */
  tags?: string[];
  /** Project must have at least one tag (OR). */
  tagsAny?: string[];
  /** Project path must be under one of these prefixes. */
  paths?: string[];
  /** Explicit project names. */
  projects?: string[];
  /** Drop projects having any of these tags. Applied last; does not count as an explicit selection. */
  excludeTags?: string[];
}

export interface SelectOptions {
  /** Throw a `UsageError` when no explicit selector (`all`, `tags`, `tagsAny`, `paths`, `projects`) is given. */
  requireExplicit?: boolean;
}

const nonEmpty = (values: string[] | undefined): values is string[] =>
  values !== undefined && values.length > 0;

export function hasExplicitSelection(selection: Selection): boolean {
  return (
    Boolean(selection.all) ||
    [selection.tags, selection.tagsAny, selection.paths, selection.projects].some(nonEmpty)
  );
}

/** Filters projects, preserving manifest order. Criteria are combined with AND. */
export function selectProjects(
  projects: Project[],
  selection: Selection = {},
  options: SelectOptions = {},
): Project[] {
  if (options.requireExplicit && !hasExplicitSelection(selection)) {
    throw new UsageError(
      "no projects selected: pass --all, --tags, --tags-any, --paths or --projects",
    );
  }

  const names = nonEmpty(selection.projects) ? new Set(selection.projects) : undefined;
  if (names) {
    const known = new Set(projects.map((project) => project.name));
    const unknown = [...names].filter((name) => !known.has(name));
    if (unknown.length > 0)
      throw new UsageError(
        `unknown project${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
      );
  }

  const prefixes = nonEmpty(selection.paths)
    ? selection.paths.map((prefix) => {
        const normalized = normalizeRelativePath(prefix);
        if ("error" in normalized) throw new UsageError(`--paths: ${normalized.error}`);
        return normalized.path;
      })
    : undefined;

  return projects.filter((project) => {
    const tags = new Set(project.tags);
    if (names && !names.has(project.name)) return false;
    if (nonEmpty(selection.tags) && !selection.tags.every((tag) => tags.has(tag))) return false;
    if (nonEmpty(selection.tagsAny) && !selection.tagsAny.some((tag) => tags.has(tag)))
      return false;
    if (prefixes && !prefixes.some((prefix) => isWithin(project.path, prefix))) return false;
    if (nonEmpty(selection.excludeTags) && selection.excludeTags.some((tag) => tags.has(tag)))
      return false;
    return true;
  });
}
