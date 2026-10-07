import { z } from "zod";

const text = z.string().trim().min(1, "must not be empty");

/** Project paths and tags are used in comma-separated CLI flags, so commas and whitespace are banned. */
const identifier = z
  .string()
  .min(1, "must not be empty")
  .regex(/^[^\s,]+$/, "must not contain whitespace or commas");

export const projectSchema = z.strictObject({
  url: text,
  desc: z.string().optional(),
  tags: z.array(identifier).optional(),
});

export const manifestSchema = z.strictObject({
  /**
   * Fleet root, relative to this file. Project keys are paths relative to it.
   * `..` places clones next to the directory that holds the manifest.
   */
  root: text.optional(),
  /**
   * Where repository summaries are written, relative to this file.
   * Omitted, the directory is `ai/repos`.
   */
  summary: z.strictObject({ outDir: text.optional() }).optional(),
  projects: z.record(identifier, projectSchema),
});

export type RawManifest = z.output<typeof manifestSchema>;
export type RawProject = z.output<typeof projectSchema>;
