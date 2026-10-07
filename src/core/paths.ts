import path from "node:path";

/**
 * Normalizes a manifest-relative path to POSIX form (`backend/billing-api`).
 * Returns an error message instead when the path is absolute, empty or escapes the root.
 */
export function normalizeRelativePath(input: string): { path: string } | { error: string } {
  const slashed = input.trim().replaceAll("\\", "/");
  if (slashed === "") return { error: "path must not be empty" };
  if (slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed) || path.isAbsolute(input)) {
    return { error: `path must be relative to the manifest root, got "${input}"` };
  }
  const normalized = path.posix.normalize(slashed).replace(/\/+$/, "");
  if (normalized === "." || normalized === "") {
    return { error: "path must not point to the manifest root itself" };
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    return { error: `path "${input}" escapes the manifest root` };
  }
  return { path: normalized };
}

/** `a/b/c` is inside `a/b` (or equal to it). */
export function isWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/** Converts an absolute path below `root` into a POSIX relative path. */
export function toPosixRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}
