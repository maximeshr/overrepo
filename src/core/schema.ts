import { z } from "zod";

const text = z.string().trim().min(1, "must not be empty");

/** Tags and project names are used in comma-separated CLI flags, so commas and whitespace are banned. */
const identifier = z
  .string()
  .min(1, "must not be empty")
  .regex(/^[^\s,]+$/, "must not contain whitespace or commas");

export const cloneOptionsSchema = z.strictObject({
  depth: z.number().int().positive().nullable().optional(),
  filter: text.nullable().optional(),
  branch: text.nullable().optional(),
});

export const defaultsSchema = z.strictObject({
  clone: cloneOptionsSchema.optional(),
  concurrency: z.number().int().positive().max(128).optional(),
  /** Timeout of a single git/shell operation, in seconds. */
  timeout: z.number().positive().optional(),
  /** Retries for transient network errors (clone, fetch, pull). */
  retries: z.number().int().min(0).max(10).optional(),
});

export const contextSchema = z.strictObject({
  outDir: text.optional(),
  index: text.optional(),
  include: z.array(text).optional(),
  /** Upper bound of the generated part of a card, in bytes. */
  maxBytes: z.number().int().min(1024).optional(),
  readmeMaxChars: z.number().int().min(0).optional(),
  treeMaxEntries: z.number().int().min(0).optional(),
});

export const gitignoreSchema = z.strictObject({
  sync: z.boolean().optional(),
});

export const projectSchema = z.strictObject({
  path: text.optional(),
  url: text.optional(),
  desc: z.string().optional(),
  tags: z.array(identifier).optional(),
  owners: z.array(text).optional(),
  links: z.record(z.string(), text).optional(),
  sync: z.boolean().optional(),
  clone: cloneOptionsSchema.optional(),
});

export const taskSchema = z.union([
  text,
  z.strictObject({
    desc: z.string().optional(),
    cmd: text,
  }),
]);

export const manifestSchema = z.strictObject({
  version: z.literal(1, "only version 1 is supported").optional(),
  defaults: defaultsSchema.optional(),
  context: contextSchema.optional(),
  gitignore: gitignoreSchema.optional(),
  projects: z.record(identifier, projectSchema.nullable()).optional(),
  tasks: z.record(identifier, taskSchema).optional(),
});

export type RawManifest = z.output<typeof manifestSchema>;
export type RawProject = z.output<typeof projectSchema>;
export type RawTask = z.output<typeof taskSchema>;
export type CloneOptionsInput = z.output<typeof cloneOptionsSchema>;
