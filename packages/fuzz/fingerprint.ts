/**
 * Structural fingerprinting for fuzz case deduplication.
 *
 * Two cases with the same fingerprint exercise the same validator
 * code path. Fingerprints are used for reporting and cache purposes.
 */

import type { MutationDetail } from "./types.ts";

/**
 * Compute a structural fingerprint for a fuzz case.
 *
 * The fingerprint captures which validator code path this case
 * exercises. Cases sharing a fingerprint are redundant from a
 * testing perspective.
 */
export function computeFingerprint(
  mutatorId: string,
  detail: MutationDetail,
): string {
  switch (mutatorId) {
    case "removeRequiredQueryParam":
      // Presence check is type-agnostic. All required query params
      // exercise the same validator branch.
      return "rmReqQuery";

    case "removeRequiredHeaderParam":
      return "rmReqHeader";

    case "wrongContentType":
      // Different if accepted types differ (json vs form-data).
      // But within the same content-type set, it's the same path.
      return "wrongCT";

    case "omitRequiredBody":
      return "omitBody";

    case "omitRequiredBodyField": {
      // Nesting depth matters (top-level vs nested object).
      const depth = detail.fieldDepth ?? 0;
      return `omitField:d${depth}`;
    }

    case "wrongBodyFieldType": {
      // Each type pair exercises a different type-check branch.
      const expected = detail.fieldType ?? "unknown";
      return `wrongType:${expected}`;
    }

    case "extraProperty":
      return "extraProp";

    case "wrongEnumValue":
      return "wrongEnum";

    default:
      // Unknown mutator: use mutatorId as fingerprint (no dedup).
      return mutatorId;
  }
}
