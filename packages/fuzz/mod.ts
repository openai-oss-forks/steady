/**
 * @steady/fuzz - Spec-aware mutation testing for OpenAPI validators.
 *
 * Given an OpenAPI spec, generates HTTP requests that are intentionally
 * invalid in specific ways. The session-based API handles fingerprint
 * deduplication, budget controls, caching, and reporting.
 *
 * Usage:
 *   const session = new FuzzSession(doc);
 *   for (const fuzzCase of session) {
 *     const response = await sendToServer(fuzzCase);
 *     session.record(fuzzCase, { accepted: isValid(response) });
 *   }
 *   const report = session.report();
 */

// Main entry point
export { FuzzSession } from "./session.ts";
export type { FuzzSessionOptions } from "./session.ts";

// Types
export type {
  BodyInfo,
  FalsePositiveDetail,
  FuzzCache,
  FuzzCase,
  FuzzReport,
  FuzzRequest,
  FuzzResult,
  MutatedCase,
  MutationDetail,
  Mutator,
  MutatorStat,
  OperationInfo,
  ParameterInfo,
} from "./types.ts";

// Mutators (for custom mutator lists)
export {
  ALL_MUTATORS,
  extraProperty,
  omitRequiredBody,
  omitRequiredBodyField,
  removeRequiredHeaderParam,
  removeRequiredQueryParam,
  wrongBodyFieldType,
  wrongContentType,
  wrongEnumValue,
} from "./mutators.ts";

// Utilities
export { computeFingerprint } from "./fingerprint.ts";
export { computeSpecHash, createEmptyCache, validateCache } from "./cache.ts";
export { SeededRng } from "./rng.ts";

// Low-level building blocks
export { walkSpec } from "./spec-walker.ts";
export type { PathMatcher } from "./spec-walker.ts";
export { buildBaseline, generateFromSchema } from "./request-builder.ts";
