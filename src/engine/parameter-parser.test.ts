/**
 * Tests for parameter-parser.ts
 *
 * Format-aware query parameter parsing: array/object detection,
 * deep coercion, and expected-key computation.
 */

import { assertEquals } from "@std/assert";
import { wrapURLSearchParams } from "../param-format.ts";
import type { ResolvedParameter } from "./diagnostic-engine.ts";
import {
  coerceDeep,
  coerceScalar,
  deserializeNonQueryParam,
  getExpectedQueryKeys,
  isArraySchema,
  isObjectSchema,
  parseQueryParam,
} from "./parameter-parser.ts";

// ── Helpers ────────────────────────────────────────────────────────

function makeParam(
  overrides: Partial<ResolvedParameter> & { name: string },
): ResolvedParameter {
  return {
    in: "query",
    required: false,
    schema: null,
    schemaPath: null,
    ...overrides,
  };
}

function sourceFromQuery(qs: string) {
  return wrapURLSearchParams(new URLSearchParams(qs));
}

// ── isArraySchema ──────────────────────────────────────────────────

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
  assertEquals(
    isArraySchema({ allOf: [{ type: "array" }] }),
    true,
  );
});

// ── isObjectSchema ─────────────────────────────────────────────────

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

// ── coerceScalar ───────────────────────────────────────────────────

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

Deno.test("parseQueryParam: boolean true schema returns raw string", () => {
  const source = sourceFromQuery("name=sam");
  const param = makeParam({ name: "name", schema: true as unknown as null });
  // Tested via parseQueryParam since coerceScalar takes Schema (not boolean literal)
  const result = parseQueryParam(source, param, "auto", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, "sam");
});

// ── deepCoerce ─────────────────────────────────────────────────────

Deno.test("deepCoerce: coerces array items", () => {
  const schema = {
    type: "array" as const,
    items: { type: "integer" as const },
  };
  assertEquals(coerceDeep(["1", "2", "3"], schema), [1, 2, 3]);
});

Deno.test("deepCoerce: coerces object properties", () => {
  const schema = {
    type: "object" as const,
    properties: {
      age: { type: "integer" as const },
      active: { type: "boolean" as const },
      name: { type: "string" as const },
    },
  };
  assertEquals(coerceDeep({ age: "30", active: "true", name: "sam" }, schema), {
    age: 30,
    active: true,
    name: "sam",
  });
});

Deno.test("deepCoerce: passes through non-string leaf values", () => {
  const schema = { type: "integer" as const };
  assertEquals(coerceDeep(42, schema), 42);
});

Deno.test("deepCoerce: handles missing items schema gracefully", () => {
  const schema = { type: "array" as const };
  assertEquals(coerceDeep(["a", "b"], schema), ["a", "b"]);
});

// ── parseQueryParam: scalar ────────────────────────────────────────

Deno.test("parseQueryParam: simple string param present", () => {
  const source = sourceFromQuery("name=sam");
  const param = makeParam({ name: "name", schema: { type: "string" } });

  const result = parseQueryParam(source, param, "auto", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, "sam");
});

Deno.test("parseQueryParam: param not present", () => {
  const source = sourceFromQuery("other=val");
  const param = makeParam({ name: "name", schema: { type: "string" } });

  const result = parseQueryParam(source, param, "auto", "auto");
  assertEquals(result.present, false);
  assertEquals(result.value, undefined);
});

Deno.test("parseQueryParam: integer coercion", () => {
  const source = sourceFromQuery("limit=10");
  const param = makeParam({ name: "limit", schema: { type: "integer" } });

  const result = parseQueryParam(source, param, "auto", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, 10);
});

// ── parseQueryParam: arrays ────────────────────────────────────────

Deno.test("parseQueryParam: repeat array format", () => {
  const source = sourceFromQuery("colors=red&colors=green&colors=blue");
  const param = makeParam({
    name: "colors",
    schema: { type: "array", items: { type: "string" } },
  });

  const result = parseQueryParam(source, param, "repeat", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, ["red", "green", "blue"]);
});

Deno.test("parseQueryParam: comma array format", () => {
  const source = sourceFromQuery("colors=red,green,blue");
  const param = makeParam({
    name: "colors",
    schema: { type: "array", items: { type: "string" } },
  });

  const result = parseQueryParam(source, param, "comma", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, ["red", "green", "blue"]);
});

Deno.test("parseQueryParam: pipe array format", () => {
  const source = sourceFromQuery("colors=red|green|blue");
  const param = makeParam({
    name: "colors",
    schema: { type: "array", items: { type: "string" } },
  });

  const result = parseQueryParam(source, param, "pipe", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, ["red", "green", "blue"]);
});

Deno.test("parseQueryParam: space array format", () => {
  const source = sourceFromQuery("colors=red green blue");
  const param = makeParam({
    name: "colors",
    schema: { type: "array", items: { type: "string" } },
  });

  const result = parseQueryParam(source, param, "space", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, ["red", "green", "blue"]);
});

Deno.test("parseQueryParam: brackets array format", () => {
  const source = sourceFromQuery("colors[]=red&colors[]=green");
  const param = makeParam({
    name: "colors",
    schema: { type: "array", items: { type: "string" } },
  });

  const result = parseQueryParam(source, param, "brackets", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, ["red", "green"]);
});

Deno.test("parseQueryParam: string array with dots object format uses flat array format", () => {
  const source = sourceFromQuery("names=alice&names=bob");
  const param = makeParam({
    name: "names",
    schema: { type: "array", items: { type: "string" } },
  });

  const result = parseQueryParam(source, param, "auto", "dots");
  assertEquals(result.present, true);
  assertEquals(result.value, ["alice", "bob"]);
});

Deno.test("parseQueryParam: array with integer items coerces", () => {
  const source = sourceFromQuery("ids=1&ids=2&ids=3");
  const param = makeParam({
    name: "ids",
    schema: { type: "array", items: { type: "integer" } },
  });

  const result = parseQueryParam(source, param, "repeat", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, [1, 2, 3]);
});

Deno.test("parseQueryParam: auto format uses style/explode from param", () => {
  const source = sourceFromQuery("colors=red,green,blue");
  const param = makeParam({
    name: "colors",
    schema: { type: "array", items: { type: "string" } },
    style: "form",
    explode: false,
  });

  const result = parseQueryParam(source, param, "auto", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, ["red", "green", "blue"]);
});

// ── parseQueryParam: array of objects via nested format ────────────

Deno.test("parseQueryParam: single array item via dots format", () => {
  const source = sourceFromQuery(
    "search.field=attackerCountry&search.op=equals&search.value=usa",
  );
  const param = makeParam({
    name: "search",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          op: { type: "string" },
          value: { type: "string" },
        },
      },
    },
  });

  const result = parseQueryParam(source, param, "auto", "dots");
  assertEquals(result.present, true);
  assertEquals(result.value, [
    { field: "attackerCountry", op: "equals", value: "usa" },
  ]);
});

Deno.test("parseQueryParam: multiple array items via dots format", () => {
  const source = sourceFromQuery(
    "search.field=country&search.op=equals&search.field=type&search.op=like",
  );
  const param = makeParam({
    name: "search",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          op: { type: "string" },
        },
      },
    },
  });

  const result = parseQueryParam(source, param, "auto", "dots");
  assertEquals(result.present, true);
  assertEquals(result.value, [
    { field: "country", op: "equals" },
    { field: "type", op: "like" },
  ]);
});

// In bracket mode, property-access keys ([name]) produce objects.
// For arrays, use append ([][name]) or indexed ([0][name]) notation.

Deno.test("parseQueryParam: property-access keys produce object via brackets", () => {
  const source = sourceFromQuery(
    "filters[key]=id&filters[operator]=eq&filters[value]=string",
  );
  const param = makeParam({
    name: "filters",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          operator: { type: "string" },
          value: { type: "string" },
        },
      },
    },
  });

  // Without [] notation, this is an object, not a wrapped array.
  const result = parseQueryParam(source, param, "auto", "brackets");
  assertEquals(result.present, true);
  assertEquals(result.value, { key: "id", operator: "eq", value: "string" });
});

Deno.test("parseQueryParam: repeated property-access keys produce last-wins object via brackets", () => {
  const source = sourceFromQuery(
    "filters[key]=id&filters[operator]=eq&filters[key]=type&filters[operator]=contains",
  );
  const param = makeParam({
    name: "filters",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          operator: { type: "string" },
        },
      },
    },
  });

  // Without [] notation, repeated properties are last-write-wins.
  const result = parseQueryParam(source, param, "auto", "brackets");
  assertEquals(result.present, true);
  assertEquals(result.value, { key: "type", operator: "contains" });
});

Deno.test("parseQueryParam: append notation produces array via brackets", () => {
  const source = sourceFromQuery(
    "filters[][key]=id&filters[][operator]=eq&filters[][key]=type&filters[][operator]=contains",
  );
  const param = makeParam({
    name: "filters",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          operator: { type: "string" },
        },
      },
    },
  });

  const result = parseQueryParam(source, param, "auto", "brackets");
  assertEquals(result.present, true);
  assertEquals(result.value, [
    { key: "id", operator: "eq" },
    { key: "type", operator: "contains" },
  ]);
});

Deno.test("parseQueryParam: array of objects via dots with integer coercion", () => {
  const source = sourceFromQuery(
    "filters.field=count&filters.value=42",
  );
  const param = makeParam({
    name: "filters",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          value: { type: "integer" },
        },
      },
    },
  });

  const result = parseQueryParam(source, param, "auto", "dots");
  assertEquals(result.present, true);
  assertEquals(result.value, [
    { field: "count", value: 42 },
  ]);
});

// ── parseQueryParam: objects ───────────────────────────────────────

Deno.test("parseQueryParam: allOf object with integer property coerces via brackets", () => {
  const source = sourceFromQuery("foo_and_bar[bar]=0&foo_and_bar[foo]=foo");
  const param = makeParam({
    name: "foo_and_bar",
    schema: {
      allOf: [
        { type: "object", properties: { foo: { type: "string" } } },
        { type: "object", properties: { bar: { type: "integer" } } },
      ],
    },
  });

  const result = parseQueryParam(source, param, "auto", "brackets");
  assertEquals(result.present, true);
  assertEquals(result.value, { foo: "foo", bar: 0 });
});

Deno.test("parseQueryParam: brackets object format", () => {
  const source = sourceFromQuery("user[name]=sam&user[age]=30");
  const param = makeParam({
    name: "user",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    },
  });

  const result = parseQueryParam(source, param, "auto", "brackets");
  assertEquals(result.present, true);
  assertEquals(result.value, { name: "sam", age: 30 });
});

Deno.test("parseQueryParam: dots object format", () => {
  const source = sourceFromQuery("user.name=sam&user.age=30");
  const param = makeParam({
    name: "user",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    },
  });

  const result = parseQueryParam(source, param, "auto", "dots");
  assertEquals(result.present, true);
  assertEquals(result.value, { name: "sam", age: 30 });
});

Deno.test("parseQueryParam: flat-comma object format", () => {
  const source = sourceFromQuery("user=name,sam,age,30");
  const param = makeParam({
    name: "user",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    },
  });

  const result = parseQueryParam(source, param, "auto", "flat-comma");
  assertEquals(result.present, true);
  assertEquals(result.value, { name: "sam", age: 30 });
});

Deno.test("parseQueryParam: flat object format pulls from schema properties", () => {
  const source = sourceFromQuery("name=sam&age=30");
  const param = makeParam({
    name: "user",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    },
  });

  const result = parseQueryParam(source, param, "auto", "flat");
  assertEquals(result.present, true);
  assertEquals(result.value, { name: "sam", age: 30 });
});

Deno.test("parseQueryParam: flat object not present when no properties match", () => {
  const source = sourceFromQuery("unrelated=val");
  const param = makeParam({
    name: "user",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    },
  });

  const result = parseQueryParam(source, param, "auto", "flat");
  assertEquals(result.present, false);
});

// ── parseQueryParam: no schema ─────────────────────────────────────

Deno.test("parseQueryParam: no schema returns raw string", () => {
  const source = sourceFromQuery("name=sam");
  const param = makeParam({ name: "name" });

  const result = parseQueryParam(source, param, "auto", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, "sam");
});

// ── parseQueryParam: boolean schema ────────────────────────────────

Deno.test("parseQueryParam: boolean true schema treats as scalar", () => {
  const source = sourceFromQuery("name=sam");
  const param = makeParam({ name: "name", schema: true as unknown as null });

  // boolean schema means "anything goes"
  const result = parseQueryParam(source, param, "auto", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, "sam");
});

// ── parseQueryParam: empty value ───────────────────────────────────

Deno.test("parseQueryParam: empty string value is present", () => {
  const source = sourceFromQuery("name=");
  const param = makeParam({ name: "name", schema: { type: "string" } });

  const result = parseQueryParam(source, param, "auto", "auto");
  assertEquals(result.present, true);
  assertEquals(result.value, "");
});

// ── getExpectedQueryKeys ───────────────────────────────────────────

Deno.test("getExpectedQueryKeys: scalar params in known set", () => {
  const params = [
    makeParam({ name: "limit", schema: { type: "integer" } }),
    makeParam({ name: "offset", schema: { type: "integer" } }),
  ];

  const { known, dynamicPrefixes } = getExpectedQueryKeys(
    params,
    "auto",
    "auto",
  );
  assertEquals(known.has("limit"), true);
  assertEquals(known.has("offset"), true);
  assertEquals(dynamicPrefixes.size, 0);
});

Deno.test("getExpectedQueryKeys: brackets array adds name[]", () => {
  const params = [
    makeParam({
      name: "colors",
      schema: { type: "array" },
    }),
  ];

  const { known } = getExpectedQueryKeys(params, "brackets", "auto");
  assertEquals(known.has("colors[]"), true);
  assertEquals(known.has("colors"), true);
});

Deno.test("getExpectedQueryKeys: brackets object adds dynamic prefix", () => {
  const params = [
    makeParam({
      name: "user",
      schema: { type: "object" },
    }),
  ];

  const { dynamicPrefixes } = getExpectedQueryKeys(
    params,
    "auto",
    "brackets",
  );
  assertEquals(dynamicPrefixes.has("user["), true);
});

Deno.test("getExpectedQueryKeys: dots object adds dynamic prefix", () => {
  const params = [
    makeParam({
      name: "user",
      schema: { type: "object" },
    }),
  ];

  const { dynamicPrefixes } = getExpectedQueryKeys(params, "auto", "dots");
  assertEquals(dynamicPrefixes.has("user."), true);
});

Deno.test("getExpectedQueryKeys: flat object adds property names", () => {
  const params = [
    makeParam({
      name: "user",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
        },
      },
    }),
  ];

  const { known } = getExpectedQueryKeys(params, "auto", "flat");
  assertEquals(known.has("name"), true);
  assertEquals(known.has("age"), true);
  assertEquals(known.has("user"), true);
});

Deno.test("parseQueryParam: array with enum items and style/explode from spec", () => {
  const source = sourceFromQuery("q=test&status=invalid");
  const param = makeParam({
    name: "status",
    schema: {
      type: "array",
      items: { type: "string", enum: ["draft", "published", "archived"] },
    },
    style: "form",
    explode: true,
  });

  const result = parseQueryParam(source, param, "auto", "auto");
  assertEquals(result.present, true);
  assertEquals(Array.isArray(result.value), true);
  assertEquals(result.value, ["invalid"]);
});

Deno.test("getExpectedQueryKeys: non-query params excluded", () => {
  const params = [
    makeParam({ name: "limit", in: "query", schema: { type: "integer" } }),
    { ...makeParam({ name: "X-Api-Key" }), in: "header" as const },
  ];

  const { known } = getExpectedQueryKeys(params, "auto", "auto");
  assertEquals(known.has("limit"), true);
  assertEquals(known.has("X-Api-Key"), false);
});

// ── deserializeNonQueryParam ──────────────────────────────────────

Deno.test("deserializeNonQueryParam: header array splits comma-separated values", () => {
  const param = makeParam({
    name: "X-Flags",
    in: "header",
    schema: { type: "array", items: { type: "string" } },
  });
  assertEquals(deserializeNonQueryParam("F1, F2", param), ["F1", "F2"]);
});

Deno.test("deserializeNonQueryParam: header array coerces integer items", () => {
  const param = makeParam({
    name: "X-Ids",
    in: "header",
    schema: { type: "array", items: { type: "integer" } },
  });
  assertEquals(deserializeNonQueryParam("1,2,3", param), [1, 2, 3]);
});

Deno.test("deserializeNonQueryParam: header object explode=false parses alternating key,value", () => {
  const param = makeParam({
    name: "X-Color",
    in: "header",
    schema: {
      type: "object",
      properties: {
        R: { type: "integer" },
        G: { type: "integer" },
        B: { type: "integer" },
      },
    },
  });
  assertEquals(deserializeNonQueryParam("R,100,G,200,B,150", param), {
    R: 100,
    G: 200,
    B: 150,
  });
});

Deno.test("deserializeNonQueryParam: header object explode=true parses key=value pairs", () => {
  const param = makeParam({
    name: "X-Color",
    in: "header",
    explode: true,
    schema: {
      type: "object",
      properties: {
        R: { type: "integer" },
        G: { type: "integer" },
        B: { type: "integer" },
      },
    },
  });
  assertEquals(deserializeNonQueryParam("R=100,G=200,B=150", param), {
    R: 100,
    G: 200,
    B: 150,
  });
});

Deno.test("deserializeNonQueryParam: header scalar coerces type", () => {
  const param = makeParam({
    name: "X-Count",
    in: "header",
    schema: { type: "integer" },
  });
  assertEquals(deserializeNonQueryParam("42", param), 42);
});

Deno.test("deserializeNonQueryParam: path array splits comma-separated", () => {
  const param = makeParam({
    name: "ids",
    in: "path",
    schema: { type: "array", items: { type: "integer" } },
  });
  assertEquals(deserializeNonQueryParam("1,2,3", param), [1, 2, 3]);
});

Deno.test("deserializeNonQueryParam: cookie array splits comma-separated", () => {
  const param = makeParam({
    name: "prefs",
    in: "cookie",
    schema: { type: "array", items: { type: "string" } },
  });
  assertEquals(deserializeNonQueryParam("a,b,c", param), ["a", "b", "c"]);
});

Deno.test("deserializeNonQueryParam: boolean schema returns raw string", () => {
  const param = makeParam({
    name: "X-Custom",
    in: "header",
    schema: true as unknown as null,
  });
  assertEquals(deserializeNonQueryParam("anything", param), "anything");
});
