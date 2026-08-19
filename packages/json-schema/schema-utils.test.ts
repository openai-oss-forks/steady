/**
 * Tests for schema-utils.ts
 *
 * Schema inspection and coercion utilities that walk composition keywords.
 */

import { assertEquals } from "@std/assert";
import type { Schema } from "./types.ts";
import {
  coerceDeep,
  coerceFormValue,
  coerceScalar,
  effectiveItems,
  effectiveProperties,
  effectiveRequired,
  effectiveType,
  isArraySchema,
  isObjectSchema,
} from "./schema-utils.ts";

// ── effectiveType ─────────────────────────────────────────────────

Deno.test("effectiveType: direct type", () => {
  assertEquals(effectiveType({ type: "integer" }), "integer");
  assertEquals(effectiveType({ type: "string" }), "string");
  assertEquals(effectiveType({ type: "number" }), "number");
  assertEquals(effectiveType({ type: "boolean" }), "boolean");
  assertEquals(effectiveType({ type: "object" }), "object");
  assertEquals(effectiveType({ type: "array" }), "array");
});

Deno.test("effectiveType: type array filters null", () => {
  assertEquals(effectiveType({ type: ["null", "string"] }), "string");
  assertEquals(effectiveType({ type: ["integer", "null"] }), "integer");
});

Deno.test("effectiveType: allOf member type", () => {
  assertEquals(effectiveType({ allOf: [{ type: "integer" }] }), "integer");
  assertEquals(
    effectiveType({
      allOf: [{ type: "object" }, { type: "object" }],
    }),
    "object",
  );
});

Deno.test("effectiveType: anyOf member type (prefers non-string)", () => {
  assertEquals(
    effectiveType({ anyOf: [{ type: "integer" }, { type: "null" }] }),
    "integer",
  );
  assertEquals(
    effectiveType({ anyOf: [{ type: "string" }, { type: "null" }] }),
    "string",
  );
});

Deno.test("effectiveType: oneOf member type (prefers non-string)", () => {
  assertEquals(
    effectiveType({ oneOf: [{ type: "integer" }, { type: "string" }] }),
    "integer",
  );
});

Deno.test("effectiveType: nested allOf", () => {
  assertEquals(
    effectiveType({ allOf: [{ allOf: [{ type: "number" }] }] }),
    "number",
  );
});

Deno.test("effectiveType: structural inference from properties", () => {
  assertEquals(
    effectiveType({ properties: { name: { type: "string" } } }),
    "object",
  );
});

Deno.test("effectiveType: structural inference from items", () => {
  assertEquals(
    effectiveType({ items: { type: "string" } }),
    "array",
  );
});

Deno.test("effectiveType: structural inference from string keywords", () => {
  assertEquals(effectiveType({ pattern: "^[a-z]+$" }), "string");
  assertEquals(effectiveType({ minLength: 1 }), "string");
  assertEquals(effectiveType({ maxLength: 100 }), "string");
});

Deno.test("effectiveType: structural inference from numeric keywords", () => {
  assertEquals(effectiveType({ minimum: 0 }), "number");
  assertEquals(effectiveType({ maximum: 100 }), "number");
  assertEquals(effectiveType({ multipleOf: 2 }), "number");
});

Deno.test("effectiveType: structural inference through allOf", () => {
  assertEquals(
    effectiveType({
      allOf: [{ properties: { name: { type: "string" } } }],
    }),
    "object",
  );
});

Deno.test("effectiveType: boolean schema returns null", () => {
  assertEquals(effectiveType(true), null);
  assertEquals(effectiveType(false), null);
});

Deno.test("effectiveType: empty schema returns null", () => {
  assertEquals(effectiveType({}), null);
});

Deno.test("effectiveType: direct type takes priority over structural inference", () => {
  assertEquals(
    effectiveType({ type: "string", properties: { x: {} } }),
    "string",
  );
});

Deno.test("effectiveType: empty allOf falls through to structural inference", () => {
  assertEquals(
    effectiveType({ allOf: [], properties: { x: {} } }),
    "object",
  );
});

Deno.test("effectiveType: empty anyOf with direct type", () => {
  assertEquals(effectiveType({ anyOf: [], type: "number" }), "number");
});

Deno.test("effectiveType: boolean schema inside allOf is skipped", () => {
  // JSON Schema allows boolean schemas in composition arrays.
  // The TypeScript types are too narrow (Schema[] vs (Schema|boolean)[])
  // but the runtime handles it.
  assertEquals(
    // deno-lint-ignore no-explicit-any
    effectiveType({ allOf: [true as any, { type: "integer" }] }),
    "integer",
  );
});

Deno.test("effectiveType: boolean schema inside anyOf is skipped", () => {
  assertEquals(
    // deno-lint-ignore no-explicit-any
    effectiveType({ anyOf: [false as any, { type: "string" }] }),
    "string",
  );
});

Deno.test("effectiveType: deeply nested allOf inside anyOf", () => {
  assertEquals(
    effectiveType({
      anyOf: [
        { type: "null" },
        { allOf: [{ allOf: [{ type: "integer" }] }] },
      ],
    }),
    "integer",
  );
});

Deno.test("effectiveType: nullable anyOf returns the non-null type", () => {
  assertEquals(
    effectiveType({ anyOf: [{ type: "string" }, { type: "null" }] }),
    "string",
  );
});

Deno.test("effectiveType: all-null anyOf returns null", () => {
  assertEquals(
    effectiveType({ anyOf: [{ type: "null" }, { type: "null" }] }),
    null,
  );
});

Deno.test("effectiveType: structural inference via patternProperties", () => {
  assertEquals(
    effectiveType({ patternProperties: { "^x-": { type: "string" } } }),
    "object",
  );
});

Deno.test("effectiveType: structural inference via prefixItems", () => {
  assertEquals(
    effectiveType({ prefixItems: [{ type: "string" }] }),
    "array",
  );
});

// ── effectiveProperties ───────────────────────────────────────────

Deno.test("effectiveProperties: direct properties", () => {
  const schema: Schema = {
    properties: { name: { type: "string" } },
  };
  assertEquals(effectiveProperties(schema), { name: { type: "string" } });
});

Deno.test("effectiveProperties: merges allOf members", () => {
  const schema: Schema = {
    allOf: [
      { type: "object", properties: { foo: { type: "string" } } },
      { type: "object", properties: { bar: { type: "integer" } } },
    ],
  };
  const props = effectiveProperties(schema);
  assertEquals(props !== null, true);
  assertEquals(props!.foo, { type: "string" });
  assertEquals(props!.bar, { type: "integer" });
});

Deno.test("effectiveProperties: merges root and allOf properties", () => {
  const schema: Schema = {
    properties: { root: { type: "string" } },
    allOf: [
      { properties: { extra: { type: "integer" } } },
    ],
  };
  const props = effectiveProperties(schema);
  assertEquals(props !== null, true);
  assertEquals(props!.root, { type: "string" });
  assertEquals(props!.extra, { type: "integer" });
});

Deno.test("effectiveProperties: anyOf picks first with properties", () => {
  const schema: Schema = {
    anyOf: [
      { type: "null" },
      { type: "object", properties: { name: { type: "string" } } },
    ],
  };
  const props = effectiveProperties(schema);
  assertEquals(props !== null, true);
  assertEquals(props!.name, { type: "string" });
});

Deno.test("effectiveProperties: no properties returns null", () => {
  assertEquals(effectiveProperties({ type: "string" }), null);
  assertEquals(effectiveProperties(true), null);
  assertEquals(effectiveProperties(false), null);
});

Deno.test("effectiveProperties: empty allOf with root properties", () => {
  const schema: Schema = {
    allOf: [],
    properties: { x: { type: "string" } },
  };
  assertEquals(effectiveProperties(schema), { x: { type: "string" } });
});

Deno.test("effectiveProperties: allOf members with no properties returns null", () => {
  assertEquals(
    effectiveProperties({ allOf: [{ type: "object" }, { minProperties: 1 }] }),
    null,
  );
});

Deno.test("effectiveProperties: additionalProperties only returns null", () => {
  assertEquals(
    effectiveProperties({ additionalProperties: { type: "string" } }),
    null,
  );
});

Deno.test("effectiveProperties: allOf last member wins on conflict", () => {
  const schema: Schema = {
    allOf: [
      { properties: { x: { type: "string" } } },
      { properties: { x: { type: "integer" } } },
    ],
  };
  const props = effectiveProperties(schema);
  assertEquals(props !== null, true);
  assertEquals(props!.x, { type: "integer" });
});

Deno.test("effectiveProperties: boolean schemas in allOf are skipped", () => {
  const schema: Schema = {
    allOf: [
      // deno-lint-ignore no-explicit-any
      true as any,
      { properties: { a: { type: "string" } } },
    ],
  };
  assertEquals(effectiveProperties(schema), { a: { type: "string" } });
});

Deno.test("effectiveProperties: anyOf with no properties returns null", () => {
  assertEquals(
    effectiveProperties({
      anyOf: [{ type: "string" }, { type: "null" }],
    }),
    null,
  );
});

Deno.test("effectiveProperties: nested allOf", () => {
  const schema: Schema = {
    allOf: [
      {
        allOf: [
          { properties: { deep: { type: "boolean" } } },
        ],
      },
      { properties: { shallow: { type: "string" } } },
    ],
  };
  const props = effectiveProperties(schema);
  assertEquals(props !== null, true);
  assertEquals(props!.deep, { type: "boolean" });
  assertEquals(props!.shallow, { type: "string" });
});

// ── effectiveItems ────────────────────────────────────────────────

Deno.test("effectiveItems: direct items", () => {
  assertEquals(
    effectiveItems({ items: { type: "string" } }),
    { type: "string" },
  );
});

Deno.test("effectiveItems: through allOf", () => {
  assertEquals(
    effectiveItems({ allOf: [{ items: { type: "integer" } }] }),
    { type: "integer" },
  );
});

Deno.test("effectiveItems: through anyOf", () => {
  assertEquals(
    effectiveItems({
      anyOf: [{ type: "null" }, { items: { type: "string" } }],
    }),
    { type: "string" },
  );
});

Deno.test("effectiveItems: no items returns null", () => {
  assertEquals(effectiveItems({ type: "object" }), null);
  assertEquals(effectiveItems(true), null);
  assertEquals(effectiveItems(false), null);
});

Deno.test("effectiveItems: array items schema returns null", () => {
  assertEquals(
    effectiveItems({ items: [{ type: "string" }, { type: "integer" }] }),
    null,
  );
});

// ── effectiveRequired ─────────────────────────────────────────────

Deno.test("effectiveRequired: direct required", () => {
  assertEquals(
    effectiveRequired({ required: ["a", "b"] }),
    ["a", "b"],
  );
});

Deno.test("effectiveRequired: merges allOf required (deduplicated)", () => {
  assertEquals(
    effectiveRequired({
      allOf: [
        { required: ["a", "b"] },
        { required: ["b", "c"] },
      ],
    }),
    ["a", "b", "c"],
  );
});

Deno.test("effectiveRequired: merges root and allOf required", () => {
  assertEquals(
    effectiveRequired({
      required: ["x"],
      allOf: [{ required: ["y"] }],
    }),
    ["x", "y"],
  );
});

Deno.test("effectiveRequired: no required returns empty", () => {
  assertEquals(effectiveRequired({}), []);
  assertEquals(effectiveRequired(true), []);
  assertEquals(effectiveRequired(false), []);
});

Deno.test("effectiveRequired: does not walk anyOf/oneOf (variant-specific)", () => {
  // required inside anyOf/oneOf is conditional on variant match,
  // not unconditional like allOf. Only allOf merges required.
  assertEquals(
    effectiveRequired({
      anyOf: [{ required: ["a"] }, { required: ["b"] }],
    }),
    [],
  );
  assertEquals(
    effectiveRequired({
      oneOf: [{ required: ["x"] }],
    }),
    [],
  );
});

Deno.test("effectiveRequired: deeply nested allOf", () => {
  assertEquals(
    effectiveRequired({
      allOf: [
        { allOf: [{ required: ["deep"] }] },
        { required: ["shallow"] },
      ],
    }),
    ["deep", "shallow"],
  );
});

Deno.test("effectiveRequired: empty allOf with root required", () => {
  assertEquals(
    effectiveRequired({ allOf: [], required: ["root"] }),
    ["root"],
  );
});

// ── isArraySchema ─────────────────────────────────────────────────

Deno.test("isArraySchema: type=array returns true", () => {
  assertEquals(isArraySchema({ type: "array" }), true);
});

Deno.test("isArraySchema: type=string returns false", () => {
  assertEquals(isArraySchema({ type: "string" }), false);
});

Deno.test("isArraySchema: no type returns false", () => {
  assertEquals(isArraySchema({}), false);
});

Deno.test("isArraySchema: walks anyOf", () => {
  assertEquals(
    isArraySchema({ anyOf: [{ type: "array" }, { type: "null" }] }),
    true,
  );
});

Deno.test("isArraySchema: walks oneOf", () => {
  assertEquals(
    isArraySchema({ oneOf: [{ type: "string" }, { type: "array" }] }),
    true,
  );
});

Deno.test("isArraySchema: walks allOf", () => {
  assertEquals(isArraySchema({ allOf: [{ type: "array" }] }), true);
});

Deno.test("isArraySchema: boolean schema returns false", () => {
  assertEquals(isArraySchema(true), false);
  assertEquals(isArraySchema(false), false);
});

// ── isObjectSchema ────────────────────────────────────────────────

Deno.test("isObjectSchema: type=object returns true", () => {
  assertEquals(isObjectSchema({ type: "object" }), true);
});

Deno.test("isObjectSchema: has properties returns true", () => {
  assertEquals(
    isObjectSchema({ properties: { name: { type: "string" } } }),
    true,
  );
});

Deno.test("isObjectSchema: has additionalProperties returns true", () => {
  assertEquals(
    isObjectSchema({ additionalProperties: { type: "string" } }),
    true,
  );
});

Deno.test("isObjectSchema: type=string returns false", () => {
  assertEquals(isObjectSchema({ type: "string" }), false);
});

Deno.test("isObjectSchema: walks anyOf", () => {
  assertEquals(
    isObjectSchema({ anyOf: [{ type: "object" }, { type: "null" }] }),
    true,
  );
});

Deno.test("isObjectSchema: walks allOf", () => {
  assertEquals(
    isObjectSchema({
      allOf: [{ properties: { name: { type: "string" } } }],
    }),
    true,
  );
});

Deno.test("isObjectSchema: boolean schema returns false", () => {
  assertEquals(isObjectSchema(true), false);
  assertEquals(isObjectSchema(false), false);
});

// ── coerceScalar ──────────────────────────────────────────────────

Deno.test("coerceScalar: integer schema coerces valid int", () => {
  assertEquals(coerceScalar("42", { type: "integer" }), 42);
});

Deno.test("coerceScalar: integer schema leaves non-int string", () => {
  assertEquals(coerceScalar("abc", { type: "integer" }), "abc");
});

Deno.test("coerceScalar: integer schema leaves float", () => {
  assertEquals(coerceScalar("3.14", { type: "integer" }), "3.14");
});

Deno.test("coerceScalar: number schema coerces float", () => {
  assertEquals(coerceScalar("3.14", { type: "number" }), 3.14);
});

Deno.test("coerceScalar: boolean schema coerces true/false", () => {
  assertEquals(coerceScalar("true", { type: "boolean" }), true);
  assertEquals(coerceScalar("false", { type: "boolean" }), false);
  assertEquals(coerceScalar("yes", { type: "boolean" }), "yes");
});

Deno.test("coerceScalar: string schema returns raw", () => {
  assertEquals(coerceScalar("hello", { type: "string" }), "hello");
});

Deno.test("coerceScalar: walks allOf to find integer type", () => {
  assertEquals(coerceScalar("0", { allOf: [{ type: "integer" }] }), 0);
});

Deno.test("coerceScalar: walks allOf to find number type", () => {
  assertEquals(coerceScalar("3.14", { allOf: [{ type: "number" }] }), 3.14);
});

Deno.test("coerceScalar: walks allOf to find boolean type", () => {
  assertEquals(coerceScalar("true", { allOf: [{ type: "boolean" }] }), true);
});

Deno.test("coerceScalar: walks anyOf to find integer type", () => {
  assertEquals(
    coerceScalar("5", { anyOf: [{ type: "integer" }, { type: "null" }] }),
    5,
  );
});

Deno.test("coerceScalar: walks oneOf to find integer type", () => {
  assertEquals(
    coerceScalar("7", { oneOf: [{ type: "integer" }, { type: "string" }] }),
    7,
  );
});

Deno.test("coerceScalar: boolean schema returns raw", () => {
  assertEquals(coerceScalar("hello", true), "hello");
  assertEquals(coerceScalar("hello", false), "hello");
});

Deno.test("coerceScalar: zero coerces to integer 0", () => {
  assertEquals(coerceScalar("0", { type: "integer" }), 0);
});

Deno.test("coerceScalar: negative integer", () => {
  assertEquals(coerceScalar("-1", { type: "integer" }), -1);
});

Deno.test("coerceScalar: scientific notation coerces to number", () => {
  assertEquals(coerceScalar("1e5", { type: "number" }), 100000);
});

Deno.test("coerceScalar: NaN string stays as string for integer", () => {
  assertEquals(coerceScalar("NaN", { type: "integer" }), "NaN");
});

Deno.test("coerceScalar: Infinity stays as string for integer", () => {
  // Number("Infinity") is not an integer
  assertEquals(coerceScalar("Infinity", { type: "integer" }), "Infinity");
});

Deno.test("coerceScalar: empty string coerces to 0 for integer", () => {
  // Number("") is 0 and Number.isInteger(0) is true.
  // Validator catches semantic issues; coercion is best-effort.
  assertEquals(coerceScalar("", { type: "integer" }), 0);
});

Deno.test("coerceScalar: empty schema returns raw", () => {
  assertEquals(coerceScalar("42", {}), "42");
});

Deno.test("coerceScalar: deeply nested composition resolves type", () => {
  assertEquals(
    coerceScalar("10", {
      anyOf: [
        { type: "null" },
        { allOf: [{ type: "integer" }] },
      ],
    }),
    10,
  );
});

// ── coerceFormValue ───────────────────────────────────────────────

Deno.test("coerceFormValue: integer schema coerces to integer", () => {
  assertEquals(coerceFormValue("42", { type: "integer" }), 42);
});

Deno.test("coerceFormValue: number schema coerces to number", () => {
  assertEquals(coerceFormValue("3.14", { type: "number" }), 3.14);
});

Deno.test("coerceFormValue: boolean schema coerces true/false", () => {
  assertEquals(coerceFormValue("true", { type: "boolean" }), true);
  assertEquals(coerceFormValue("false", { type: "boolean" }), false);
});

Deno.test("coerceFormValue: string schema returns raw", () => {
  assertEquals(coerceFormValue("hello", { type: "string" }), "hello");
});

Deno.test("coerceFormValue: object schema returns raw (complex type passthrough)", () => {
  // Complex types flow through unchanged; downstream validation reports
  // the type mismatch. This is the extension point for future handling
  // (e.g. JSON-encoded multipart complex fields).
  assertEquals(
    coerceFormValue('{"a":1}', { type: "object" }),
    '{"a":1}',
  );
});

Deno.test("coerceFormValue: array schema returns raw (complex type passthrough)", () => {
  assertEquals(
    coerceFormValue("[1,2,3]", { type: "array" }),
    "[1,2,3]",
  );
});

Deno.test("coerceFormValue: walks allOf composition for primitives", () => {
  assertEquals(
    coerceFormValue("42", { allOf: [{ type: "integer" }] }),
    42,
  );
});

Deno.test("coerceFormValue: walks anyOf composition for primitives", () => {
  assertEquals(
    coerceFormValue("true", {
      anyOf: [{ type: "boolean" }, { type: "null" }],
    }),
    true,
  );
});

Deno.test("coerceFormValue: boolean schema literal returns raw", () => {
  assertEquals(coerceFormValue("hello", true), "hello");
  assertEquals(coerceFormValue("hello", false), "hello");
});

// ── coerceDeep ────────────────────────────────────────────────────

Deno.test("coerceDeep: coerces array items", () => {
  const schema: Schema = {
    type: "array",
    items: { type: "integer" },
  };
  assertEquals(coerceDeep(["1", "2", "3"], schema), [1, 2, 3]);
});

Deno.test("coerceDeep: coerces object properties", () => {
  const schema: Schema = {
    type: "object",
    properties: {
      age: { type: "integer" },
      active: { type: "boolean" },
      name: { type: "string" },
    },
  };
  assertEquals(coerceDeep({ age: "30", active: "true", name: "sam" }, schema), {
    age: 30,
    active: true,
    name: "sam",
  });
});

Deno.test("coerceDeep: passes through non-string leaf values", () => {
  assertEquals(coerceDeep(42, { type: "integer" }), 42);
});

Deno.test("coerceDeep: handles missing items schema gracefully", () => {
  assertEquals(coerceDeep(["a", "b"], { type: "array" }), ["a", "b"]);
});

Deno.test("coerceDeep: allOf object with integer property", () => {
  const schema: Schema = {
    allOf: [
      { type: "object", properties: { foo: { type: "string" } } },
      { type: "object", properties: { bar: { type: "integer" } } },
    ],
  };
  assertEquals(
    coerceDeep({ foo: "foo", bar: "0" }, schema),
    { foo: "foo", bar: 0 },
  );
});

Deno.test("coerceDeep: allOf array with items through composition", () => {
  const schema: Schema = {
    allOf: [{ items: { type: "integer" } }],
  };
  assertEquals(coerceDeep(["1", "2"], schema), [1, 2]);
});

Deno.test("coerceDeep: nested object coercion through allOf properties", () => {
  const schema: Schema = {
    allOf: [
      {
        properties: {
          nested: {
            type: "object",
            properties: { count: { type: "integer" } },
          },
        },
      },
    ],
  };
  assertEquals(
    coerceDeep({ nested: { count: "5" } }, schema),
    { nested: { count: 5 } },
  );
});

Deno.test("coerceDeep: boolean schema passes through", () => {
  assertEquals(coerceDeep({ a: "1" }, true), { a: "1" });
  assertEquals(coerceDeep(["1"], false), ["1"]);
});

Deno.test("coerceDeep: extra properties not in schema pass through unchanged", () => {
  const schema: Schema = {
    properties: { known: { type: "integer" } },
  };
  assertEquals(
    coerceDeep({ known: "5", extra: "hello" }, schema),
    { known: 5, extra: "hello" },
  );
});

Deno.test("coerceDeep: root properties merged with allOf properties", () => {
  const schema: Schema = {
    properties: { root: { type: "boolean" } },
    allOf: [
      { properties: { nested: { type: "integer" } } },
    ],
  };
  assertEquals(
    coerceDeep({ root: "true", nested: "42" }, schema),
    { root: true, nested: 42 },
  );
});

Deno.test("coerceDeep: null values in objects pass through", () => {
  const schema: Schema = {
    properties: { x: { type: "integer" } },
  };
  assertEquals(
    coerceDeep({ x: null }, schema),
    { x: null },
  );
});

Deno.test("coerceDeep: null values in arrays pass through", () => {
  const schema: Schema = {
    items: { type: "integer" },
  };
  assertEquals(coerceDeep([null, "1"], schema), [null, 1]);
});

Deno.test("coerceDeep: array items with allOf schema on items", () => {
  const schema: Schema = {
    type: "array",
    items: {
      allOf: [
        { properties: { id: { type: "integer" } } },
        { properties: { name: { type: "string" } } },
      ],
    },
  };
  assertEquals(
    coerceDeep([{ id: "1", name: "a" }, { id: "2", name: "b" }], schema),
    [{ id: 1, name: "a" }, { id: 2, name: "b" }],
  );
});

Deno.test("coerceDeep: anyOf properties used for coercion", () => {
  const schema: Schema = {
    anyOf: [
      { type: "null" },
      { properties: { count: { type: "integer" } } },
    ],
  };
  assertEquals(
    coerceDeep({ count: "10" }, schema),
    { count: 10 },
  );
});

Deno.test("coerceDeep: allOf array with no items schema passes through", () => {
  assertEquals(
    coerceDeep(["a", "b"], { allOf: [{ type: "array" }] }),
    ["a", "b"],
  );
});
