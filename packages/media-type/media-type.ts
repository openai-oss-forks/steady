/**
 * Media type utilities built on @std/media-types.
 *
 * Provides a branded MediaTypeEssence type to prevent mixing up raw
 * Content-Type header values with parsed essences, and classification
 * functions following the WHATWG MIME Sniffing Standard.
 */

import { parseMediaType } from "@std/media-types/parse-media-type";

/** A parsed media type essence (e.g. "application/json"), not a raw header value. */
export type MediaTypeEssence = string & {
  readonly __brand: "MediaTypeEssence";
};

/** Wildcard media type from Accept headers. */
export type WildcardMediaType = MediaTypeEssence & "*/*";

/** Known form content types. */
export type MultipartFormData = MediaTypeEssence & "multipart/form-data";
export type UrlEncoded =
  & MediaTypeEssence
  & "application/x-www-form-urlencoded";

/** NDJSON content type variants. */
export type NdjsonMediaType =
  & MediaTypeEssence
  & (
    | "application/x-ndjson"
    | "application/ndjson"
    | "application/jsonl"
    | "application/x-jsonl"
    | "application/jsonlines"
    | "application/x-jsonlines"
    | "application/json-lines"
    | "application/x-ldjson"
    | "application/json-seq"
    | "text/x-ndjson"
  );

/** Server-Sent Events content type. */
export type SseMediaType = MediaTypeEssence & "text/event-stream";

/** Any streaming content type. */
export type StreamingMediaType = NdjsonMediaType | SseMediaType;

/**
 * Parse a Content-Type header value into its media type essence.
 * Strips parameters (charset, boundary, etc.) using the WHATWG MIME type parser.
 * Returns null if the input cannot be parsed.
 */
export function getMediaType(contentType: string): MediaTypeEssence | null {
  try {
    const [essence] = parseMediaType(contentType);
    return essence ? essence as MediaTypeEssence : null;
  } catch {
    return null;
  }
}

/**
 * Check if a media type essence is a JSON MIME type per the WHATWG MIME Sniffing Standard.
 * A JSON MIME type is any MIME type whose subtype ends in "+json"
 * or whose essence is "application/json" or "text/json".
 */
export function isJsonMediaType(essence: MediaTypeEssence): boolean {
  return essence === "application/json" ||
    essence === "text/json" ||
    essence.endsWith("+json");
}

/** Type guard for wildcard media type. */
export function isWildcard(
  essence: MediaTypeEssence,
): essence is WildcardMediaType {
  return essence === "*/*";
}

/** Check if a candidate essence matches a pattern. Wildcards match any candidate. */
export function essenceMatches(
  candidate: MediaTypeEssence,
  pattern: MediaTypeEssence,
): boolean {
  return candidate === pattern || isWildcard(pattern);
}

/** Type guard for multipart/form-data. */
export function isMultipartFormData(
  essence: MediaTypeEssence,
): essence is MultipartFormData {
  return essence === "multipart/form-data";
}

/** Type guard for application/x-www-form-urlencoded. */
export function isUrlEncoded(
  essence: MediaTypeEssence,
): essence is UrlEncoded {
  return essence === "application/x-www-form-urlencoded";
}

/** Type guard for any form content type. */
export function isFormMediaType(
  essence: MediaTypeEssence,
): essence is MultipartFormData | UrlEncoded {
  return isMultipartFormData(essence) || isUrlEncoded(essence);
}

/**
 * Check if a media type essence is a binary/opaque type.
 * These types carry raw bytes where the body should not be interpreted as text or JSON.
 */
export function isBinaryMediaType(essence: MediaTypeEssence): boolean {
  return essence === "application/octet-stream" ||
    essence.startsWith("image/") ||
    essence.startsWith("audio/") ||
    essence.startsWith("video/");
}

// ── Streaming media types ─────────────────────────────────────────

const NDJSON_TYPES: ReadonlySet<string> = new Set<NdjsonMediaType>([
  "application/x-ndjson" as NdjsonMediaType,
  "application/ndjson" as NdjsonMediaType,
  "application/jsonl" as NdjsonMediaType,
  "application/x-jsonl" as NdjsonMediaType,
  "application/jsonlines" as NdjsonMediaType,
  "application/x-jsonlines" as NdjsonMediaType,
  "application/json-lines" as NdjsonMediaType,
  "application/x-ldjson" as NdjsonMediaType,
  "application/json-seq" as NdjsonMediaType,
  "text/x-ndjson" as NdjsonMediaType,
]);

/** Type guard for NDJSON media types. */
export function isNdjsonMediaType(
  essence: MediaTypeEssence,
): essence is NdjsonMediaType {
  return NDJSON_TYPES.has(essence);
}

/** Type guard for Server-Sent Events. */
export function isSseMediaType(
  essence: MediaTypeEssence,
): essence is SseMediaType {
  return essence === "text/event-stream";
}

/** Type guard for any streaming content type (NDJSON or SSE). */
export function isStreamingMediaType(
  essence: MediaTypeEssence,
): essence is StreamingMediaType {
  return isNdjsonMediaType(essence) || isSseMediaType(essence);
}

/**
 * Get the streaming format for a media type essence.
 * Returns null if the essence is not a streaming type.
 */
export function getStreamingFormat(
  essence: MediaTypeEssence,
): "ndjson" | "sse" | null {
  if (isNdjsonMediaType(essence)) return "ndjson";
  if (isSseMediaType(essence)) return "sse";
  return null;
}
