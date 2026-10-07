import { setTimeout as delay } from "node:timers/promises";
import { GitError } from "./git.ts";

const TRANSIENT_PATTERNS = [
  /could not resolve host/i,
  /connection (timed out|reset|refused|closed)/i,
  /operation timed out/i,
  /early EOF/i,
  /RPC failed/i,
  /the remote end hung up unexpectedly/i,
  /unexpected disconnect/i,
  /network is unreachable/i,
  /temporary failure in name resolution/i,
  /TLS|SSL_ERROR|gnutls_handshake/i,
  /\b(429|500|502|503|504)\b/,
  /kex_exchange_identification/i,
];

/** Network hiccups worth retrying; auth failures and missing repositories are not. */
export function isTransientGitError(error: unknown): boolean {
  if (!(error instanceof GitError) || error.aborted) return false;
  if (error.timedOut) return true;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(error.stderr));
}

export interface RetryOptions {
  retries: number;
  /** Base delay in ms (doubled on each attempt, with jitter). */
  baseDelay?: number;
  signal?: AbortSignal;
  /** Called before each retry, e.g. to clean up a partial clone. */
  onRetry?: (error: unknown, attempt: number) => void | Promise<void>;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const baseDelay = options.baseDelay ?? 1000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= options.retries || !isTransientGitError(error) || options.signal?.aborted)
        throw error;
      await options.onRetry?.(error, attempt + 1);
      const wait = baseDelay * 2 ** attempt * (0.75 + Math.random() * 0.5);
      await delay(wait, undefined, { signal: options.signal }).catch(() => undefined);
      if (options.signal?.aborted) throw error;
    }
  }
}
