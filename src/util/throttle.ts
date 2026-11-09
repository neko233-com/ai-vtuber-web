export interface BudgetOptions {
  /** Minimum gap between allowed events, ms. 0 disables the gap check. */
  minIntervalMs: number;
  /** Max allowed events per rolling 60 s window. */
  maxPerMin: number;
}

export interface Budget {
  /** True if the event at `now` (ms) may pass; allowed calls are recorded. */
  allow(now: number): boolean;
}

/**
 * Sliding-window + min-gap rate limiter for reaction dispatch.
 * Denied calls are NOT recorded, so a burst never queues up compensation.
 */
export function createBudget(opts: BudgetOptions): Budget {
  const minIntervalMs = Math.max(0, opts.minIntervalMs);
  const maxPerMin = Math.max(0, Math.floor(opts.maxPerMin));
  let lastAllowed = -Infinity;
  const window: number[] = [];

  return {
    allow(now: number): boolean {
      if (now - lastAllowed < minIntervalMs) return false;
      while (window.length > 0 && now - window[0] >= 60_000) window.shift();
      if (window.length >= maxPerMin) return false;
      window.push(now);
      lastAllowed = now;
      return true;
    },
  };
}
