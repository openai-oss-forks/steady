import { assertEquals } from "@std/assert";
import { SchemaRegistry } from "@steady/json-schema";
import { OpenAPISpec } from "@steady/openapi";
import { walkSpec } from "./spec-walker.ts";

function makeDoc(paths: Record<string, unknown>): OpenAPISpec {
  const raw = {
    openapi: "3.1.0",
    info: { title: "test", version: "1.0.0" },
    paths,
  };
  return new OpenAPISpec(SchemaRegistry.fromSpec(raw));
}

Deno.test("walkSpec skips paths with URI fragment (#)", () => {
  const doc = makeDoc({
    "/users": {
      get: {
        operationId: "listUsers",
        responses: { "200": { description: "ok" } },
      },
    },
    "/#X-Amz-Target=Kinesis.CreateStream": {
      post: {
        operationId: "createStream",
        responses: { "200": { description: "ok" } },
      },
    },
    "/#Action=SendMessage": {
      post: {
        operationId: "sendMessage",
        responses: { "200": { description: "ok" } },
      },
    },
    "/oauth2/token#refresh": {
      post: {
        operationId: "refreshToken",
        responses: { "200": { description: "ok" } },
      },
    },
  });

  const ops = walkSpec(doc);
  assertEquals(ops.length, 1);
  assertEquals(ops[0]!.path, "/users");
});
