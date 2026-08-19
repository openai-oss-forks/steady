import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { loopbackHost, readLimitedBody, RequestLimitError } from "./limits.ts";
import { getEffectiveGeneratorOptions } from "./options.ts";
import { MockServer } from "./mod.ts";
import { parseSpecFromFile } from "@steady/openapi";
import type { ServerConfig } from "../types.ts";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "summary",
  quiet: true,
};

Deno.test("loopback-only binding rejects wildcard, external, and DNS names", () => {
  assertEquals(loopbackHost("localhost"), "127.0.0.1");
  assertEquals(loopbackHost("::1"), "::1");
  for (
    const host of [
      "0.0.0.0",
      "::",
      "example.com",
      "192.168.1.1",
      "127.1",
      "localhost.example.com",
      "",
    ]
  ) {
    assertThrows(() => loopbackHost(host));
  }
});

Deno.test("body limit counts chunks and rejects false Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(3));
      c.enqueue(new Uint8Array(3));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assertRejects(() =>
    readLimitedBody(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-length": "1" },
        body: stream,
      }),
      5,
    ), RequestLimitError);
  assertEquals(cancelled, true);
  assertEquals(
    await readLimitedBody(
      new Request("http://localhost", { method: "POST", body: "hello" }),
      5,
    ),
    new TextEncoder().encode("hello"),
  );
  await assertRejects(
    () =>
      readLimitedBody(
        new Request("http://localhost", {
          method: "POST",
          body: new ReadableStream(),
        }),
        5,
        1,
      ),
    RequestLimitError,
    "timed out",
  );
});

Deno.test("generator header limits reject malformed and excessive values", () => {
  for (
    const value of [
      "1001",
      "999999999999999999999",
      "-1",
      "3junk",
      "1.5",
      "Infinity",
      "",
    ]
  ) {
    assertThrows(
      () =>
        getEffectiveGeneratorOptions(
          new Request("http://localhost", {
            headers: { "X-Steady-Array-Size": value },
          }),
          config,
        ),
      RequestLimitError,
    );
  }
  assertEquals(
    getEffectiveGeneratorOptions(
      new Request("http://localhost", {
        headers: { "X-Steady-Array-Size": "2" },
      }),
      config,
    ).arrayMax,
    2,
  );
});

Deno.test({
  name: "server rejects oversized bodies and accepts ordinary requests",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { spec } = await parseSpecFromFile(
      "tests/specs/synthetic-service.yaml",
    );
    assertThrows(() => new MockServer(spec, { ...config, host: "0.0.0.0" }));
    const server = new MockServer(spec, {
      ...config,
      maxRequestBodyBytes: 128,
    });
    const port = await server.start();
    const base = `http://127.0.0.1:${port}`;
    try {
      const large = await fetch(`${base}/api/v1/dashboard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "x".repeat(200) }),
      });
      assertEquals(large.status, 413);
      await large.text();
      const invalid = await fetch(`${base}/api/v1/hosts`, {
        headers: { "X-Steady-Array-Max": "999999" },
      });
      assertEquals(invalid.status, 400);
      await invalid.text();
      const good = await fetch(`${base}/api/v1/dashboard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Test",
          widgets: [],
          layout_type: "ordered",
        }),
      });
      assertEquals(good.status, 200);
      assertEquals(await good.json(), { ok: true });
    } finally {
      await server.stop();
    }
  },
});
