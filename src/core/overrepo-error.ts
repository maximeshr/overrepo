/** Base error for every failure overrepo knows how to explain */
export class OverrepoError extends Error {
  /** Process exit code the CLI should use: 1 = runtime failure, 2 = usage/config error */
  readonly exitCode: 1 | 2;

  constructor(message: string, exitCode: 1 | 2 = 1, options?: ErrorOptions) {
    super(message, options);
    this.name = "OverrepoError";
    this.exitCode = exitCode;
  }
}
