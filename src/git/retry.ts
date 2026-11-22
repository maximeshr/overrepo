import { setTimeout as delay } from "node:timers/promises";
import { GitError } from "./git.ts";

const TRANSIENT_PATTERNS = [
  /could not resolve host/iu,
  /connection (?:timed out|reset|refused|closed)/iu,
  /operation timed out/iu,
  /early EOF/iu,
  /RPC failed/iu,
  /the remote end hung up unexpectedly/iu,
  /unexpected disconnect/iu,
  /network is unreachable/iu,
  /temporary failure in name resolution/iu,
  /TLS|SSL_ERROR|gnutls_handshake/iu,
  /\b(?:429|500|502|503|504)\b/u,
  /kex_exchange_identification/iu,
];

/** Network hiccups are worth retrying, auth failures and missing repositories are not */
const isTransient = (error: GitError): boolean =>
  !error.aborted &&
  (error.timedOut || TRANSIENT_PATTERNS.some((pattern) => pattern.test(error.stderr)));

export interface RetryOptions {
  /** Retries after the first attempt, 0 to never retry */
  retries: number;
  /** Base delay in ms (doubled on each attempt, with jitter) */
  baseDelay?: number;
  /** Stops retrying once aborted */
  signal?: AbortSignal;
  /** Called before each retry, e.g. to clean up a partial clone. */
  onRetry?: (error: GitError, attempt: number) => void | Promise<void>;
}

export const withRetry = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  const baseDelay = options.baseDelay ?? 1000;

  // Attempts run one after the other: each retry waits for the previous failure
  const attempt = async (index: number): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (
        index >= options.retries ||
        !(error instanceof GitError) ||
        !isTransient(error) ||
        options.signal?.aborted === true
      ) {
        throw error;
      }

      await options.onRetry?.(error, index + 1);
      const wait = baseDelay * 2 ** index * (0.75 + Math.random() * 0.5);
      await delay(wait, undefined, { signal: options.signal }).catch(() => {
        // An abort ends the delay early, and the check below stops the retries
      });

      // Re-read: the signal may have fired during the delay
      const { signal } = options;

      if (signal?.aborted === true) {
        throw error;
      }

      return await attempt(index + 1);
    }
  };

  return await attempt(0);
};
