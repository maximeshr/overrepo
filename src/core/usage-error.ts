import { OverrepoError } from "./overrepo-error.ts";

/** Invalid command line usage (unknown task, missing selection, bad flag combination) */
export class UsageError extends OverrepoError {
  constructor(message: string) {
    super(message, 2);
    this.name = "UsageError";
  }
}
