import { assertEquals, assertThrows } from "@std/assert";
import {
  RegistryResponseGenerator,
  SchemaRegistry,
} from "./schema-registry.ts";
import {
  checkGeneratedValue,
  checkResponseBytes,
  GenerationLimitError,
  MAX_RESPONSE_BYTES,
} from "./generation-limits.ts";
import type { Schema } from "./types.ts";

Deno.test("generation limits cover options, schemas, and nested expansion", () => {
  const registry = SchemaRegistry.fromSpec({});
  assertThrows(
    () => new RegistryResponseGenerator(registry, { arrayMax: 1001 }),
    GenerationLimitError,
  );
  const generator = new RegistryResponseGenerator(registry);
  const allowed = generator.generateFromSchema({
    type: "array",
    minItems: 2,
    maxItems: 1000000000,
    items: { const: "ok" },
  }, "#") as unknown[];
  assertEquals(allowed.length >= 2 && allowed.length <= 1000, true);
  for (
    const schema of [
      { type: "array", minItems: 1001, items: { type: "integer" } },
      { type: "string", minLength: 1000000000 },
      {
        type: "array",
        minItems: 1000,
        items: { type: "array", minItems: 1000, items: { type: "integer" } },
      },
    ] as Schema[]
  ) {
    assertThrows(
      () => generator.generateFromSchema(schema, "#"),
      GenerationLimitError,
    );
  }
  assertEquals(
    generator.generateFromSchema({
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { const: "ok" },
    }, "#"),
    ["ok", "ok"],
  );
});

Deno.test("literal values and combined output obey the same generation budget", () => {
  const generator = new RegistryResponseGenerator(SchemaRegistry.fromSpec({}));
  for (const keyword of ["example", "examples", "default", "const", "enum"]) {
    const value = "x".repeat(65537);
    const schema = {
      type: "string",
      [keyword]: ["examples", "enum"].includes(keyword) ? [value] : value,
    } as Schema;
    assertThrows(
      () => generator.generateFromSchema(schema, "#"),
      GenerationLimitError,
    );
  }
  const largeString = "x".repeat(65536);
  for (
    const value of [
      Array(1001).fill(0),
      { nested: Array(1001).fill(0) },
      Array(257).fill(largeString),
    ]
  ) {
    assertThrows(() => checkGeneratedValue(value), GenerationLimitError);
  }
  assertThrows(
    () =>
      generator.generateFromSchema({
        type: "array",
        minItems: 257,
        maxItems: 257,
        items: { const: largeString },
      }, "#"),
    GenerationLimitError,
  );
  assertThrows(
    () => checkResponseBytes(MAX_RESPONSE_BYTES + 1),
    GenerationLimitError,
  );
  checkResponseBytes(MAX_RESPONSE_BYTES);
  assertEquals(generator.generateFromSchema({ const: { ok: ["safe"] } }, "#"), {
    ok: ["safe"],
  });
});
