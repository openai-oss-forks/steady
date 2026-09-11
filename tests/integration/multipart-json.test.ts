import { assertEquals } from "@std/assert";
import {
  parseSpec,
  resolvePartContentTypes,
} from "../../packages/openapi/mod.ts";
import { SchemaRegistry } from "@steady/json-schema";
import type { MediaTypeObject } from "../../packages/openapi/openapi.ts";
import { isParseError, parseRequestBody } from "../../src/body-parser.ts";
import { MockServer } from "../../src/server/mod.ts";

// Filename-less parts match clients that send SDP text alongside typed JSON.
function request(session?: string): Request {
  const boundary = "steady-json-part-regression";
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="sdp"\r\nContent-Type: application/sdp\r\n\r\nv=0\r\n`,
  ];
  if (session !== undefined) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="session"\r\nContent-Type: application/json\r\n\r\n${session}\r\n`,
    );
  }
  return new Request("http://localhost/calls", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: parts.join("") + `--${boundary}--\r\n`,
  });
}

Deno.test("multipart JSON composition preserves values and validates filename-less parts", async (t) => {
  const session = {
    type: "realtime",
    model: "synthetic-model",
    audio: { output: { voice: "synthetic-voice" } },
  };
  const mediaType: MediaTypeObject = {
    schema: { $ref: "#/components/schemas/Body" },
    encoding: {
      sdp: { contentType: "application/sdp" },
      session: { contentType: "application/json" },
    },
  };
  const { spec } = await parseSpec(JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Multipart JSON regression", version: "1" },
    paths: {
      "/calls": {
        post: {
          requestBody: {
            required: true,
            content: { "multipart/form-data": mediaType },
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "text/plain": { schema: { type: "string", example: "answer" } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Body: {
          type: "object",
          required: ["sdp", "session"],
          properties: {
            sdp: { type: "string" },
            session: {
              title: "Session configuration",
              allOf: [{ $ref: "#/components/schemas/Session" }],
            },
          },
        },
        Session: {
          anyOf: [{ type: "null" }, {
            type: "object",
            required: ["type", "model", "audio"],
            properties: {
              type: { const: "realtime" },
              model: { const: "synthetic-model" },
              audio: {
                type: "object",
                required: ["output"],
                properties: {
                  output: {
                    type: "object",
                    required: ["voice"],
                    properties: { voice: { const: "synthetic-voice" } },
                  },
                },
              },
            },
          }],
        },
      },
    },
  }));
  const partContentTypes = resolvePartContentTypes(
    mediaType,
    SchemaRegistry.fromSpec(spec),
  );
  for (const value of [session, null]) {
    const result = await parseRequestBody(
      request(JSON.stringify(value)),
      null,
      { partContentTypes, formObjectFormat: "brackets" },
    );
    assertEquals(isParseError(result), false);
    if (!isParseError(result)) {
      assertEquals(result.body, { sdp: "v=0", session: value });
    }
  }
  const server = new MockServer(spec, {
    port: 0,
    host: "127.0.0.1",
    logLevel: "summary",
    validator: { formArrayFormat: "brackets", formObjectFormat: "brackets" },
  });
  const port = await server.start();
  try {
    const cases: [string, string | undefined, number][] = [
      ["nested JSON object", JSON.stringify(session), 201],
      ["explicit null", "null", 201],
      ["missing required part", undefined, 400],
      ["malformed JSON", "{broken", 400],
      [
        "invalid nested value",
        JSON.stringify({ ...session, audio: { output: { voice: "wrong" } } }),
        400,
      ],
    ];
    for (const [name, value, status] of cases) {
      await t.step(name, async () => {
        const req = request(value);
        const response = await fetch(`http://127.0.0.1:${port}/calls`, {
          method: "POST",
          headers: req.headers,
          body: req.body,
        });
        const body = await response.text();
        assertEquals(response.status, status, body);
      });
    }
  } finally {
    await server.stop();
  }
});

Deno.test("multipart alternative roots preserve literal string values", async () => {
  for (const keyword of ["anyOf", "oneOf"] as const) {
    const mediaType: MediaTypeObject = {
      schema: {
        [keyword]: [
          {
            type: "object",
            properties: {
              kind: { const: "text" },
              payload: { type: "string" },
            },
          },
          {
            type: "object",
            properties: {
              kind: { const: "object" },
              payload: { type: "object" },
            },
          },
        ],
      },
    };
    const registry = SchemaRegistry.fromSpec({
      openapi: "3.1.0",
      info: { title: "Alternatives", version: "1" },
      paths: {},
    });
    const partContentTypes = resolvePartContentTypes(mediaType, registry);
    const form = new FormData();
    form.set("kind", "text");
    form.set("payload", "null");
    const result = await parseRequestBody(
      new Request("http://localhost", { method: "POST", body: form }),
      null,
      { partContentTypes },
    );
    assertEquals(isParseError(result), false);
    if (!isParseError(result)) {
      assertEquals(result.body, { kind: "text", payload: "null" });
    }
  }
});

Deno.test("multipart unions keep plain string and file alternatives", async () => {
  const mediaType: MediaTypeObject = {
    schema: {
      type: "object",
      properties: {
        strategy: {
          anyOf: [{ type: "string", enum: ["auto"] }, { type: "object" }],
        },
        video: {
          anyOf: [{ type: "string", format: "binary" }, { type: "object" }],
        },
      },
    },
  };
  const registry = SchemaRegistry.fromSpec({
    openapi: "3.1.0",
    info: { title: "Alternatives", version: "1" },
    paths: {},
  });
  const form = new FormData();
  form.set("strategy", "auto");
  form.set(
    "video",
    new File(["synthetic video"], "video.bin", {
      type: "application/octet-stream",
    }),
  );
  const result = await parseRequestBody(
    new Request("http://localhost", { method: "POST", body: form }),
    null,
    { partContentTypes: resolvePartContentTypes(mediaType, registry) },
  );
  assertEquals(isParseError(result), false);
  if (!isParseError(result)) {
    assertEquals(result.body, { strategy: "auto", video: "[File]" });
  }
});

Deno.test("referenced multipart unions do not decode literal strings or JSON file bytes", async () => {
  const registry = SchemaRegistry.fromSpec({
    openapi: "3.1.0",
    info: { title: "Union regression", version: "1" },
    paths: {},
    components: {
      schemas: {
        Mixed: { anyOf: [{ type: "string" }, { type: "object" }] },
        FileOrObject: {
          oneOf: [{ type: "string", format: "binary" }, { type: "object" }],
        },
      },
    },
  });
  const mediaType: MediaTypeObject = {
    schema: {
      type: "object",
      properties: {
        payload: { allOf: [{ $ref: "#/components/schemas/Mixed" }] },
        upload: { allOf: [{ $ref: "#/components/schemas/FileOrObject" }] },
      },
    },
  };
  const form = new FormData();
  form.set("payload", "null");
  form.set(
    "upload",
    new File(['{"key":"value"}'], "data.json", { type: "application/json" }),
  );
  const result = await parseRequestBody(
    new Request("http://localhost", { method: "POST", body: form }),
    null,
    { partContentTypes: resolvePartContentTypes(mediaType, registry) },
  );
  assertEquals(isParseError(result), false);
  if (!isParseError(result)) {
    assertEquals(result.body, { payload: "null", upload: "[File]" });
  }
});

Deno.test("multipart composed items and value constraints decode request values", async () => {
  const registry = SchemaRegistry.fromSpec({
    openapi: "3.1.0",
    info: { title: "Decoder constraints", version: "1" },
    paths: {},
  });
  const cases: [Record<string, unknown>, unknown, boolean][] = [
    [
      {
        allOf: [{ items: { required: ["id"] } }, { items: { type: "object" } }],
      },
      [{ id: "ok" }],
      false,
    ],
    [
      {
        allOf: [{ items: { type: "object" } }, { items: { required: ["id"] } }],
      },
      [{ id: "ok" }],
      false,
    ],
    [{ const: { id: 1 } }, { id: 1 }, false],
    [{ enum: [{ id: 1 }, { id: 2 }] }, { id: 2 }, false],
    [{ const: "null" }, "null", true],
    [{ enum: ["null", "auto"] }, "null", true],
    [{ type: ["string", "object"], format: "binary" }, { id: 1 }, true],
  ];
  for (const [schema, value, explicit] of cases) {
    const mediaType: MediaTypeObject = {
      schema: { type: "object", properties: { payload: schema } },
      ...(explicit
        ? { encoding: { payload: { contentType: "application/json" } } }
        : {}),
    };
    const form = new FormData();
    form.set(
      "payload",
      typeof value === "string" ? value : JSON.stringify(value),
    );
    const result = await parseRequestBody(
      new Request("http://localhost", { method: "POST", body: form }),
      null,
      { partContentTypes: resolvePartContentTypes(mediaType, registry) },
    );
    assertEquals(isParseError(result), false);
    if (!isParseError(result)) assertEquals(result.body, { payload: value });
  }
});
