export { ManifestError } from "./manifest-error.ts";

export type { ManifestIssue } from "./manifest-error.ts";

export { OverrepoError } from "./overrepo-error.ts";

export { UsageError } from "./usage-error.ts";

/** Message of a caught value, which is an Error in practice but can be anything */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- formats what a catch clause caught, and TypeScript types it unknown
export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};
