/**
 * Cache utilities for persisting fuzz results across runs.
 *
 * The library never touches the filesystem. The consumer reads/writes
 * the cache file and passes the data in.
 */

import { isPlainObject } from "@steady/json-pointer";
import type { FuzzCache } from "./types.ts";

/**
 * Compute a content hash of the spec for cache invalidation.
 *
 * Uses a simple string hash (djb2). We only need "did the spec change?",
 * not cryptographic security.
 */
export function computeSpecHash(specJson: string): string {
  let hash = 5381;
  for (let i = 0; i < specJson.length; i++) {
    hash = ((hash << 5) + hash + specJson.charCodeAt(i)) | 0;
  }
  // Convert to unsigned hex string
  return (hash >>> 0).toString(16);
}

/**
 * Validate a loaded cache against the current spec.
 * Returns the cache if valid, undefined if the spec has changed.
 */
export function validateCache(
  cache: unknown,
  currentSpecHash: string,
): FuzzCache | undefined {
  if (!isValidCacheShape(cache)) return undefined;
  if (cache.specHash !== currentSpecHash) return undefined;
  return cache;
}

/** Create an empty cache for a spec. */
export function createEmptyCache(specHash: string): FuzzCache {
  return {
    version: 1,
    specHash,
    passed: {},
  };
}

function isValidCacheShape(value: unknown): value is FuzzCache {
  if (!isPlainObject(value)) return false;
  return (
    value["version"] === 1 &&
    typeof value["specHash"] === "string" &&
    typeof value["passed"] === "object" &&
    value["passed"] !== null
  );
}
