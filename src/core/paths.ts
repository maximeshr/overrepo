import path from "node:path";

/**
 * Normalizes a path relative to the fleet root (`qualifio/collect/collect`).
 * Returns an error message when the path is absolute, empty, or leaves the root.
 */
export function normalizeRelativePath(input: string): { path: string } | { error: string } {
  const slashed = input.trim().replaceAll("\\", "/");
  if (slashed === "") return { error: "path must not be empty" };
  if (slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed) || path.isAbsolute(input)) {
    return { error: `path must be relative to the fleet root, got "${input}"` };
  }
  const normalized = path.posix.normalize(slashed).replace(/\/+$/, "");
  if (normalized === "." || normalized === "") {
    return { error: "path must not point to the fleet root itself" };
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    return { error: `path "${input}" escapes the fleet root` };
  }
  return { path: normalized };
}

/** True when `absolute` is `parent` or a directory inside it. */
export function isInsideDir(parent: string, absolute: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(absolute));
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** `a/b/c` is inside `a/b` (or equal to it). */
export function isWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/** Converts an absolute path below `root` into a POSIX relative path. */
export function toPosixRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}
