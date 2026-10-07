/** Base error for every failure overrepo knows how to explain. */
export class OverrepoError extends Error {
  /** Process exit code the CLI should use: 1 = runtime failure, 2 = usage/config error. */
  readonly exitCode: 1 | 2;

  constructor(message: string, exitCode: 1 | 2 = 1, options?: ErrorOptions) {
    super(message, options);
    this.name = "OverrepoError";
    this.exitCode = exitCode;
  }
}

/** Invalid command line usage (unknown task, missing selection, bad flag combination). */
export class UsageError extends OverrepoError {
  constructor(message: string) {
    super(message, 2);
    this.name = "UsageError";
  }
}

export interface ManifestIssue {
  /** Dotted YAML path, e.g. `projects.billing-api.path`. Empty for file-level issues. */
  path: string;
  message: string;
  line?: number;
  column?: number;
}

/** The manifest is missing, unparsable or does not match the schema. */
export class ManifestError extends OverrepoError {
  readonly file: string | undefined;
  readonly issues: ManifestIssue[];

  constructor(file: string | undefined, issues: ManifestIssue[]) {
    super(formatIssues(file, issues), 2);
    this.name = "ManifestError";
    this.file = file;
    this.issues = issues;
  }
}

function formatIssues(file: string | undefined, issues: ManifestIssue[]): string {
  const lines = issues.map((issue) => {
    const location = [file, issue.line, issue.column]
      .filter((part) => part !== undefined)
      .join(":");
    const where = [location, issue.path].filter(Boolean).join(" ");
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  const header =
    issues.length > 1 ? `Invalid manifest (${issues.length} issues):` : "Invalid manifest:";
  return [header, ...lines.map((line) => `  - ${line}`)].join("\n");
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
