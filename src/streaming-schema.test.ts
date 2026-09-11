import { assertEquals, assertRejects } from "@std/assert";
import { type Schema, SchemaRegistry } from "@steady/json-schema";
import { createStreamingResponse } from "./streaming.ts";

async function render(schema: Schema, example?: unknown): Promise<string> {
  const registry = SchemaRegistry.fromSpec({
    schema,
    components: {
      schemas: {
        Event: {
          discriminator: { propertyName: "kind" },
          oneOf: [{ $ref: "#/components/schemas/Delta" }],
        },
        Delta: {
          type: "object",
          required: ["kind", "text"],
          properties: {
            kind: { const: "sample.delta" },
            text: { const: "hello" },
          },
        },
      },
    },
  });
  const { stream } = createStreamingResponse(
    registry,
    schema,
    "#/schema",
    "sse",
    {
      count: 1,
      interval: 0,
      example,
    },
  );
  return await new Response(stream).text();
}

Deno.test("SSE names follow referenced and composed discriminators", async () => {
  for (
    const schema of [
      { $ref: "#/components/schemas/Event" },
      { allOf: [{ $ref: "#/components/schemas/Event" }] },
    ]
  ) {
    assertEquals(
      await render(schema),
      'id: 0\nevent: sample.delta\ndata: {"kind":"sample.delta","text":"hello"}\n\n',
    );
  }
});

Deno.test("SSE event envelopes put only the payload in the data field", async () => {
  assertEquals(
    await render({
      type: "object",
      required: ["event", "data"],
      discriminator: { propertyName: "event" },
      properties: {
        event: { const: "sample.delta" },
        data: { const: { text: "hello" } },
      },
    }),
    'id: 0\nevent: sample.delta\ndata: {"text":"hello"}\n\n',
  );
});

Deno.test("SSE leaves ordinary data properties and untagged payloads intact", async () => {
  assertEquals(
    await render({ const: { event: "business-event", data: 0 } }),
    'id: 0\nevent: message\ndata: {"event":"business-event","data":0}\n\n',
  );
  assertEquals(
    await render({ const: null }),
    "id: 0\nevent: message\ndata: null\n\n",
  );
});

Deno.test("SSE examples preserve exact termination including explicit DONE", async () => {
  assertEquals(
    await render({}, [
      { event: "sample.delta", data: { text: "hello" } },
      { event: null, id: null, data: "[DONE]" },
    ]),
    'id: 0\nevent: sample.delta\ndata: {"text":"hello"}\n\ndata: [DONE]\n\n',
  );
});

Deno.test("SSE discriminator values cannot inject framing", async () => {
  await assertRejects(
    () =>
      render({
        discriminator: { propertyName: "kind" },
        const: { kind: "sample\ndata: injected" },
      }),
    Error,
    "Invalid SSE event name",
  );
});
