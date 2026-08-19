/**
 * Fuzz case planning: walks the spec, applies mutators, computes
 * fingerprints, and orders cases.
 */

import type { OpenAPISpec } from "@steady/openapi";
import { type PathMatcher, walkSpec } from "./spec-walker.ts";
import { buildBaseline } from "./request-builder.ts";
import { computeFingerprint } from "./fingerprint.ts";
import { ALL_MUTATORS } from "./mutators.ts";
import { SeededRng } from "./rng.ts";
import type { FuzzCache, FuzzCase, Mutator } from "./types.ts";

export interface PlanOptions {
  seed: number;
  mutators: Mutator[];
  cache?: FuzzCache;
  pathMatcher?: PathMatcher;
}

export interface CasePlan {
  /** Ordered list of cases to yield. */
  cases: FuzzCase[];
  /** All unique fingerprints found in the spec. */
  totalFingerprints: number;
  /** Per-mutator total case counts. */
  mutatorTotals: Map<string, number>;
}

/**
 * Plan which fuzz cases to yield and in what order.
 *
 * 1. Walk the spec to extract operations.
 * 2. For each operation, build a baseline and apply all mutators.
 * 3. Compute fingerprints.
 * 4. Apply cache filtering (deprioritize previously-passed fingerprints).
 * 5. Seed-based shuffle within fresh/stale groups for deterministic ordering.
 */
export function planCases(
  doc: OpenAPISpec,
  options: PlanOptions,
): CasePlan {
  const operations = walkSpec(doc, options.pathMatcher);
  const mutators = options.mutators.length > 0
    ? options.mutators
    : ALL_MUTATORS;

  // Generate all candidate cases
  const allCases: FuzzCase[] = [];
  const mutatorTotals = new Map<string, number>();

  for (const op of operations) {
    const baseline = buildBaseline(op);
    const opLabel = `${op.method.toUpperCase()} ${op.path}`;

    for (const mutator of mutators) {
      const mutated = mutator.apply(op, baseline);
      const currentTotal = mutatorTotals.get(mutator.id) ?? 0;
      mutatorTotals.set(mutator.id, currentTotal + mutated.length);

      for (const mc of mutated) {
        const fingerprint = computeFingerprint(mutator.id, mc.detail);
        allCases.push({
          operation: opLabel,
          mutation: mc.mutation,
          mutatorId: mutator.id,
          request: mc.request,
          expectedCodes: mc.expectedCodes,
          fingerprint,
        });
      }
    }
  }

  // Collect all unique fingerprints
  const allFingerprints = new Set(allCases.map((c) => c.fingerprint));
  const totalFingerprints = allFingerprints.size;

  let planned = allCases;

  // Deprioritize cached fingerprints (put them at the end).
  // When a seed is set, shuffle within each group so fresh cases
  // stay first but still get deterministic ordering.
  if (options.cache) {
    const cached = new Set(Object.keys(options.cache.passed));
    const fresh = planned.filter((c) => !cached.has(c.fingerprint));
    const stale = planned.filter((c) => cached.has(c.fingerprint));

    if (options.seed !== 0) {
      const rng = new SeededRng(options.seed);
      rng.shuffle(fresh);
      rng.shuffle(stale);
    }

    planned = [...fresh, ...stale];
  } else if (options.seed !== 0) {
    const rng = new SeededRng(options.seed);
    rng.shuffle(planned);
  }

  return { cases: planned, totalFingerprints, mutatorTotals };
}
