import { OverrepoError } from "./overrepo-error.ts";

export interface ManifestIssue {
  /** Dotted YAML path, e.g. `projects.billing-api.path`. Empty for file-level issues. */
  path: string;
  message: string;
  line?: number;
  column?: number;
}

/** The manifest is missing, unparsable or does not match the schema */
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

const formatIssues = (file: string | undefined, issues: ManifestIssue[]): string => {
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
};
