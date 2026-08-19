/**
 * Budget controller for fuzz sessions.
 *
 * Tracks case count and elapsed time against configured limits.
 * Either, both, or neither limit can be set.
 */

export interface BudgetOptions {
  maxCases?: number;
  maxDurationMs?: number;
}

export type StopReason = "exhausted" | "maxCases" | "maxDurationMs";

export class Budget {
  private readonly maxCases: number;
  private readonly maxDurationMs: number;
  private readonly startTime: number;
  private count = 0;

  constructor(options: BudgetOptions) {
    this.maxCases = options.maxCases ?? Infinity;
    this.maxDurationMs = options.maxDurationMs ?? Infinity;
    this.startTime = performance.now();
  }

  /** Check if the budget allows yielding another case. */
  hasRemaining(): boolean {
    if (this.count >= this.maxCases) return false;
    if (this.elapsedMs() >= this.maxDurationMs) return false;
    return true;
  }

  /** Record that a case was yielded. */
  tick(): void {
    this.count++;
  }

  /** Elapsed time since budget was created, in milliseconds. */
  elapsedMs(): number {
    return performance.now() - this.startTime;
  }

  /** Why the budget stopped (call after hasRemaining() returns false). */
  stopReason(): StopReason {
    if (this.count >= this.maxCases) return "maxCases";
    if (this.elapsedMs() >= this.maxDurationMs) return "maxDurationMs";
    return "exhausted";
  }
}
