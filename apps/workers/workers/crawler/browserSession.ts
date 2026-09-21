// Helpers that keep remote/hosted browser sessions (e.g. browserless.io) within
// their limits: a process-wide cap on concurrent sessions and a per-session
// time budget that the crawl steps are fitted into.
import { Semaphore } from "async-mutex";

/**
 * Only plain-http browser endpoints get their hostname swapped for the
 * resolved IP (useful for docker-network hostnames). Rewriting a TLS endpoint
 * (https/wss) to an IP breaks certificate and SNI checks for hosted browsers.
 */
export function shouldResolveBrowserHostname(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "ws:";
}

export type ReleaseSession = () => void;

/**
 * Creates a limiter for concurrent browser sessions. With no max, acquiring
 * is a no-op. Waiting for a slot is abort-aware: if the signal fires first,
 * the slot is released as soon as it would have been granted.
 */
export function createSessionLimiter(maxSessions: number | undefined): {
  acquire: (signal: AbortSignal) => Promise<ReleaseSession>;
} {
  if (!maxSessions) {
    return {
      acquire: async (signal) => {
        signal.throwIfAborted();
        return () => {
          /* no limit */
        };
      },
    };
  }

  const semaphore = new Semaphore(maxSessions);
  return {
    acquire: async (signal) => {
      signal.throwIfAborted();
      const acquired = semaphore.acquire();
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error("AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      aborted.catch(() => {
        /* suppress unhandledRejection */
      });
      try {
        const [, release] = await Promise.race([acquired, aborted]);
        return release;
      } catch (e) {
        acquired
          .then(([, release]) => release())
          .catch(() => {
            /* semaphore cancelled */
          });
        throw e;
      } finally {
        if (onAbort) {
          signal.removeEventListener("abort", onAbort);
        }
      }
    },
  };
}

// Time kept back from navigation for extracting the HTML, capturing a
// screenshot and closing the page/context/browser.
export const CAPTURE_RESERVE_MS = 10_000;
const MIN_STEP_MS = 1_000;

/**
 * Tracks the remaining time of a browser session. Without a budget every step
 * gets its configured timeout unchanged.
 */
export class SessionBudget {
  private readonly deadline: number | undefined;

  constructor(
    budgetSec: number | undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.deadline =
      budgetSec !== undefined ? this.now() + budgetSec * 1000 : undefined;
  }

  get limited(): boolean {
    return this.deadline !== undefined;
  }

  remainingMs(): number {
    if (this.deadline === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, this.deadline - this.now());
  }

  /** Timeout for navigation: the configured value, minus the capture reserve. */
  navigationTimeoutMs(configuredMs: number): number {
    if (this.deadline === undefined) {
      return configuredMs;
    }
    return Math.max(
      MIN_STEP_MS,
      Math.min(configuredMs, this.remainingMs() - CAPTURE_RESERVE_MS),
    );
  }

  /** Whether an optional step of `ms` still fits before the capture reserve. */
  fits(ms: number): boolean {
    return this.remainingMs() - CAPTURE_RESERVE_MS >= ms;
  }
}
