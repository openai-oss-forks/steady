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
        if (name === "malformed JSON") {
          assertEquals(response.headers.get("x-steady-error-1-code"), "E3021");
        }
      });
    }
  } finally {
    await server.stop();
  }
});
