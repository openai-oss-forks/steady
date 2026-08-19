/**
 * Core types for the fuzz package.
 */

import type { Schema } from "@steady/json-schema";
import type { MediaTypeEssence } from "@steady/media-type";

// ── Spec extraction types ─────────────────────────────────────────

/** Information about a single parameter extracted from the spec. */
export interface ParameterInfo {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: Schema | null;
}

/** Body schema info extracted from the spec. */
export interface BodyInfo {
  schema: Schema;
  required: boolean;
  contentTypes: MediaTypeEssence[];
}

/** A single operation extracted from an OpenAPI spec. */
export interface OperationInfo {
  /** Path template, e.g. "/users/{user_id}" */
  path: string;
  /** HTTP method, lowercase, e.g. "post" */
  method: string;
  pathParams: ParameterInfo[];
  queryParams: ParameterInfo[];
  headerParams: ParameterInfo[];
  bodyInfo: BodyInfo | null;
  /** Query param names used for route disambiguation (from the path pattern's query string). */
  routingQueryParams?: Set<string>;
}

// ── Request types ─────────────────────────────────────────────────

/** An HTTP request ready to be sent. */
export interface FuzzRequest {
  /** Concrete path with params filled in, e.g. "/users/test-id" */
  path: string;
  method: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
}

// ── Mutator types ─────────────────────────────────────────────────

/** Context about what a mutator changed, used for fingerprinting. */
export interface MutationDetail {
  /** What location was mutated. */
  location: "query" | "header" | "body" | "contentType";
  /** For param mutators: the param's schema type. */
  paramType?: string;
  /** For body field mutators: the field's schema type. */
  fieldType?: string;
  /** For body field mutators: nesting depth of the field (0 = top-level). */
  fieldDepth?: number;
}

/** A case produced by a mutator, before fingerprinting. */
export interface MutatedCase {
  /** Human-readable mutation description. */
  mutation: string;
  /** The mutated request. */
  request: FuzzRequest;
  /** Expected E-codes. */
  expectedCodes: string[];
  /** Structural detail for fingerprinting. */
  detail: MutationDetail;
}

/** A mutator that produces fuzz cases from a valid baseline. */
export interface Mutator {
  /** Stable identifier for this mutator. */
  id: string;
  /** Apply the mutation. Returns cases with MutationDetail for fingerprinting. */
  apply: (op: OperationInfo, baseline: FuzzRequest) => MutatedCase[];
}

// ── Fuzz case (fully assembled) ───────────────────────────────────

/** A single fuzz case: a mutated request and what we expect. */
export interface FuzzCase {
  /** Human-readable operation label, e.g. "POST /users/{user_id}" */
  operation: string;
  /** What this mutation does. */
  mutation: string;
  /** Which mutator produced this case. */
  mutatorId: string;
  /** The mutated HTTP request. */
  request: FuzzRequest;
  /** E-codes we expect to be emitted. Empty means "just expect invalid". */
  expectedCodes: string[];
  /** Structural fingerprint for dedup. */
  fingerprint: string;
}

// ── Result and reporting ──────────────────────────────────────────

/** What the consumer passes back after executing a fuzz case. */
export interface FuzzResult {
  /**
   * Did the target accept the request as valid?
   * true = false positive (target should have rejected it).
   * false = correctly rejected.
   */
  accepted: boolean;
  /** Diagnostic codes the target reported, if any. */
  reportedCodes?: string[];
}

/** Per-mutator statistics. */
export interface MutatorStat {
  mutatorId: string;
  /** Total cases this mutator could produce for the spec. */
  totalCases: number;
  /** Cases actually yielded (after dedup/budget). */
  yieldedCases: number;
  /** Cases that passed (target rejected correctly). */
  passed: number;
  /** False positives from this mutator. */
  falsePositives: number;
}

/** Detail about a single false positive. */
export interface FalsePositiveDetail {
  operation: string;
  mutation: string;
  mutatorId: string;
  fingerprint: string;
  expectedCodes: string[];
  reportedCodes: string[];
}

/** Final report from a fuzz session. */
export interface FuzzReport {
  totalCases: number;
  passed: number;
  falsePositives: number;
  durationMs: number;
  stopReason: "exhausted" | "maxCases" | "maxDurationMs";
  uniqueFingerprints: number;
  totalFingerprints: number;
  fingerprintCoverage: number;
  seed: number;
  mutatorStats: MutatorStat[];
  falsePositiveDetails: FalsePositiveDetail[];
}

// ── Cache ─────────────────────────────────────────────────────────

/** Persisted cache data. JSON-serializable. */
export interface FuzzCache {
  version: 1;
  specHash: string;
  passed: Record<string, { timestamp: string; mutatorId: string }>;
}
