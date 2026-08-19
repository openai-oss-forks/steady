/**
 * FuzzSession: the main entry point for fuzz testing.
 *
 * Plans cases from the spec, yields them via iteration, tracks
 * results, and produces a report. The session is a sync Iterable;
 * the consumer is responsible for sending requests and recording
 * results.
 */

import type { OpenAPISpec } from "@steady/openapi";
import { ALL_MUTATORS } from "./mutators.ts";
import { Budget, type StopReason } from "./budget.ts";
import { computeSpecHash, createEmptyCache } from "./cache.ts";
import { planCases } from "./planner.ts";
import type { PathMatcher } from "./spec-walker.ts";
import type {
  FalsePositiveDetail,
  FuzzCache,
  FuzzCase,
  FuzzReport,
  FuzzResult,
  Mutator,
  MutatorStat,
} from "./types.ts";

/** Options for creating a FuzzSession. */
export interface FuzzSessionOptions {
  /** Maximum number of cases to yield. Default: Infinity. */
  maxCases?: number;
  /** Maximum time in milliseconds. Default: Infinity. */
  maxDurationMs?: number;
  /** Seed for deterministic ordering. Default: 0 (natural order). */
  seed?: number;
  /** Mutators to use. Default: ALL_MUTATORS. */
  mutators?: Mutator[];
  /** Loaded cache data from a previous run. */
  cache?: FuzzCache;
  /** Path matcher for filtering ambiguous operations. */
  pathMatcher?: PathMatcher;
}

/**
 * A fuzz testing session.
 *
 * Usage:
 *   const session = new FuzzSession(doc, options);
 *   for (const fuzzCase of session) {
 *     const result = await sendToServer(fuzzCase);
 *     session.record(fuzzCase, result);
 *   }
 *   const report = session.report();
 */
export class FuzzSession implements Iterable<FuzzCase> {
  private readonly seed: number;
  private readonly budget: Budget;
  private readonly plan: FuzzCase[];
  private readonly totalFingerprints: number;
  private readonly mutatorTotals: Map<string, number>;
  private readonly specHash: string;

  // Tracking state
  private yielded = 0;
  private readonly results = new Map<string, FuzzResult>();
  private stopReason: StopReason = "exhausted";

  constructor(doc: OpenAPISpec, options?: FuzzSessionOptions) {
    this.seed = options?.seed ?? 0;
    this.specHash = computeSpecHash(JSON.stringify(doc.rawSpec));

    this.budget = new Budget({
      maxCases: options?.maxCases,
      maxDurationMs: options?.maxDurationMs,
    });

    const casePlan = planCases(doc, {
      seed: this.seed,
      mutators: options?.mutators ?? ALL_MUTATORS,
      cache: options?.cache,
      pathMatcher: options?.pathMatcher,
    });

    this.plan = casePlan.cases;
    this.totalFingerprints = casePlan.totalFingerprints;
    this.mutatorTotals = casePlan.mutatorTotals;
  }

  /** Iterate over planned fuzz cases, respecting budget. */
  *[Symbol.iterator](): Iterator<FuzzCase> {
    for (const fuzzCase of this.plan) {
      if (!this.budget.hasRemaining()) {
        this.stopReason = this.budget.stopReason();
        return;
      }
      this.budget.tick();
      this.yielded++;
      yield fuzzCase;
    }
    this.stopReason = this.budget.stopReason();
  }

  /**
   * Record the outcome of a fuzz case.
   * Must be called once per yielded case.
   */
  record(fuzzCase: FuzzCase, result: FuzzResult): void {
    this.results.set(fuzzCase.fingerprint + ":" + fuzzCase.operation, result);
  }

  /** Number of cases yielded so far. */
  get casesYielded(): number {
    return this.yielded;
  }

  /** Generate the final report. */
  report(): FuzzReport {
    let passed = 0;
    let falsePositives = 0;
    const fpDetails: FalsePositiveDetail[] = [];
    const mutatorPassed = new Map<string, number>();
    const mutatorFP = new Map<string, number>();
    const mutatorYielded = new Map<string, number>();
    const testedFingerprints = new Set<string>();

    for (let i = 0; i < this.yielded && i < this.plan.length; i++) {
      const fuzzCase = this.plan[i];
      if (!fuzzCase) continue;

      const key = fuzzCase.fingerprint + ":" + fuzzCase.operation;
      const result = this.results.get(key);
      testedFingerprints.add(fuzzCase.fingerprint);

      mutatorYielded.set(
        fuzzCase.mutatorId,
        (mutatorYielded.get(fuzzCase.mutatorId) ?? 0) + 1,
      );

      if (!result) continue;

      // Cases with expectedCodes expect rejection; empty expectedCodes
      // means the mutation produces a valid request (e.g. readOnly field
      // omitted from a request).
      const expectsRejection = fuzzCase.expectedCodes.length > 0;
      const correctOutcome = expectsRejection
        ? !result.accepted
        : result.accepted;

      if (correctOutcome) {
        passed++;
        mutatorPassed.set(
          fuzzCase.mutatorId,
          (mutatorPassed.get(fuzzCase.mutatorId) ?? 0) + 1,
        );
      } else {
        falsePositives++;
        mutatorFP.set(
          fuzzCase.mutatorId,
          (mutatorFP.get(fuzzCase.mutatorId) ?? 0) + 1,
        );
        fpDetails.push({
          operation: fuzzCase.operation,
          mutation: fuzzCase.mutation,
          mutatorId: fuzzCase.mutatorId,
          fingerprint: fuzzCase.fingerprint,
          expectedCodes: fuzzCase.expectedCodes,
          reportedCodes: result.reportedCodes ?? [],
        });
      }
    }

    const mutatorStats: MutatorStat[] = [];
    for (const [mutatorId, total] of this.mutatorTotals) {
      mutatorStats.push({
        mutatorId,
        totalCases: total,
        yieldedCases: mutatorYielded.get(mutatorId) ?? 0,
        passed: mutatorPassed.get(mutatorId) ?? 0,
        falsePositives: mutatorFP.get(mutatorId) ?? 0,
      });
    }

    return {
      totalCases: this.yielded,
      passed,
      falsePositives,
      durationMs: this.budget.elapsedMs(),
      stopReason: this.stopReason,
      uniqueFingerprints: testedFingerprints.size,
      totalFingerprints: this.totalFingerprints,
      fingerprintCoverage: this.totalFingerprints > 0
        ? testedFingerprints.size / this.totalFingerprints
        : 0,
      seed: this.seed,
      mutatorStats,
      falsePositiveDetails: fpDetails,
    };
  }

  /**
   * Export the cache state for persistence.
   * Includes all fingerprints that passed in this session.
   */
  exportCache(): FuzzCache {
    const cache = createEmptyCache(this.specHash);

    for (let i = 0; i < this.yielded && i < this.plan.length; i++) {
      const fuzzCase = this.plan[i];
      if (!fuzzCase) continue;

      const key = fuzzCase.fingerprint + ":" + fuzzCase.operation;
      const result = this.results.get(key);
      if (result && !result.accepted) {
        cache.passed[fuzzCase.fingerprint] = {
          timestamp: new Date().toISOString(),
          mutatorId: fuzzCase.mutatorId,
        };
      }
    }

    return cache;
  }
}
