import { assertEquals } from "@std/assert";
import { parseSpec } from "../../packages/openapi/mod.ts";
import { MockServer } from "../../src/server/mod.ts";

Deno.test("HTTP SSE preserves event shape and ends after the declared events", async () => {
  const { spec } = await parseSpec(JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Synthetic event API", version: "1" },
    paths: {
      "/events": {
        get: {
          responses: {
            "200": {
              description: "Events",
              content: {
                "application/json": { schema: { const: { ok: true } } },
                "text/event-stream": {
                  schema: { $ref: "#/components/schemas/Event" },
                },
              },
            },
          },
        },
      },
      "/example": {
        get: {
          responses: {
            "200": {
              description: "Sequence",
              content: {
                "text/event-stream": {
                  example: [
                    { event: "sample.started", data: { sequence: 0 } },
                    { event: "sample.completed", data: { sequence: 1 } },
                  ],
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Event: {
          type: "object",
          required: ["event", "data"],
          discriminator: { propertyName: "event" },
          properties: {
            event: { const: "sample.delta" },
            data: { const: { text: "hello" } },
          },
        },
      },
    },
  }));
  const server = new MockServer(spec, {
    port: 0,
    host: "127.0.0.1",
    logLevel: "summary",
    streaming: { count: 1, interval: 0 },
  });
  const port = await server.start();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/events`, {
      headers: { Accept: "text/event-stream" },
    });
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Content-Type"), "text/event-stream");
    assertEquals(
      await response.text(),
      'id: 0\nevent: sample.delta\ndata: {"text":"hello"}\n\n',
    );
    const json = await fetch(`http://127.0.0.1:${port}/events`, {
      headers: { Accept: "application/json" },
    });
    assertEquals(await json.json(), { ok: true });
    const example = await fetch(`http://127.0.0.1:${port}/example`);
    assertEquals(
      await example.text(),
      'id: 0\nevent: sample.started\ndata: {"sequence":0}\n\nid: 1\nevent: sample.completed\ndata: {"sequence":1}\n\n',
    );
  } finally {
    await server.stop();
  }
});

Deno.test("HTTP SSE supports raw and named examples and bodyless statuses", async () => {
  const raw = 'event: sample.delta\ndata: {"text":"hello"}\n\ndata: [DONE]\n\n';
  const sequence = [{ event: "sample.delta", data: { text: "hello" } }];
  const cases = [
    { path: "/raw", status: 200, media: { example: raw }, expected: raw },
    {
      path: "/named-raw",
      status: 200,
      media: { examples: { first: { value: raw } } },
      expected: raw,
    },
    {
      path: "/named-sequence",
      status: 200,
      media: { examples: { first: { value: sequence } } },
      expected: 'id: 0\nevent: sample.delta\ndata: {"text":"hello"}\n\n',
    },
    {
      path: "/referenced-example",
      status: 200,
      media: { examples: { first: { $ref: "#/components/examples/Events" } } },
      expected: 'id: 0\nevent: sample.delta\ndata: {"text":"hello"}\n\n',
    },
    { path: "/empty", status: 200, media: { example: [] }, expected: "" },
    ...[204, 205, 304].map((status) => ({
      path: `/status-${status}`,
      status,
      media: { example: sequence },
      expected: "",
    })),
  ];
  const { spec } = await parseSpec(JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Synthetic examples API", version: "1" },
    paths: Object.fromEntries(cases.map(({ path, status, media }) => [
      path,
      {
        get: {
          responses: {
            [status]: {
              description: "Example",
              content: { "text/event-stream": media },
            },
          },
        },
      },
    ])),
    components: { examples: { Events: { value: sequence } } },
  }));
  const server = new MockServer(spec, {
    port: 0,
    host: "127.0.0.1",
    logLevel: "summary",
    streaming: { count: 1, interval: 0 },
  });
  const port = await server.start();
  try {
    for (const { path, status, expected } of cases) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const body = await response.text();
      assertEquals(response.status, status, path);
      assertEquals(body, expected, path);
    }
  } finally {
    await server.stop();
  }
});
