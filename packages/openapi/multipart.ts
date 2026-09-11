/**
 * Per-property content type resolution for multipart request bodies.
 *
 * OpenAPI 3.1 specifies, per property of a multipart body, what
 * `Content-Type` each part should have. It is explicit when
 * `encoding[prop].contentType` is declared and derived from the
 * property's schema otherwise (section 4.8.14.5):
 *
 *   - `type: string` with `format: "binary"` or `contentEncoding`
 *     -> `application/octet-stream`
 *   - complex type (object or array of objects, walking composition
 *     and `$ref`) -> `application/json`
 *   - primitive or array of primitives -> `text/plain`
 *
 * This module exposes that as a pure function over `MediaTypeObject`
 * and `SchemaRegistry`. The output is a map from property name to
 * `MediaTypeEssence` (the branded, parsed type from
 * `@steady/media-type`) so that downstream consumers never re-parse a
 * raw content-type string.
 */

import {
  effectiveItems,
  effectiveType,
  isObjectSchema,
  type Schema,
  type SchemaRegistry,
} from "@steady/json-schema";
import {
  getMediaType,
  isJsonMediaType,
  type MediaTypeEssence,
} from "@steady/media-type";
import type {
  MediaTypeObject,
  ReferenceObject,
  SchemaObject,
} from "./openapi.ts";

/**
 * Pre-parse a known-good media type at module load. Throws if the
 * input is not a parseable essence; used only for the OAS 3.1
 * default constants below.
 */
function parseEssence(raw: string): MediaTypeEssence {
  const essence = getMediaType(raw);
  if (!essence) throw new Error(`Invalid media type constant: ${raw}`);
  return essence;
}

const JSON_ESSENCE = parseEssence("application/json");
const OCTET_STREAM_ESSENCE = parseEssence("application/octet-stream");
const TEXT_PLAIN_ESSENCE = parseEssence("text/plain");

/**
 * Resolve the per-property `Content-Type` map for a multipart body.
 *
 * Entries are returned for every property that appears either in the
 * schema or in `encoding`. A property is omitted from the result when
 * its content type cannot be determined (no schema and no encoding,
 * or an encoding `contentType` string that does not parse). The
 * consumer treats a missing entry as "unknown; use the default
 * parser".
 */
export function resolvePartContentTypes(
  mediaType: MediaTypeObject,
  registry: SchemaRegistry,
): Record<string, MediaTypeEssence> {
  const result: Record<string, MediaTypeEssence> = {};

  const rootSchema = resolveForInference(mediaType.schema, registry);
  const properties = rootSchema ? propertyConstraints(rootSchema) : null;
  const names = new Set<string>();
  if (properties) {
    for (const name of Object.keys(properties)) names.add(name);
  }
  if (mediaType.encoding) {
    for (const name of Object.keys(mediaType.encoding)) names.add(name);
  }

  for (const name of names) {
    const propSchema = properties?.[name];
    const implicit = implicitEssence(propSchema, registry);

    const explicitRaw = mediaType.encoding?.[name]?.contentType;
    if (explicitRaw !== undefined) {
      const explicit = getMediaType(explicitRaw);
      if (!explicit) continue;

      // Reconcile explicit Content-Type with the schema. When the
      // explicit encoding is JSON but the schema implies a non-JSON
      // value (primitive -> text/plain, format:binary -> octet-stream),
      // the schema wins. The explicit Content-Type is transport
      // metadata about the part's serialization; the API value is
      // still a string or bytes, not a parsed JSON tree. This is the
      // pattern used by specs that describe a string whose contents
      // happen to be JSON text.
      if (implicit && isJsonMediaType(explicit) && !isJsonMediaType(implicit)) {
        result[name] = implicit;
        continue;
      }
      result[name] = explicit;
      continue;
    }

    if (implicit) result[name] = implicit;
  }

  return result;
}

/** Collect every contribution without overwriting a property's type with a refinement. */
function propertyConstraints(root: Schema): Record<string, Schema> {
  const contributions = new Map<string, Schema[]>();
  const pending = [root];
  while (pending.length) {
    const schema = pending.pop()!;
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const members = contributions.get(name) ?? [];
      members.push(property);
      contributions.set(name, members);
    }
    // Only conjunctions contribute unconditional constraints. Root alternatives
    // may give the same field incompatible types; choosing one parser would
    // corrupt valid values from another branch (for example the string "null").
    pending.push(...schema.allOf ?? []);
  }
  // This is only a shape-inference view; validation uses the original schema.
  return Object.fromEntries(
    [...contributions].map(([name, members]) => [name, { allOf: members }]),
  );
}

/**
 * OAS 3.1 default content type for a property with no explicit
 * encoding. Walks composition and resolves `$ref` through the
 * registry. Returns null if the property schema is absent or a
 * boolean schema (effectively "any").
 */
function implicitEssence(
  propSchema: Schema | ReferenceObject | undefined,
  registry: SchemaRegistry,
): MediaTypeEssence | null {
  const resolved = resolveForInference(propSchema, registry);
  if (!resolved) return null;

  if (isBinaryByEncoding(resolved)) return OCTET_STREAM_ESSENCE;

  const types = inferredTypes(resolved);
  if (!types) return null;
  types.delete("null");
  const essences = new Set<MediaTypeEssence>();
  for (const type of types) {
    if (type === "object") essences.add(JSON_ESSENCE);
    else if (type === "array") {
      const items = effectiveItems(resolved);
      const itemTypes = items ? inferredTypes(items) : null;
      if (!items || !itemTypes || itemTypes.size === 0) return null;
      if (itemTypes.size > 1) itemTypes.delete("null");
      if (isBinaryByEncoding(items)) essences.add(OCTET_STREAM_ESSENCE);
      else {
        for (const itemType of itemTypes) {
          essences.add(
            itemType === "object" || itemType === "array"
              ? JSON_ESSENCE
              : TEXT_PLAIN_ESSENCE,
          );
        }
      }
    } else essences.add(TEXT_PLAIN_ESSENCE);
  }
  // A field accepting both strings/files and objects has no unambiguous
  // default decoder. In particular, the literal string "null" must stay a string.
  return essences.size === 1 ? [...essences][0]! : null;
}

/** Infer possible types, preserving intersections and alternatives separately. */
function inferredTypes(schema: Schema): Set<string> | null {
  const local = {
    ...schema,
    allOf: undefined,
    anyOf: undefined,
    oneOf: undefined,
  };
  const localType = schema.type ?? effectiveType(local) ??
    (isObjectSchema(local) ? "object" : null);
  let types: Set<string> | null = localType
    ? new Set(Array.isArray(localType) ? localType : [localType])
    : null;
  const constrain = (constraint: Set<string> | null) => {
    if (constraint) {
      types = types
        ? new Set([...types].filter((type) => constraint.has(type)))
        : constraint;
    }
  };
  for (const member of schema.allOf ?? []) constrain(inferredTypes(member));
  for (const key of ["anyOf", "oneOf"] as const) {
    if (!schema[key]) continue;
    const alternatives = schema[key].map(inferredTypes);
    // An unconstrained alternative can have any type. It cannot justify decoding.
    if (alternatives.some((alternative) => alternative === null)) continue;
    constrain(
      new Set(alternatives.flatMap((alternative) => [...alternative!])),
    );
  }
  return types;
}

/**
 * `format: "binary"` or `contentEncoding` both indicate the value is
 * raw bytes. Either triggers `application/octet-stream` per OAS 3.1.
 */
function isBinaryByEncoding(schema: Schema): boolean {
  return schema.format === "binary" || schema.contentEncoding !== undefined ||
    (schema.allOf?.some(isBinaryByEncoding) ?? false);
}

/**
 * Resolve only the shape needed by the schema inspection helpers: references,
 * composition, and items. Do not expand object properties (which can recurse).
 * Unknown or cyclic references stay unknown rather than becoming text/plain.
 * A shared node budget also bounds repeated expansion in acyclic reference graphs.
 * The returned copy never changes the registry's validation schemas.
 */
function resolveForInference(
  value: SchemaObject | ReferenceObject | undefined,
  registry: SchemaRegistry,
  ancestors = new Set<SchemaObject>(),
  budget = { remaining: 1000 },
): SchemaObject | undefined {
  if (
    !value || typeof value === "boolean" || ancestors.has(value) ||
    ancestors.size >= 50 || budget.remaining-- <= 0
  ) {
    return undefined;
  }
  ancestors.add(value);
  try {
    const { $ref, ...schema } = value as SchemaObject;
    for (const key of ["allOf", "anyOf", "oneOf"] as const) {
      if (schema[key]) {
        schema[key] = schema[key].map((member) =>
          resolveForInference(member, registry, ancestors, budget) ?? {}
        );
      }
    }
    if (schema.items && !Array.isArray(schema.items)) {
      schema.items =
        resolveForInference(schema.items, registry, ancestors, budget) ??
          {};
    }
    if ($ref) {
      const target = registry.resolveRef($ref)?.raw;
      const resolved = typeof target === "boolean"
        ? undefined
        : resolveForInference(target, registry, ancestors, budget);
      if (resolved) schema.allOf = [resolved, ...schema.allOf ?? []];
    }
    return schema;
  } finally {
    ancestors.delete(value);
  }
}
