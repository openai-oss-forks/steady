/**
 * Schema Indexer - Builds efficient indexes for runtime operations
 *
 * Pre-computes various indexes to enable O(1) lookups during validation
 * and response generation. This is critical for performance with large schemas.
 */

import {
  formatFragmentPointer,
  type FragmentPointer,
  type PointerPath,
} from "@steady/json-pointer";
import type {
  ComplexityMetrics,
  ProcessedSchema,
  Schema,
  SchemaMetadata,
  SchemaSource,
} from "./types.ts";

export class SchemaIndexer {
  /**
   * Build comprehensive indexes from a schema
   */
  index(
    schema: Schema | boolean,
    refs: ProcessedSchema["refs"],
    source?: SchemaSource,
  ): ProcessedSchema {
    const index: ProcessedSchema["index"] = {
      byPointer: new Map(),
      byId: new Map(),
      byAnchor: new Map(),
      definitions: new Map(),
      byType: new Map(),
      byFormat: new Map(),
      byKeyword: new Map(),
    };

    const formats = new Set<string>();
    const features = new Set<string>();

    // Walk the schema tree once, building all indexes
    this.walkSchema(schema, [], (subSchema, pointer) => {
      // Add to pointer index
      index.byPointer.set(pointer, subSchema);

      if (typeof subSchema === "boolean") return;

      // ID index
      if (subSchema.$id) {
        index.byId.set(subSchema.$id, subSchema);
      }

      // Anchor index
      if (subSchema.$anchor) {
        index.byAnchor.set(subSchema.$anchor, subSchema);
      }

      // Type index
      if (subSchema.type) {
        const types = Array.isArray(subSchema.type)
          ? subSchema.type
          : [subSchema.type];
        for (const type of types) {
          let typeSet = index.byType.get(type);
          if (!typeSet) {
            typeSet = new Set();
            index.byType.set(type, typeSet);
          }
          typeSet.add(pointer);
        }
      }

      // Format index
      if (subSchema.format) {
        formats.add(subSchema.format);
        let formatSet = index.byFormat.get(subSchema.format);
        if (!formatSet) {
          formatSet = new Set();
          index.byFormat.set(subSchema.format, formatSet);
        }
        formatSet.add(pointer);
      }

      // Keyword index for feature detection
      this.indexKeywords(subSchema, pointer, index.byKeyword, features);

      // Track definitions
      if (
        pointer.startsWith("#/$defs/") || pointer.startsWith("#/definitions/")
      ) {
        index.definitions.set(pointer, subSchema);
      }
    });

    // Calculate metadata (compute maxDepth once, reuse in complexity)
    const maxDepth = this.calculateMaxDepth(schema);
    const metadata: SchemaMetadata = {
      totalSchemas: index.byPointer.size,
      totalRefs: refs.resolved.size,
      maxDepth,
      complexity: this.calculateComplexity(schema, index, refs, maxDepth),
      formats,
      features,
    };

    return {
      root: schema,
      refs,
      index,
      metadata,
      source: source || {},
    };
  }

  /**
   * Walk the schema tree, calling visitor for each sub-schema.
   *
   * Recursion is path-structural; each child appends a segment via
   * `[...path, segment]`. The visitor receives a formatted
   * `FragmentPointer` (the edge) and can use it as a map key, prefix
   * check, etc. Cycle detection uses the formatted pointer string so
   * that equivalent paths deduplicate consistently with how downstream
   * indexes store them.
   */
  private walkSchema(
    schema: Schema | boolean,
    path: PointerPath,
    visitor: (schema: Schema | boolean, pointer: FragmentPointer) => void,
    visited = new Set<FragmentPointer>(),
  ): void {
    const pointer = formatFragmentPointer(path);

    // Prevent infinite recursion
    if (visited.has(pointer)) return;
    visited.add(pointer);

    // Visit current schema
    visitor(schema, pointer);

    if (typeof schema === "boolean") return;

    // Walk all possible schema locations
    if (schema.$defs) {
      for (const [key, subSchema] of Object.entries(schema.$defs)) {
        this.walkSchema(subSchema, [...path, "$defs", key], visitor, visited);
      }
    }

    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        this.walkSchema(
          subSchema,
          [...path, "properties", key],
          visitor,
          visited,
        );
      }
    }

    if (schema.patternProperties) {
      for (
        const [pattern, subSchema] of Object.entries(schema.patternProperties)
      ) {
        this.walkSchema(
          subSchema,
          [...path, "patternProperties", pattern],
          visitor,
          visited,
        );
      }
    }

    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      this.walkSchema(
        schema.additionalProperties,
        [...path, "additionalProperties"],
        visitor,
        visited,
      );
    }

    if (schema.items) {
      if (Array.isArray(schema.items)) {
        schema.items.forEach((subSchema, index) => {
          this.walkSchema(
            subSchema,
            [...path, "items", String(index)],
            visitor,
            visited,
          );
        });
      } else {
        this.walkSchema(schema.items, [...path, "items"], visitor, visited);
      }
    }

    if (schema.prefixItems) {
      schema.prefixItems.forEach((subSchema, index) => {
        this.walkSchema(
          subSchema,
          [...path, "prefixItems", String(index)],
          visitor,
          visited,
        );
      });
    }

    if (schema.contains) {
      this.walkSchema(schema.contains, [...path, "contains"], visitor, visited);
    }

    if (schema.propertyNames) {
      this.walkSchema(
        schema.propertyNames,
        [...path, "propertyNames"],
        visitor,
        visited,
      );
    }

    // Composition schemas
    if (schema.allOf) {
      schema.allOf.forEach((subSchema, index) => {
        this.walkSchema(
          subSchema,
          [...path, "allOf", String(index)],
          visitor,
          visited,
        );
      });
    }

    if (schema.anyOf) {
      schema.anyOf.forEach((subSchema, index) => {
        this.walkSchema(
          subSchema,
          [...path, "anyOf", String(index)],
          visitor,
          visited,
        );
      });
    }

    if (schema.oneOf) {
      schema.oneOf.forEach((subSchema, index) => {
        this.walkSchema(
          subSchema,
          [...path, "oneOf", String(index)],
          visitor,
          visited,
        );
      });
    }

    if (schema.not) {
      this.walkSchema(schema.not, [...path, "not"], visitor, visited);
    }

    // Conditional schemas
    if (schema.if) {
      this.walkSchema(schema.if, [...path, "if"], visitor, visited);
    }

    if (schema.then) {
      this.walkSchema(schema.then, [...path, "then"], visitor, visited);
    }

    if (schema.else) {
      this.walkSchema(schema.else, [...path, "else"], visitor, visited);
    }

    // Dependent schemas
    if (schema.dependentSchemas) {
      for (const [key, subSchema] of Object.entries(schema.dependentSchemas)) {
        this.walkSchema(
          subSchema,
          [...path, "dependentSchemas", key],
          visitor,
          visited,
        );
      }
    }

    // Unevaluated properties/items
    if (
      schema.unevaluatedProperties &&
      typeof schema.unevaluatedProperties === "object"
    ) {
      this.walkSchema(
        schema.unevaluatedProperties,
        [...path, "unevaluatedProperties"],
        visitor,
        visited,
      );
    }

    if (
      schema.unevaluatedItems && typeof schema.unevaluatedItems === "object"
    ) {
      this.walkSchema(
        schema.unevaluatedItems,
        [...path, "unevaluatedItems"],
        visitor,
        visited,
      );
    }
  }

  /**
   * Index keywords for feature detection
   */
  private indexKeywords(
    schema: Schema,
    pointer: FragmentPointer,
    keywordIndex: Map<string, Set<string>>,
    features: Set<string>,
  ): void {
    const keywords = Object.keys(schema).filter((k) => !k.startsWith("$"));

    for (const keyword of keywords) {
      features.add(keyword);

      let kwSet = keywordIndex.get(keyword);
      if (!kwSet) {
        kwSet = new Set();
        keywordIndex.set(keyword, kwSet);
      }
      kwSet.add(pointer);
    }

    // Track specific features
    if (schema.if || schema.then || schema.else) {
      features.add("conditional");
    }

    if (schema.unevaluatedProperties || schema.unevaluatedItems) {
      features.add("unevaluated");
    }

    if (schema.$dynamicRef || schema.$dynamicAnchor) {
      features.add("dynamic");
    }

    if (schema.dependentSchemas || schema.dependentRequired) {
      features.add("dependencies");
    }
  }

  /**
   * Calculate maximum depth of schema nesting
   */
  private calculateMaxDepth(
    schema: Schema | boolean,
    currentDepth = 0,
    visited = new WeakSet<object>(),
  ): number {
    if (typeof schema === "boolean") {
      return currentDepth;
    }

    if (currentDepth > 100) {
      return currentDepth;
    }

    // Use object identity for cycle detection (more efficient than stringify)
    if (visited.has(schema)) {
      return currentDepth; // Already visited this schema object
    }
    visited.add(schema);

    let maxDepth = currentDepth;

    const checkDepth = (subSchema: Schema | boolean) => {
      const depth = this.calculateMaxDepth(
        subSchema,
        currentDepth + 1,
        visited,
      );
      maxDepth = Math.max(maxDepth, depth);
    };

    // Check all nested schemas
    if (schema.properties) {
      Object.values(schema.properties).forEach(checkDepth);
    }

    if (schema.items && !Array.isArray(schema.items)) {
      checkDepth(schema.items);
    }

    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      checkDepth(schema.additionalProperties);
    }

    if (schema.allOf) schema.allOf.forEach(checkDepth);
    if (schema.anyOf) schema.anyOf.forEach(checkDepth);
    if (schema.oneOf) schema.oneOf.forEach(checkDepth);
    if (schema.not) checkDepth(schema.not);

    return maxDepth;
  }

  /**
   * Calculate complexity metrics
   */
  private calculateComplexity(
    _schema: Schema | boolean,
    index: ProcessedSchema["index"],
    refs: ProcessedSchema["refs"],
    maxDepth: number,
  ): ComplexityMetrics {
    const score = index.byPointer.size * 5 + // Base complexity per schema
      refs.resolved.size * 10 + // References add complexity
      refs.cyclic.size * 50 + // Circular refs are complex
      (index.byKeyword.get("allOf")?.size || 0) * 20 + // Composition is complex
      (index.byKeyword.get("anyOf")?.size || 0) * 15 +
      (index.byKeyword.get("oneOf")?.size || 0) * 15 +
      (index.byKeyword.get("if")?.size || 0) * 25; // Conditionals are complex

    return {
      score,
      circularRefs: refs.cyclic.size,
      maxNesting: maxDepth,
      totalKeywords: Array.from(index.byKeyword.values())
        .reduce((sum, set) => sum + set.size, 0),
    };
  }
}
