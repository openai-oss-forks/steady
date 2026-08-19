import { assertEquals } from "@std/assert";
import type { OpenAPIRaw } from "./openapi.ts";
import { OpenAPISpec } from "./spec.ts";
import { SchemaRegistry } from "@steady/json-schema";

/**
 * Helper to create a minimal valid OpenAPIRaw with given paths.
 */
function createSpec(
  overrides: Partial<OpenAPIRaw> = {},
): OpenAPIRaw {
  return {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {},
    ...overrides,
  };
}

Deno.test("OpenAPISpec", async (t) => {
  // ── paths ────────────────────────────────────────────────────────

  await t.step("paths returns spec.paths", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: { responses: { "200": { description: "OK" } } },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));

    assertEquals(Object.keys(doc.paths), ["/users"]);
  });

  // ── getParameters ────────────────────────────────────────────────

  await t.step("operation-level parameters", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            parameters: [
              {
                name: "limit",
                in: "query",
                required: true,
                schema: { type: "integer" },
              },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const params = doc.getParameters("/users", "get");

    assertEquals(params.length, 1);
    assertEquals(params[0]!.name, "limit");
    assertEquals(params[0]!.in, "query");
    assertEquals(params[0]!.required, true);
  });

  await t.step("path-level parameters merge with operation-level", () => {
    const spec = createSpec({
      paths: {
        "/users/{id}": {
          parameters: [
            { name: "id", in: "path" },
          ],
          get: {
            parameters: [
              { name: "fields", in: "query" },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const params = doc.getParameters("/users/{id}", "get");

    assertEquals(params.length, 2);
    const names = params.map((p) => p.name);
    assertEquals(names.includes("id"), true);
    assertEquals(names.includes("fields"), true);
  });

  await t.step("operation-level overrides path-level (same name+in)", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          parameters: [
            { name: "limit", in: "query", schema: { type: "string" } },
          ],
          get: {
            parameters: [
              {
                name: "limit",
                in: "query",
                required: true,
                schema: { type: "integer" },
              },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const params = doc.getParameters("/users", "get");

    assertEquals(params.length, 1);
    assertEquals(params[0]!.name, "limit");
    assertEquals(params[0]!.required, true);
  });

  await t.step("path parameters are implicitly required", () => {
    const spec = createSpec({
      paths: {
        "/users/{id}": {
          get: {
            parameters: [
              { name: "id", in: "path" },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const params = doc.getParameters("/users/{id}", "get");

    assertEquals(params[0]!.required, true);
  });

  await t.step("$ref parameters are resolved", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            parameters: [
              { $ref: "#/components/parameters/LimitParam" },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
      components: {
        parameters: {
          LimitParam: {
            name: "limit",
            in: "query",
            required: true,
            schema: { type: "integer" },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const params = doc.getParameters("/users", "get");

    assertEquals(params.length, 1);
    assertEquals(params[0]!.name, "limit");
    assertEquals(params[0]!.in, "query");
    assertEquals(params[0]!.required, true);
  });

  await t.step("parameter schemaPath points to schema location", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            parameters: [
              { name: "limit", in: "query", schema: { type: "integer" } },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const params = doc.getParameters("/users", "get");

    assertEquals(params[0]!.schemaPath !== null, true);
    assertEquals(params[0]!.schema !== null, true);
  });

  await t.step("$ref parameter schema is resolved", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            parameters: [
              {
                name: "metadata",
                in: "query",
                schema: { $ref: "#/components/schemas/Metadata" },
              },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
      components: {
        schemas: {
          Metadata: {
            anyOf: [
              {
                type: "object",
                additionalProperties: { type: "string" },
              },
            ],
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const params = doc.getParameters("/users", "get");

    assertEquals(params.length, 1);
    assertEquals(params[0]!.name, "metadata");
    // Schema should be the resolved Metadata definition, not { $ref: '...' }
    assertEquals(params[0]!.schema !== null, true);
    assertEquals(
      "$ref" in (params[0]!.schema as Record<string, unknown>),
      false,
    );
    assertEquals(
      (params[0]!.schema as Record<string, unknown>).anyOf !== undefined,
      true,
    );
    // schemaPath should point to the resolved target
    assertEquals(params[0]!.schemaPath, "#/components/schemas/Metadata");
  });

  await t.step("parameter without schema has null schema/schemaPath", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            parameters: [
              { name: "limit", in: "query" },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const params = doc.getParameters("/users", "get");

    assertEquals(params[0]!.schema, null);
    assertEquals(params[0]!.schemaPath, null);
  });

  await t.step("no parameters → empty array", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const params = doc.getParameters("/users", "get");

    assertEquals(params, []);
  });

  // ── getBodySchema ────────────────────────────────────────────────

  await t.step("returns body schema for application/json", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", required: ["name"] },
                },
              },
            },
            responses: { "201": { description: "Created" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const body = doc.getBodySchema("/users", "post", "application/json");

    assertEquals(body !== null, true);
    assertEquals(body!.schema.type, "object");
    assertEquals(typeof body!.schemaPath, "string");
  });

  await t.step("no requestBody → null", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));

    assertEquals(doc.getBodySchema("/users", "get", "application/json"), null);
  });

  await t.step("$ref requestBody is resolved", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          post: {
            requestBody: { $ref: "#/components/requestBodies/CreateUser" },
            responses: { "201": { description: "Created" } },
          },
        },
      },
      components: {
        requestBodies: {
          CreateUser: {
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const body = doc.getBodySchema("/users", "post", "application/json");

    assertEquals(body !== null, true);
    assertEquals(body!.schema.type, "object");
  });

  await t.step("returns body schema for QUERY method", () => {
    const spec = createSpec({
      paths: {
        "/search": {
          query: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { type: "object", required: ["q"] },
                },
              },
            },
            responses: { "200": { description: "Results" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const body = doc.getBodySchema("/search", "query", "application/json");

    assertEquals(body !== null, true);
    assertEquals(body!.schema.type, "object");
  });

  await t.step("returns body schema for multipart/form-data", () => {
    const spec = createSpec({
      paths: {
        "/uploads": {
          post: {
            requestBody: {
              content: {
                "multipart/form-data": {
                  schema: { type: "object", required: ["file"] },
                },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const body = doc.getBodySchema(
      "/uploads",
      "post",
      "multipart/form-data",
    );

    assertEquals(body !== null, true);
    assertEquals(body!.schema.type, "object");
    assertEquals(body!.schema.required, ["file"]);
  });

  await t.step("returns null for unmatched content type", () => {
    const spec = createSpec({
      paths: {
        "/uploads": {
          post: {
            requestBody: {
              content: {
                "multipart/form-data": {
                  schema: { type: "object" },
                },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));

    assertEquals(
      doc.getBodySchema("/uploads", "post", "application/json"),
      null,
    );
  });

  await t.step("*/* content type matches any request content type", () => {
    const spec = createSpec({
      paths: {
        "/kv": {
          put: {
            requestBody: {
              content: {
                "*/*": {
                  schema: { type: "string" },
                },
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    properties: { value: { type: "string" } },
                  },
                },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));

    const body = doc.getBodySchema("/kv", "put", "application/json");
    assertEquals(body !== null, true, "Should match */* for application/json");
    assertEquals(body!.schema.type, "string");

    // Exact match takes priority over wildcard
    const formBody = doc.getBodySchema("/kv", "put", "multipart/form-data");
    assertEquals(formBody !== null, true, "Exact match should take priority");
    assertEquals(formBody!.schema.type, "object");
  });

  // ── hasResponses ─────────────────────────────────────────────────

  await t.step("returns true when responses exist", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));

    assertEquals(doc.hasResponses("/users", "get"), true);
  });

  await t.step("returns false when responses is empty", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            responses: {},
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));

    assertEquals(doc.hasResponses("/users", "get"), false);
  });

  // ── resolveSchema ────────────────────────────────────────────────

  await t.step("resolves schema by JSON pointer", () => {
    const spec = createSpec({
      components: {
        schemas: {
          User: { type: "object", properties: { name: { type: "string" } } },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const schema = doc.resolveSchema("#/components/schemas/User");

    assertEquals(schema.type, "object");
  });

  await t.step("resolves nested schema path", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { name: { type: "string", minLength: 1 } },
                  },
                },
              },
            },
            responses: { "201": { description: "Created" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const schema = doc.resolveSchema(
      "#/paths/~1users/post/requestBody/content/application~1json/schema/properties/name",
    );

    assertEquals(schema.type, "string");
    assertEquals(schema.minLength, 1);
  });

  await t.step("unresolvable path returns empty schema", () => {
    const spec = createSpec({});
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const schema = doc.resolveSchema("#/nonexistent/path");

    assertEquals(schema, {});
  });

  // ── getResponseObject ───────────────────────────────────────────

  await t.step("returns response for exact status code", () => {
    const spec = createSpec({
      paths: {
        "/users": {
          get: {
            responses: { "200": { description: "OK" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const resp = doc.getResponseObject("/users", "get", "200");

    assertEquals(resp !== null, true);
    assertEquals(resp!.description, "OK");
  });

  await t.step("falls back to wildcard 2XX when exact code missing", () => {
    const spec = createSpec({
      paths: {
        "/push": {
          post: {
            responses: { "2XX": { description: "Success" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const resp = doc.getResponseObject("/push", "post", "200");

    assertEquals(resp !== null, true);
    assertEquals(resp!.description, "Success");
  });

  await t.step("falls back to default when exact and wildcard missing", () => {
    const spec = createSpec({
      paths: {
        "/items": {
          get: {
            responses: { "default": { description: "Fallback" } },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const resp = doc.getResponseObject("/items", "get", "200");

    assertEquals(resp !== null, true);
    assertEquals(resp!.description, "Fallback");
  });

  await t.step("prefers exact code over wildcard", () => {
    const spec = createSpec({
      paths: {
        "/items": {
          post: {
            responses: {
              "2XX": { description: "Success" },
              "201": { description: "Created" },
            },
          },
        },
      },
    });
    const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
    const resp = doc.getResponseObject("/items", "post", "201");

    assertEquals(resp !== null, true);
    assertEquals(resp!.description, "Created");
  });
});
