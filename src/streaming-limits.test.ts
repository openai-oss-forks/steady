import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  GenerationLimitError,
  MAX_RESPONSE_BYTES,
  SchemaRegistry,
} from "@steady/json-schema";
import type { Schema } from "@steady/json-schema";
import { createStreamingResponse } from "./streaming.ts";
import { RequestLimitError } from "./server/limits.ts";

Deno.test("streaming limits include config and example paths", () => {
  const registry = SchemaRegistry.fromSpec({});
  for (
    const options of [
      { count: Infinity },
      { count: 1001 },
      { interval: 10001 },
      { example: Array(1001).fill({ ok: true }) },
    ]
  ) {
    assertThrows(
      () =>
        createStreamingResponse(
          registry,
          { type: "object" },
          "#",
          "ndjson",
          options,
        ),
      RequestLimitError,
    );
  }
});

Deno.test("cumulative streaming bytes are bounded", async () => {
  const { stream } = createStreamingResponse(
    SchemaRegistry.fromSpec({}),
    { const: { payload: "x".repeat(65536) } },
    "#",
    "ndjson",
    { count: 257, interval: 0 },
  );
  const reader = stream.getReader();
  let bytes = 0;
  await assertRejects(async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
  }, GenerationLimitError);
  assertEquals(bytes <= MAX_RESPONSE_BYTES, true);
  reader.releaseLock();
});

Deno.test("slow and cancelled consumers do not build a producer queue", async () => {
  let generated = 0;
  const schema: Schema = {
    get const() {
      generated++;
      return { ok: true };
    },
  };
  const { stream } = createStreamingResponse(
    SchemaRegistry.fromSpec({}),
    schema,
    "#",
    "ndjson",
    { count: 1000, interval: 0 },
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(generated, 0);
  const reader = stream.getReader();
  await reader.read();
  const afterRead = generated;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(generated, afterRead);
  await reader.cancel();
  reader.releaseLock();

  const delayed = createStreamingResponse(
    SchemaRegistry.fromSpec({}),
    { const: "ok" },
    "#",
    "ndjson",
    { count: 3, interval: 10000 },
  ).stream.getReader();
  await delayed.read();
  const pending = delayed.read();
  await Promise.resolve();
  await delayed.cancel();
  assertEquals((await pending).done, true);
  delayed.releaseLock();
});

Deno.test("later streaming generation failure errors the stream safely", async () => {
  const registry = SchemaRegistry.fromSpec({});
  const schema: Schema = {
    type: "array",
    minItems: 1,
    items: { type: "integer" },
  };
  const { stream } = createStreamingResponse(registry, schema, "#", "ndjson", {
    count: 2,
    interval: 1,
  });
  const reader = stream.getReader();
  assertEquals((await reader.read()).done, false);
  schema.minItems = 1001;
  await assertRejects(() => reader.read(), GenerationLimitError);
  reader.releaseLock();
});
