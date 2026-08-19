/**
 * Build valid request skeletons from operation info.
 *
 * Given an OperationInfo, produces a FuzzRequest that should pass
 * Steady's validation. Mutators then modify this baseline to create
 * invalid variants.
 */

import {
  effectiveItems,
  effectiveProperties,
  effectiveRequired,
  effectiveType,
  isSchema,
} from "@steady/json-schema";
import type { Schema } from "@steady/json-schema";
import type { FuzzRequest, OperationInfo, ParameterInfo } from "./types.ts";

/**
 * Build a valid baseline request for an operation.
 *
 * Fills path parameters, required query params, required headers,
 * correct content-type, and a body conforming to the schema.
 */
export function buildBaseline(op: OperationInfo): FuzzRequest {
  // Separate path from query disambiguation (e.g., /files?view=fileinfo).
  // The query portion is added to req.query so mutators can modify it.
  const queryIndex = op.path.indexOf("?");
  let path = queryIndex >= 0 ? op.path.slice(0, queryIndex) : op.path;

  // Build concrete path by replacing {param} with generated values
  for (const param of op.pathParams) {
    const value = generateParamValue(param);
    path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
  }

  // Query params: include all required ones
  const query: Record<string, string> = {};

  // Add query disambiguation values from the path pattern first.
  // These are routing-level requirements (e.g., view=fileinfo).
  if (queryIndex >= 0) {
    const pathQuery = new URLSearchParams(op.path.slice(queryIndex + 1));
    for (const [key, value] of pathQuery) {
      query[key] = value;
    }
  }

  // Then add declared required query params (may override path query values)
  for (const param of op.queryParams) {
    if (param.required) {
      query[param.name] = String(generateParamValue(param));
    }
  }

  // Headers: include required ones
  const headers: Record<string, string> = {};
  for (const param of op.headerParams) {
    if (param.required) {
      headers[param.name] = String(generateParamValue(param));
    }
  }

  // Body
  let body: unknown;
  if (op.bodyInfo) {
    const contentType = op.bodyInfo.contentTypes[0];
    if (contentType) {
      headers["content-type"] = contentType;
    }
    body = generateFromSchema(op.bodyInfo.schema);
  }

  return { path, method: op.method, headers, query, body };
}

/**
 * Generate a plausible value for a parameter based on its schema.
 */
function generateParamValue(param: ParameterInfo): string | number | boolean {
  if (!param.schema) return "test-value";
  return generateScalar(param.schema);
}

/**
 * Generate a scalar value matching a schema's type.
 */
function generateScalar(schema: Schema): string | number | boolean {
  // Use enum/const/default/example if available
  if (schema.const !== undefined) return primitiveToScalar(schema.const);
  if (schema.enum && schema.enum.length > 0) {
    return primitiveToScalar(schema.enum[0]);
  }
  if (schema.default !== undefined) return primitiveToScalar(schema.default);
  if (schema.example !== undefined) return primitiveToScalar(schema.example);

  const type = effectiveType(schema);

  switch (type) {
    case "integer":
      return generateInteger(schema);
    case "number":
      return generateNumber(schema);
    case "boolean":
      return true;
    case "string":
    default:
      return generateString(schema);
  }
}

function generateInteger(schema: Schema): number {
  const min = typeof schema.minimum === "number"
    ? Math.ceil(schema.minimum)
    : 1;
  const max = typeof schema.maximum === "number"
    ? Math.floor(schema.maximum)
    : min + 100;
  return min + Math.floor((max - min) / 2);
}

function generateNumber(schema: Schema): number {
  const min = typeof schema.minimum === "number" ? schema.minimum : 1.0;
  const max = typeof schema.maximum === "number" ? schema.maximum : min + 100.0;
  return min + (max - min) / 2;
}

function generateString(schema: Schema): string {
  if (schema.format === "email") return "test@example.com";
  if (schema.format === "uri") return "https://example.com";
  if (schema.format === "uuid") return "550e8400-e29b-41d4-a716-446655440000";
  if (schema.format === "date") return "2024-01-15";
  if (schema.format === "date-time") return "2024-01-15T12:00:00Z";
  if (schema.format === "ipv4") return "192.168.1.1";
  if (schema.format === "ipv6") return "::1";

  const minLen = typeof schema.minLength === "number" ? schema.minLength : 1;
  // Produce a string that meets minLength
  return "test-value".padEnd(minLen, "x");
}

/**
 * Generate a value from a JSON Schema (supports objects, arrays, scalars).
 */
export function generateFromSchema(schema: Schema): unknown {
  // Handle boolean schemas at the call site; this function only handles objects.
  const type = effectiveType(schema);

  if (type === "object" || effectiveProperties(schema)) {
    return generateObject(schema);
  }

  if (type === "array") {
    return generateArray(schema);
  }

  // Scalar
  return generateScalar(schema);
}

function generateObject(schema: Schema): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const properties = effectiveProperties(schema) ?? {};
  const required = new Set(effectiveRequired(schema));

  for (const [name, propSchemaRaw] of Object.entries(properties)) {
    // Only populate required fields (keeps baseline minimal)
    if (!required.has(name)) continue;

    if (isSchema(propSchemaRaw)) {
      result[name] = generateFromSchema(propSchemaRaw);
    } else if (typeof propSchemaRaw === "boolean") {
      // boolean schema: true = any value, false = impossible
      if (propSchemaRaw) {
        result[name] = "test-value";
      }
    }
  }

  return result;
}

function generateArray(schema: Schema): unknown[] {
  const itemSchema = effectiveItems(schema);
  if (isSchema(itemSchema)) {
    return [generateFromSchema(itemSchema)];
  }
  return ["test-value"];
}

function primitiveToScalar(value: unknown): string | number | boolean {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  return String(value);
}
