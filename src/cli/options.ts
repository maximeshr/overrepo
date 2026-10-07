import path from "node:path";
import { InvalidArgumentError, type Command } from "commander";
import { loadManifest } from "../core/manifest.ts";
import type { Manifest, Project } from "../core/model.ts";
import { selectProjects, type Selection } from "../core/selection.ts";
import type { Io } from "./io.ts";
import { warn } from "./output.ts";

export interface GlobalOptions {
  cwd?: string;
  config?: string;
}

export interface Context {
  io: Io;
  /** Resolved working directory (`-C`). */
  cwd: string;
  config: string | undefined;
}

export function contextOf(io: Io, command: Command): Context {
  const globals = command.optsWithGlobals<GlobalOptions>();
  return { io, cwd: path.resolve(io.cwd, globals.cwd ?? "."), config: globals.config };
}

export async function load(context: Context, options: { quiet?: boolean } = {}): Promise<Manifest> {
  const manifest = await loadManifest({ cwd: context.cwd, file: context.config });
  if (!options.quiet) for (const warning of manifest.warnings) warn(context.io, warning);
  return manifest;
}

export const list = (value: string, previous: string[] | undefined): string[] => [
  ...(previous ?? []),
  ...value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
];

export function positiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new InvalidArgumentError("expected a positive integer");
  return parsed;
}

export function positiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new InvalidArgumentError("expected a positive number");
  return parsed;
}

export function nonNegativeInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new InvalidArgumentError("expected an integer >= 0");
  return parsed;
}

export interface SelectionOptions {
  all?: boolean;
  tags?: string[];
  tagsAny?: string[];
  paths?: string[];
  projects?: string[];
  excludeTags?: string[];
}

export function withSelection(command: Command): Command {
  return command
    .option("-a, --all", "select every project")
    .option("-t, --tags <tags>", "projects having all these tags (comma-separated)", list)
    .option("--tags-any <tags>", "projects having at least one of these tags", list)
    .option("--paths <prefixes>", "projects under these path prefixes", list)
    .option("-p, --projects <names>", "projects by name", list)
    .option("--exclude-tags <tags>", "drop projects having any of these tags", list);
}

export function selection(options: SelectionOptions): Selection {
  return {
    all: options.all,
    tags: options.tags,
    tagsAny: options.tagsAny,
    paths: options.paths,
    projects: options.projects,
    excludeTags: options.excludeTags,
  };
}

export function select(
  manifest: Manifest,
  options: SelectionOptions,
  requireExplicit = false,
): Project[] {
  return selectProjects(manifest.projects, selection(options), { requireExplicit });
}
