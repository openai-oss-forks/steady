/**
 * Compile-time contract checks: verify that package implementations
 * satisfy the engine's interfaces. If signatures drift, these fail
 * at type-check time.
 */
import { assertEquals } from "@std/assert";
import type { SchemaValidator, Spec } from "../src/engine/diagnostic-engine.ts";
import { OpenAPISpec } from "../packages/openapi/spec.ts";
import { SchemaRegistry } from "../packages/json-schema/schema-registry.ts";
import { TreeValidator } from "../packages/json-schema/tree-validator.ts";

Deno.test("Engine contracts", async (t) => {
  await t.step("OpenAPISpec satisfies Spec", () => {
    const spec = {
      openapi: "3.1.0",
      info: { title: "Test", version: "1.0" },
      paths: {
        "/users": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    };

    // Compile-time check: if OpenAPISpec doesn't satisfy Spec, this fails.
    new OpenAPISpec(
      SchemaRegistry.fromSpec(spec),
    ) satisfies Spec;
  });

  await t.step("TreeValidator satisfies SchemaValidator", () => {
    const validator: SchemaValidator = new TreeValidator();

    const tree = validator.validate(
      "hello",
      { type: "string" },
      "#/schema",
      ["body"],
    );
    assertEquals(tree.valid, true);
  });
});
