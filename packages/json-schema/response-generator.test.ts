/**
 * Tests for Response Generator (RegistryResponseGenerator)
 */

import { assertEquals } from "@std/assert";
import { assertInlineSnapshot } from "@std/testing/unstable-snapshot";
import {
  RegistryResponseGenerator,
  SchemaRegistry,
} from "./schema-registry.ts";
import { TreeValidator } from "./tree-validator.ts";
import type { Schema } from "./types.ts";

/**
 * Helper to create a SchemaRegistry from a root schema for testing
 */
function createRegistry(schema: Schema): SchemaRegistry {
  // Wrap the schema in a document structure that SchemaRegistry expects
  const document = { schema };
  return SchemaRegistry.fromSpec(document);
}

/** Validate a generated value against its schema via TreeValidator. */
function assertGeneratedMatchesSchema(
  schema: Schema | boolean,
  generated: unknown,
  registry?: SchemaRegistry,
): void {
  const validator = new TreeValidator({
    registry,
    direction: "response",
  });
  const result = validator.validate(generated, schema, "#", []);
  if (!result.valid) {
    throw new Error(
      `Generated value does not match its schema.\n` +
        `  value:  ${JSON.stringify(generated)}\n` +
        `  errors: ${JSON.stringify(result.children, null, 2)}\n` +
        `  schema: ${JSON.stringify(schema)}`,
    );
  }
}

Deno.test("RegistryResponseGenerator - generates string for simple string schema", () => {
  const schema: Schema = { type: "string" };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");

  assertEquals(typeof result, "string");
});

Deno.test("RegistryResponseGenerator - generates number for integer schema", () => {
  const schema: Schema = { type: "integer", minimum: 0, maximum: 100 };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");

  assertEquals(typeof result, "number");
  assertEquals(Number.isInteger(result), true);
});

Deno.test("RegistryResponseGenerator - uses example when provided", () => {
  const schema: Schema = { type: "string", example: "hello world" };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");

  assertEquals(result, "hello world");
});

Deno.test("RegistryResponseGenerator - anyOf with string or null should generate string or null, not empty object", () => {
  // This is the exact schema pattern causing the Anthropic SDK failures
  const schema: Schema = {
    anyOf: [{ type: "string" }, { type: "null" }],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");

  // Result should be either a string or null, NOT an empty object
  const isStringOrNull = typeof result === "string" || result === null;
  assertEquals(
    isStringOrNull,
    true,
    `Expected string or null, got: ${
      JSON.stringify(result)
    } (type: ${typeof result})`,
  );
});

Deno.test("RegistryResponseGenerator - oneOf should pick first matching schema", () => {
  const schema: Schema = {
    oneOf: [
      { type: "string", minLength: 1 },
      { type: "number" },
    ],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");

  // Should pick the first option (string)
  assertEquals(typeof result, "string");
});

Deno.test("RegistryResponseGenerator - allOf should merge schemas", () => {
  const schema: Schema = {
    allOf: [
      {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      { properties: { age: { type: "integer" } }, required: ["age"] },
    ],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#") as Record<
    string,
    unknown
  >;

  // Should have both name and age
  assertEquals(typeof result, "object");
  assertEquals("name" in result, true);
  assertEquals("age" in result, true);
});

Deno.test("RegistryResponseGenerator - nested anyOf in object property", () => {
  // Real-world pattern from Anthropic API
  const schema: Schema = {
    type: "object",
    properties: {
      data: { type: "array", items: { type: "object" } },
      first_id: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      last_id: {
        anyOf: [{ type: "string" }, { type: "null" }],
      },
      has_more: { type: "boolean" },
    },
    required: ["data", "has_more"],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#") as Record<
    string,
    unknown
  >;

  assertEquals(typeof result, "object");
  assertEquals(Array.isArray(result.data), true);
  assertEquals(typeof result.has_more, "boolean");

  // first_id and last_id should be string or null, not {}
  if ("first_id" in result) {
    const isValid = typeof result.first_id === "string" ||
      result.first_id === null;
    assertEquals(
      isValid,
      true,
      `first_id should be string or null, got: ${
        JSON.stringify(result.first_id)
      }`,
    );
  }
  if ("last_id" in result) {
    const isValid = typeof result.last_id === "string" ||
      result.last_id === null;
    assertEquals(
      isValid,
      true,
      `last_id should be string or null, got: ${
        JSON.stringify(result.last_id)
      }`,
    );
  }
});

Deno.test("RegistryResponseGenerator - allOf with $ref resolves referenced schema properties", () => {
  // This is the Lithic SDK failure pattern: allOf with $ref to base schema
  // The bug: $ref schemas have no direct .properties, so they get skipped
  const document = {
    components: {
      schemas: {
        BaseTransaction: {
          type: "object",
          properties: {
            token: { type: "string" },
            status: { type: "string" },
            created: { type: "string", format: "date-time" },
          },
          required: ["token", "status", "created"],
        },
        FinancialTransaction: {
          allOf: [
            { $ref: "#/components/schemas/BaseTransaction" },
            {
              type: "object",
              properties: {
                family: { type: "string" },
                category: { type: "string" },
              },
              required: ["family"],
            },
          ],
        },
      },
    },
  };

  const registry = SchemaRegistry.fromSpec(document);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generate(
    "#/components/schemas/FinancialTransaction",
  ) as Record<string, unknown>;

  assertEquals(typeof result, "object", "Result should be an object");

  // Properties from the $ref'd BaseTransaction should be included
  assertEquals(
    "token" in result,
    true,
    `Should include 'token' from BaseTransaction, got: ${
      JSON.stringify(result)
    }`,
  );
  assertEquals(
    "status" in result,
    true,
    `Should include 'status' from BaseTransaction, got: ${
      JSON.stringify(result)
    }`,
  );
  assertEquals(
    "created" in result,
    true,
    `Should include 'created' from BaseTransaction, got: ${
      JSON.stringify(result)
    }`,
  );

  // Properties from the inline schema should also be included
  assertEquals(
    "family" in result,
    true,
    `Should include 'family' from inline schema, got: ${
      JSON.stringify(result)
    }`,
  );
});

Deno.test("RegistryResponseGenerator - allOf member examples do not shadow $ref properties", () => {
  // Lithic pattern: pci_card_response = allOf[non_pci_card_response, {pan, cvv}]
  // The inline member has a schema-level `examples` with only pan/cvv.
  // That partial example must not be used as the complete response;
  // required fields from the $ref'd member must still appear.
  const document = {
    components: {
      schemas: {
        non_pci_card_response: {
          type: "object",
          properties: {
            token: { type: "string", example: "card-token-123" },
            state: { type: "string", example: "OPEN" },
          },
          required: ["token", "state"],
        },
        pci_card_response: {
          allOf: [
            { $ref: "#/components/schemas/non_pci_card_response" },
            {
              type: "object",
              properties: {
                pan: { type: "string", example: "4111111289144142" },
                cvv: { type: "string", example: "776" },
              },
              examples: [
                { pan: "4111111289144142", cvv: "776" },
              ],
            },
          ],
        },
      },
    },
  };

  const registry = SchemaRegistry.fromSpec(document);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generate(
    "#/components/schemas/pci_card_response",
  );

  // Before the fix, this returned {pan: "411...", cvv: "776"} because the
  // partial examples array from the inline member shadowed everything.
  // After the fix, allOf merges properties from both members and generates
  // required fields using their property-level examples.
  assertEquals(result, {
    token: "card-token-123",
    state: "OPEN",
  });
});

Deno.test("RegistryResponseGenerator - allOf with nested $ref-to-allOf flattens recursively", () => {
  // Pattern: FinancialTransaction.allOf -> $ref BaseTransaction,
  // where BaseTransaction is itself allOf[CoreFields, TimestampFields]
  const document = {
    components: {
      schemas: {
        CoreFields: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" },
          },
          required: ["id", "status"],
        },
        TimestampFields: {
          type: "object",
          properties: {
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
          required: ["created_at", "updated_at"],
        },
        BaseTransaction: {
          allOf: [
            { $ref: "#/components/schemas/CoreFields" },
            { $ref: "#/components/schemas/TimestampFields" },
          ],
        },
        FinancialTransaction: {
          allOf: [
            { $ref: "#/components/schemas/BaseTransaction" },
            {
              type: "object",
              properties: {
                amount: { type: "number" },
                currency: { type: "string" },
              },
              required: ["amount", "currency"],
            },
          ],
        },
      },
    },
  };

  const registry = SchemaRegistry.fromSpec(document);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generate(
    "#/components/schemas/FinancialTransaction",
  ) as Record<string, unknown>;

  assertEquals(typeof result, "object", "Result should be an object");

  // Properties from CoreFields (nested via BaseTransaction.allOf)
  assertEquals(
    "id" in result,
    true,
    `Should include 'id' from CoreFields, got: ${JSON.stringify(result)}`,
  );
  assertEquals(
    "status" in result,
    true,
    `Should include 'status' from CoreFields, got: ${JSON.stringify(result)}`,
  );

  // Properties from TimestampFields (nested via BaseTransaction.allOf)
  assertEquals(
    "created_at" in result,
    true,
    `Should include 'created_at' from TimestampFields, got: ${
      JSON.stringify(result)
    }`,
  );
  assertEquals(
    "updated_at" in result,
    true,
    `Should include 'updated_at' from TimestampFields, got: ${
      JSON.stringify(result)
    }`,
  );

  // Properties from inline schema
  assertEquals(
    "amount" in result,
    true,
    `Should include 'amount' from inline schema, got: ${
      JSON.stringify(result)
    }`,
  );
  assertEquals(
    "currency" in result,
    true,
    `Should include 'currency' from inline schema, got: ${
      JSON.stringify(result)
    }`,
  );
});

Deno.test("RegistryResponseGenerator - seeded RNG produces deterministic output per generate() call", () => {
  const document = {
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "integer", minimum: 1, maximum: 1000000 },
            name: { type: "string", minLength: 5, maxLength: 20 },
            email: { type: "string", format: "email" },
          },
          required: ["id", "name", "email"],
        },
      },
    },
  };

  const registry = SchemaRegistry.fromSpec(document);

  // Create generator with fixed seed
  const generator = new RegistryResponseGenerator(registry, { seed: 42 });

  // Generate multiple times - each call should produce the same result
  const result1 = generator.generate("#/components/schemas/User");
  const result2 = generator.generate("#/components/schemas/User");
  const result3 = generator.generate("#/components/schemas/User");

  assertEquals(
    JSON.stringify(result1),
    JSON.stringify(result2),
    "Same seed should produce identical results on repeated generate() calls",
  );
  assertEquals(
    JSON.stringify(result2),
    JSON.stringify(result3),
    "Same seed should produce identical results on repeated generate() calls",
  );
});

Deno.test("RegistryResponseGenerator - different seeds produce different output", () => {
  const document = {
    components: {
      schemas: {
        User: {
          type: "object",
          properties: {
            id: { type: "integer", minimum: 1, maximum: 1000000 },
            name: { type: "string", minLength: 10, maxLength: 20 },
          },
          required: ["id", "name"],
        },
      },
    },
  };

  const registry = SchemaRegistry.fromSpec(document);

  const generator1 = new RegistryResponseGenerator(registry, { seed: 42 });
  const generator2 = new RegistryResponseGenerator(registry, { seed: 12345 });

  const result1 = generator1.generate("#/components/schemas/User");
  const result2 = generator2.generate("#/components/schemas/User");

  // Different seeds should (almost certainly) produce different results
  // for schemas with randomness
  assertEquals(
    JSON.stringify(result1) !== JSON.stringify(result2),
    true,
    "Different seeds should produce different results",
  );
});

Deno.test("SchemaRegistry - $id lookup requires exact match", () => {
  // Per JSON Schema spec, $ref values are resolved as URI-references.
  // Only exact $id matches should work - no basename/suffix matching.
  const document = {
    $defs: {
      ExactUser: {
        $id: "User",
        type: "object",
        properties: { source: { type: "string", const: "exact" } },
      },
    },
    components: {
      schemas: {
        Profile: {
          type: "object",
          properties: {
            user: { $ref: "User" },
          },
        },
      },
    },
  };

  const registry = SchemaRegistry.fromSpec(document);
  const generator = new RegistryResponseGenerator(registry, { seed: 42 });

  const result = generator.generate(
    "#/components/schemas/Profile",
  ) as Record<string, unknown>;

  assertEquals(typeof result, "object");
  if (result.user && typeof result.user === "object") {
    const user = result.user as Record<string, unknown>;
    assertEquals(
      user.source,
      "exact",
      "$ref 'User' should resolve to schema with $id 'User'",
    );
  }
});

Deno.test("SchemaRegistry - $id lookup does not do basename matching", () => {
  // Per JSON Schema spec, $ref: "User" should NOT match $id: "https://example.com/User"
  // This is non-standard behavior that we explicitly don't support.
  const document = {
    $defs: {
      UserSchema: {
        $id: "https://example.com/schemas/User",
        type: "object",
        properties: { name: { type: "string", const: "should-not-resolve" } },
      },
    },
    components: {
      schemas: {
        Profile: {
          type: "object",
          properties: {
            // This should NOT resolve - "User" != "https://example.com/schemas/User"
            user: { $ref: "User" },
          },
        },
      },
    },
  };

  const registry = SchemaRegistry.fromSpec(document);
  const generator = new RegistryResponseGenerator(registry, { seed: 42 });

  const result = generator.generate(
    "#/components/schemas/Profile",
  ) as Record<string, unknown>;

  assertEquals(typeof result, "object");
  // user should NOT have resolved to UserSchema (no basename matching)
  if (result.user && typeof result.user === "object") {
    const user = result.user as Record<string, unknown>;
    assertEquals(
      user.name !== "should-not-resolve",
      true,
      "$ref 'User' should NOT resolve to schema with $id 'https://example.com/schemas/User'",
    );
  }
});

Deno.test("RegistryResponseGenerator - nested anyOf in array items should not return null", () => {
  // Reproduces the OpenAI Response schema structure with allOf at top level:
  // Response: allOf merging multiple schemas
  // output: array of OutputItem
  // OutputItem: anyOf with discriminator → OutputMessage
  // OutputMessage.content: array of OutputMessageContent
  // OutputMessageContent: anyOf with discriminator → OutputTextContent
  const document = {
    components: {
      schemas: {
        Response: {
          // Use allOf like the real Response schema
          allOf: [
            { $ref: "#/components/schemas/BaseResponse" },
            { $ref: "#/components/schemas/ResponseExtras" },
            {
              type: "object",
              properties: {
                output: {
                  type: "array",
                  items: { $ref: "#/components/schemas/OutputItem" },
                },
              },
              required: ["output"],
            },
          ],
        },
        BaseResponse: {
          type: "object",
          properties: {
            id: { type: "string" },
            object: { type: "string", enum: ["response"] },
          },
          required: ["id", "object"],
        },
        ResponseExtras: {
          type: "object",
          properties: {
            model: { type: "string" },
            created_at: { type: "number" },
          },
        },
        OutputItem: {
          anyOf: [
            { $ref: "#/components/schemas/OutputMessage" },
            { $ref: "#/components/schemas/ToolCall" },
          ],
          discriminator: { propertyName: "type" },
        },
        OutputMessage: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: ["message"] },
            role: { type: "string", enum: ["assistant"] },
            content: {
              type: "array",
              items: { $ref: "#/components/schemas/OutputContent" },
            },
            status: { type: "string", enum: ["completed"] },
          },
          required: ["id", "type", "role", "content", "status"],
        },
        OutputContent: {
          anyOf: [
            { $ref: "#/components/schemas/TextContent" },
            { $ref: "#/components/schemas/RefusalContent" },
          ],
          discriminator: { propertyName: "type" },
        },
        TextContent: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["output_text"] },
            text: { type: "string" },
            annotations: {
              type: "array",
              items: { $ref: "#/components/schemas/Annotation" },
            },
          },
          required: ["type", "text", "annotations"],
        },
        Annotation: {
          type: "object",
          properties: {
            type: { type: "string" },
            text: { type: "string" },
          },
          required: ["type", "text"],
        },
        RefusalContent: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["refusal"] },
            refusal: { type: "string" },
          },
          required: ["type", "refusal"],
        },
        ToolCall: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["tool_call"] },
            name: { type: "string" },
          },
          required: ["type", "name"],
        },
      },
    },
  };

  const registry = SchemaRegistry.fromSpec(document);
  const generator = new RegistryResponseGenerator(registry, { seed: 42 });

  const result = generator.generate(
    "#/components/schemas/Response",
  ) as Record<string, unknown>;

  assertEquals(typeof result, "object");
  assertEquals(Array.isArray(result.output), true);

  const output = result.output as unknown[];
  assertEquals(output.length > 0, true, "output should have at least one item");

  const firstItem = output[0] as Record<string, unknown>;
  assertEquals(
    firstItem !== null,
    true,
    `output[0] should not be null, got: ${JSON.stringify(firstItem)}`,
  );

  // If it's a message type, content should not contain null
  if (firstItem.type === "message" && Array.isArray(firstItem.content)) {
    for (let i = 0; i < firstItem.content.length; i++) {
      const contentItem = firstItem.content[i];
      assertEquals(
        contentItem !== null,
        true,
        `output[0].content[${i}] should not be null, got: ${
          JSON.stringify(contentItem)
        }`,
      );
      assertEquals(
        typeof contentItem === "object",
        true,
        `output[0].content[${i}] should be an object, got: ${
          JSON.stringify(contentItem)
        }`,
      );
    }
  }
});

Deno.test("RegistryResponseGenerator - allOf with nullable should return valid value", () => {
  // This mirrors the actual OpenAI tool_choice schema structure:
  // tool_choice:
  //   allOf:
  //     - $ref: '#/components/schemas/AssistantsApiToolChoiceOption'
  //     - nullable: true
  // Where AssistantsApiToolChoiceOption is:
  // anyOf:
  //   - type: string
  //     enum: [none, auto, required]
  //   - $ref to an object type
  const document = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0" },
    paths: {},
    components: {
      schemas: {
        ToolChoiceOption: {
          anyOf: [
            { type: "string", enum: ["none", "auto", "required"] },
            { $ref: "#/components/schemas/NamedToolChoice" },
          ],
        },
        NamedToolChoice: {
          type: "object",
          properties: {
            type: { type: "string" },
          },
        },
        RunObject: {
          type: "object",
          required: ["tool_choice"],
          properties: {
            tool_choice: {
              allOf: [
                { $ref: "#/components/schemas/ToolChoiceOption" },
                { nullable: true },
              ],
            },
          },
        },
      },
    },
  };

  const registry = SchemaRegistry.fromSpec(document);
  const generator = new RegistryResponseGenerator(registry, { seed: 42 });

  const result = generator.generate(
    "#/components/schemas/RunObject",
  ) as Record<string, unknown>;

  // tool_choice should be one of the enum values, NOT an empty object
  const toolChoice = result.tool_choice;
  assertEquals(
    toolChoice === "none" || toolChoice === "auto" ||
      toolChoice === "required" ||
      (typeof toolChoice === "object" && toolChoice !== null &&
        "type" in toolChoice),
    true,
    `tool_choice should be 'none', 'auto', 'required', or an object with 'type', got: ${
      JSON.stringify(toolChoice)
    }`,
  );
});

// --- Invalid example type-mismatch tests ---
// When `example` or `examples` values don't match the schema's declared type,
// the generator should skip them and fall through to type-based generation.

Deno.test("RegistryResponseGenerator - array schema with object in examples falls back to generation", () => {
  // Spec author put item-level examples in the field-level `examples` array.
  // Each entry should itself be an array, but they put bare objects instead.
  const schema: Schema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        primary: { type: "boolean", default: false },
      },
      required: ["name"],
    },
    examples: [
      { primary: true, name: "Tag 1" },
      { primary: false, name: "Tag 2" },
    ],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(
    Array.isArray(result),
    true,
    `should be an array, got: ${JSON.stringify(result)}`,
  );
});

Deno.test("RegistryResponseGenerator - array schema with object in example (singular) falls back to generation", () => {
  const schema: Schema = {
    type: "array",
    items: { type: "string" },
    example: { not: "an array" },
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(
    Array.isArray(result),
    true,
    `should be an array, got: ${JSON.stringify(result)}`,
  );
});

Deno.test("RegistryResponseGenerator - object schema with string example falls back to generation", () => {
  const schema: Schema = {
    type: "object",
    properties: { name: { type: "string" } },
    example: "not an object",
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(
    typeof result === "object" && result !== null && !Array.isArray(result),
    true,
    `should be an object, got: ${JSON.stringify(result)}`,
  );
});

Deno.test("RegistryResponseGenerator - object schema with array example falls back to generation", () => {
  const schema: Schema = {
    type: "object",
    properties: { id: { type: "integer" } },
    example: [1, 2, 3],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(
    typeof result === "object" && result !== null && !Array.isArray(result),
    true,
    `should be an object, got: ${JSON.stringify(result)}`,
  );
});

Deno.test("RegistryResponseGenerator - string schema with object example falls back to generation", () => {
  const schema: Schema = {
    type: "string",
    example: { wrong: true },
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(
    typeof result,
    "string",
    `should be a string, got: ${JSON.stringify(result)}`,
  );
});

Deno.test("RegistryResponseGenerator - integer schema with string example falls back to generation", () => {
  const schema: Schema = {
    type: "integer",
    minimum: 0,
    maximum: 100,
    example: "not a number",
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(
    typeof result,
    "number",
    `should be a number, got: ${JSON.stringify(result)}`,
  );
});

Deno.test("RegistryResponseGenerator - boolean schema with string example falls back to generation", () => {
  const schema: Schema = {
    type: "boolean",
    example: "true",
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(
    typeof result,
    "boolean",
    `should be a boolean, got: ${JSON.stringify(result)}`,
  );
});

Deno.test("RegistryResponseGenerator - number schema with array in examples falls back to generation", () => {
  const schema: Schema = {
    type: "number",
    examples: [["not", "a", "number"], [1, 2]],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(
    typeof result,
    "number",
    `should be a number, got: ${JSON.stringify(result)}`,
  );
});

// --- Valid examples should still be used ---

Deno.test("RegistryResponseGenerator - valid array example is used as-is", () => {
  const schema: Schema = {
    type: "array",
    items: { type: "string" },
    example: ["a", "b", "c"],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(result, ["a", "b", "c"]);
});

Deno.test("RegistryResponseGenerator - valid array in examples array is used as-is", () => {
  const schema: Schema = {
    type: "array",
    items: { type: "number" },
    examples: [[1, 2, 3], [4, 5, 6]],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(result, [1, 2, 3]);
});

Deno.test("RegistryResponseGenerator - valid object example is used as-is", () => {
  const schema: Schema = {
    type: "object",
    properties: { name: { type: "string" } },
    example: { name: "Alice" },
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(result, { name: "Alice" });
});

Deno.test("RegistryResponseGenerator - valid string example is used as-is", () => {
  const schema: Schema = {
    type: "string",
    examples: ["hello", "world"],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(result, "hello");
});

Deno.test("RegistryResponseGenerator - null example for nullable schema is used as-is", () => {
  const schema: Schema = {
    type: "null",
    example: null,
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");
  assertEquals(result, null);
});

Deno.test("RegistryResponseGenerator - type-mismatched example nested inside object property", () => {
  // The original bug: array property with object examples inside a parent object.
  const schema: Schema = {
    type: "object",
    properties: {
      tags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            primary: { type: "boolean", default: false },
          },
          required: ["name"],
        },
        examples: [
          { primary: true, name: "Tag 1" },
          { primary: false, name: "Tag 2" },
        ],
      },
    },
    required: ["tags"],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#") as Record<
    string,
    unknown
  >;
  const tags = result.tags;

  assertEquals(
    Array.isArray(tags),
    true,
    `tags should be an array, got: ${JSON.stringify(tags)}`,
  );
});

Deno.test("RegistryResponseGenerator - required property not in properties should be skipped", () => {
  // When a schema lists a property in `required` that is not defined in
  // `properties`, the generator must not fabricate a value for it. The
  // spec is malformed (E1016 is emitted at load time), and making up a
  // value produces output that matches no valid SDK model. The only
  // defined property (`has_more`) is optional, so the generated object
  // must be empty.
  const schema: Schema = {
    type: "object",
    properties: {
      has_more: { type: "boolean" },
    },
    required: ["bogus"],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry);

  const result = generator.generateFromSchema(schema, "#");

  assertInlineSnapshot(result, `{}`);
});

Deno.test("RegistryResponseGenerator - phantom required across allOf should be skipped", () => {
  // Properties come from one allOf member, phantom required from another.
  // After merging, properties = {a}, required = [b]. Since b is not in
  // effective properties, it must be skipped (not fabricated).
  const schema: Schema = {
    allOf: [
      { type: "object", properties: { a: { type: "string" } } },
      { required: ["b"] },
    ],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry, { seed: 1 });

  const result = generator.generateFromSchema(schema, "#");

  assertInlineSnapshot(result, `{}`);
});

Deno.test("RegistryResponseGenerator - required satisfied by sibling allOf member is generated", () => {
  // Property defined in one allOf member, required listed in another.
  // The property must be generated because it is contributed by a
  // sibling member. Confirms the phantom filter does not over-filter.
  const schema: Schema = {
    allOf: [
      { type: "object", properties: { a: { type: "string" } } },
      { required: ["a"] },
    ],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry, { seed: 1 });

  const result = generator.generateFromSchema(schema, "#") as Record<
    string,
    unknown
  >;

  assertEquals(typeof result.a, "string");
  assertEquals(Object.keys(result), ["a"]);
  assertGeneratedMatchesSchema(schema, result);
});

Deno.test("RegistryResponseGenerator - phantom required across deeply nested allOf", () => {
  // Three-level allOf: properties defined at the deepest level,
  // required listed at the outer level with both a valid name and a
  // phantom name. The valid one is generated, the phantom is skipped.
  const schema: Schema = {
    allOf: [
      {
        allOf: [
          { type: "object", properties: { deep: { type: "integer" } } },
        ],
      },
      { required: ["deep", "ghost"] },
    ],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry, { seed: 1 });

  const result = generator.generateFromSchema(schema, "#") as Record<
    string,
    unknown
  >;

  assertEquals(typeof result.deep, "number");
  assertEquals(Object.keys(result), ["deep"]);
});

Deno.test("RegistryResponseGenerator - phantom required inside picked anyOf branch", () => {
  // anyOf variant lists both a real property and a phantom one as
  // required. After the variant is picked, the phantom is filtered out;
  // the real one is generated.
  const schema: Schema = {
    anyOf: [
      {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a", "ghost"],
      },
      { type: "null" },
    ],
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry, { seed: 1 });

  const result = generator.generateFromSchema(schema, "#") as Record<
    string,
    unknown
  >;

  assertEquals(typeof result.a, "string");
  assertEquals(Object.keys(result), ["a"]);
});

Deno.test("RegistryResponseGenerator - $ref cycle emits null, not a $comment marker", () => {
  // A self-referential schema. The generator must terminate without
  // fabricating a synthetic `$comment` object (which matches no schema
  // and pollutes SDK responses). The only universally schema-valid
  // choice when we cannot descend further is `null`.
  const document = {
    components: {
      schemas: {
        Node: {
          type: "object",
          properties: {
            child: { $ref: "#/components/schemas/Node" },
          },
          required: ["child"],
        },
      },
    },
  };
  const registry = SchemaRegistry.fromSpec(document);
  const generator = new RegistryResponseGenerator(registry, { seed: 1 });

  const result = generator.generate("#/components/schemas/Node");

  assertInlineSnapshot(
    result,
    `{
  child: {
    child: null,
  },
}`,
  );
});

Deno.test("RegistryResponseGenerator - unresolved $ref emits null, not a $comment marker", () => {
  // An unresolved $ref at generation time indicates a loader bug (E1004
  // should have caught it at startup). The generator should fall back
  // to the safest schema-valid value (null) rather than invent a
  // synthetic `$comment` object.
  const document = {
    components: {
      schemas: {
        Container: {
          type: "object",
          properties: {
            data: { $ref: "#/components/schemas/Missing" },
          },
          required: ["data"],
        },
      },
    },
  };
  const registry = SchemaRegistry.fromSpec(document);
  const generator = new RegistryResponseGenerator(registry, { seed: 1 });

  const result = generator.generate("#/components/schemas/Container");

  assertInlineSnapshot(
    result,
    `{
  data: null,
}`,
  );
});

Deno.test("RegistryResponseGenerator - schema with no inferable shape emits null, not {}", () => {
  // A schema with no type, no properties, no items, no composition,
  // and no nullable hint. Historically the generator fell back to `{}`,
  // inventing an object. `null` is the safer schema-valid choice:
  // any schema accepts it under `nullable`, and none accepts an
  // object of unknown shape.
  const schema: Schema = { description: "anything at all" };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry, { seed: 1 });

  const result = generator.generateFromSchema(schema, "#");

  assertInlineSnapshot(result, `null`);
});

Deno.test("RegistryResponseGenerator - schema minItems wins over generator option arrayMin/arrayMax", () => {
  // A schema that explicitly declares minItems must be honored even
  // when the generator is configured with smaller bounds. Generator
  // options are defaults for schemas that are silent; they are not
  // overrides for schemas that speak.
  const schema: Schema = {
    type: "array",
    items: { type: "string" },
    minItems: 5,
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry, {
    seed: 1,
    arrayMin: 2,
    arrayMax: 2,
  });

  const result = generator.generateFromSchema(schema, "#") as unknown[];

  assertEquals(result.length, 5);
});

Deno.test("RegistryResponseGenerator - generator option arrayMin applies when schema is silent", () => {
  // Inverse of the previous test: when the schema says nothing about
  // bounds, the generator option should still drive the length. This
  // preserves the existing behavior relied on by server tests.
  const schema: Schema = {
    type: "array",
    items: { type: "string" },
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry, {
    seed: 1,
    arrayMin: 3,
    arrayMax: 3,
  });

  const result = generator.generateFromSchema(schema, "#") as unknown[];

  assertEquals(result.length, 3);
});

Deno.test("RegistryResponseGenerator - schema maxItems wins over generator option arrayMax", () => {
  // Symmetric check: schema maxItems bound is honored even when the
  // generator option would allow more.
  const schema: Schema = {
    type: "array",
    items: { type: "string" },
    maxItems: 2,
  };
  const registry = createRegistry(schema);
  const generator = new RegistryResponseGenerator(registry, {
    seed: 1,
    arrayMin: 10,
    arrayMax: 10,
  });

  const result = generator.generateFromSchema(schema, "#") as unknown[];

  // Result length must not exceed schema maxItems; minimum is clamped
  // to maxItems when option arrayMin would otherwise exceed it.
  assertEquals(result.length, 2);
});
