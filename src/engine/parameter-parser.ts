/**
 * Format-aware query parameter parsing.
 *
 * Called by the diagnostic engine per-parameter. Handles:
 * - Format resolution (auto -> concrete via style/explode)
 * - Wire encoding resolution (schema + formats -> encoding kind)
 * - Structural parsing (getArrayValues, parseObjectValue, parseNestedArrayValues)
 * - Deep coercion (string -> number/boolean at leaf level)
 *
 * The engine stays as orchestrator; this module does the parsing work.
 * Schema inspection and coercion are delegated to @steady/json-schema.
 */

import {
  coerceDeep,
  coerceScalar,
  effectiveProperties,
  isArraySchema,
  isObjectSchema,
} from "@steady/json-schema";
import type { Schema } from "@steady/json-schema";
import type { KeyValueSource } from "../param-format.ts";
import {
  getArrayValues,
  hasParamValue,
  parseFormEntries,
  parseNestedArrayValues,
  parseObjectValue,
  resolveArrayFormat,
  resolveObjectFormat,
  resolveParamEncoding,
} from "../param-format.ts";
import type { QueryArrayFormat, QueryObjectFormat } from "../types.ts";
import type { ResolvedParameter } from "./diagnostic-engine.ts";

// Re-export for consumers that import from this module
export {
  coerceDeep,
  coerceScalar,
  isArraySchema,
  isObjectSchema,
} from "@steady/json-schema";

// ── Public types ───────────────────────────────────────────────────

export interface ParsedParam {
  present: boolean;
  value?: unknown;
}

// ── Non-query parameter deserialization ────────────────────────────

/**
 * Deserialize a non-query parameter (header, path, cookie) value.
 *
 * Unlike query/form params which have multiple serialization formats
 * (repeat, comma, pipe, brackets, etc.), non-query params are always
 * comma-separated per the OpenAPI spec and HTTP standards:
 *
 * - Headers: restricted to style=simple (OpenAPI 3.x spec, "Style Values" table)
 * - Path: defaults to style=simple (label/matrix exist but are rare)
 * - Cookies: restricted to style=form (single string value)
 *
 * HTTP itself constrains header values to comma-separated lists (RFC 9110
 * Section 5.3). Every major SDK generator (OpenAPI Generator, Speakeasy,
 * Swagger Codegen) uses .join(",") for header arrays. API gateways (Kong,
 * AWS API Gateway, Apigee) all treat header arrays as comma-separated.
 * No real-world APIs use pipe, space, or bracket formats for headers.
 *
 * No user-configurable format flags are needed here (unlike query params)
 * because there is only one valid serialization.
 *
 * Serialization per OpenAPI 3.x spec:
 *   Array  (any explode):    "blue,black,brown"
 *   Object (explode=false):  "R,100,G,200,B,150"
 *   Object (explode=true):   "R=100,G=200,B=150"
 *   Scalar:                  "blue"
 */
export function deserializeNonQueryParam(
  raw: string,
  param: ResolvedParameter,
): unknown {
  const schema = param.schema;
  if (!schema || typeof schema === "boolean") return raw;

  const isArray = isArraySchema(schema);
  const isObj = isObjectSchema(schema);

  if (!isArray && !isObj) return coerceScalar(raw, schema);

  // simple (header/path default): explode defaults to false
  // form (cookie default): explode defaults to true
  const style = param.style ?? (param.in === "cookie" ? "form" : "simple");
  const explode = param.explode ?? (style === "form");

  if (isArray) {
    const values = raw.split(",").map((s) => s.trim());
    return coerceDeep(values, schema);
  }

  // Object: explode=true means "R=100,G=200,B=150"
  if (explode) {
    const obj: Record<string, string> = Object.create(null);
    for (const segment of raw.split(",")) {
      const eqIdx = segment.indexOf("=");
      if (eqIdx !== -1) {
        obj[segment.slice(0, eqIdx).trim()] = segment.slice(eqIdx + 1).trim();
      }
    }
    return coerceDeep(obj, schema);
  }

  // Object: explode=false means "R,100,G,200,B,150" (alternating key,value)
  const parts = raw.split(",").map((s) => s.trim());
  const obj: Record<string, string> = Object.create(null);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const key = parts[i];
    const val = parts[i + 1];
    if (key !== undefined && val !== undefined) {
      obj[key] = val;
    }
  }
  return coerceDeep(obj, schema);
}

// ── Main parse function ────────────────────────────────────────────

/** Parse a single query parameter using format-aware logic. */
export function parseQueryParam(
  source: KeyValueSource,
  param: ResolvedParameter,
  queryArrayFormat: QueryArrayFormat,
  queryObjectFormat: QueryObjectFormat,
): ParsedParam {
  const schema = param.schema;

  // No schema or boolean schema: treat as simple scalar
  if (!schema || typeof schema === "boolean") {
    const raw = source.get(param.name);
    if (raw === null) return { present: false };
    return { present: true, value: raw };
  }

  const arrayFmt = resolveArrayFormat(
    queryArrayFormat,
    param.style,
    param.explode,
  );
  const objectFmt = resolveObjectFormat(
    queryObjectFormat,
    param.style,
    param.explode,
  );
  const encoding = resolveParamEncoding(schema, arrayFmt, objectFmt);

  // Flat objects need schema-aware presence checking (iterate property names)
  if (encoding.kind === "flat-object" && encoding.objectFmt === "flat") {
    const value = parseFlatObject(source, param.name, schema);
    const hasKeys = Object.keys(value).length > 0;
    if (!hasKeys) return { present: false };
    return { present: true, value: coerceDeep(value, schema) };
  }

  if (!hasParamValue(source, param.name, encoding)) {
    return { present: false };
  }

  switch (encoding.kind) {
    case "scalar": {
      const raw = source.get(param.name);
      if (raw === null) return { present: false };
      return { present: true, value: coerceScalar(raw, schema) };
    }

    case "flat-array": {
      const raw = getArrayValues(source, param.name, encoding.arrayFmt);
      return { present: true, value: coerceDeep(raw, schema) };
    }

    case "flat-object": {
      // flat-comma (flat is handled above)
      const value = parseObjectValue(source, param.name, encoding.objectFmt);
      return { present: true, value: coerceDeep(value, schema) };
    }

    case "nested": {
      if (encoding.objectFmt === "brackets") {
        const paramEntries: [string, string][] = [];
        const prefix = `${param.name}[`;
        for (const [key, value] of source.entries()) {
          if (key.startsWith(prefix)) paramEntries.push([key, value]);
        }
        if (paramEntries.length === 0) return { present: false };
        const wrapperSchema = {
          type: "object" as const,
          properties: { [param.name]: schema },
        };
        const tree = parseFormEntries(
          paramEntries,
          wrapperSchema,
          { array: "brackets", object: "brackets" },
        );
        return { present: true, value: tree[param.name] };
      }
      // Dots format: existing logic
      if (isArraySchema(schema)) {
        const items = parseNestedArrayValues(
          source,
          param.name,
        );
        return { present: true, value: coerceDeep(items, schema) };
      }
      const value = parseObjectValue(source, param.name, encoding.objectFmt);
      return { present: true, value: coerceDeep(value, schema) };
    }
  }
}

// ── Flat object helper ────────────────────────────────────────────

/**
 * Parse a flat-format object query parameter. Flat format encodes each
 * object property as a separate top-level query key (e.g., name=sam&age=30
 * for parameter "user" with properties {name, age}). Requires schema
 * properties to know which keys belong to this parameter.
 */
function parseFlatObject(
  source: KeyValueSource,
  name: string,
  schema: Schema,
): Record<string, unknown> {
  if (typeof schema === "boolean") return {};
  const props = effectiveProperties(schema);
  if (!props) {
    // No properties defined; try the single value
    const raw = source.get(name);
    if (raw !== null) {
      const result: Record<string, unknown> = Object.create(null);
      result[name] = raw;
      return result;
    }
    return {};
  }

  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(props)) {
    const raw = source.get(key);
    if (raw !== null) {
      result[key] = raw;
    }
  }
  return result;
}

// ── Expected keys computation ──────────────────────────────────────

/**
 * Build the set of expected query keys for unknown-param detection.
 * Returns known exact keys and dynamic prefixes (for bracket/dot notation).
 */
export function getExpectedQueryKeys(
  params: ResolvedParameter[],
  queryArrayFormat: QueryArrayFormat,
  queryObjectFormat: QueryObjectFormat,
): { known: Set<string>; dynamicPrefixes: Set<string> } {
  const known = new Set<string>();
  const dynamicPrefixes = new Set<string>();

  for (const param of params) {
    if (param.in !== "query") continue;

    known.add(param.name);

    const schema = param.schema;
    if (!schema || typeof schema === "boolean") continue;

    const arrayFmt = resolveArrayFormat(
      queryArrayFormat,
      param.style,
      param.explode,
    );
    const objectFmt = resolveObjectFormat(
      queryObjectFormat,
      param.style,
      param.explode,
    );
    const encoding = resolveParamEncoding(schema, arrayFmt, objectFmt);

    switch (encoding.kind) {
      case "flat-array":
        if (encoding.arrayFmt === "brackets") {
          known.add(`${param.name}[]`);
        }
        break;

      case "flat-object":
        if (encoding.objectFmt === "flat") {
          const props = effectiveProperties(schema);
          if (props) {
            for (const key of Object.keys(props)) {
              known.add(key);
            }
          }
        }
        // flat-comma uses param name itself (already added)
        break;

      case "nested":
        if (encoding.objectFmt === "dots") {
          dynamicPrefixes.add(`${param.name}.`);
        } else {
          dynamicPrefixes.add(`${param.name}[`);
        }
        break;
    }
  }

  return { known, dynamicPrefixes };
}
