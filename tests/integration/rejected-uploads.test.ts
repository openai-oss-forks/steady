import { assert, assertEquals } from "@std/assert";
import { MockServer } from "../../src/server/mod.ts";
import type { OpenAPIRaw } from "../../packages/openapi/mod.ts";

const spec: OpenAPIRaw = {
  openapi: "3.1.0",
  info: { title: "Rejected uploads", version: "1" },
  paths: { "/known": { get: { responses: { "200": { description: "OK" } } } } },
};
const encoder = new TextEncoder();

async function upload(
  port: number,
  path: string,
  method = "POST",
  expectedStatus = path === "/known" || method !== "POST" ? 405 : 404,
): Promise<void> {
  const conn = await Deno.connect({ hostname: "127.0.0.1", port });
  const timer = setTimeout(() => conn.close(), 5000);
  async function write(text: string) {
    const bytes = encoder.encode(text);
    let offset = 0;
    while (offset < bytes.length) {
      offset += await conn.write(bytes.subarray(offset));
    }
  }
  try {
    const headers =
      `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\nContent-Type: multipart/form-data; boundary=upload\r\nConnection: close\r\n\r\n`;
    await write(headers);
    const first =
      '--upload\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\n\r\n';
    await write(`${encoder.encode(first).length.toString(16)}\r\n${first}\r\n`);
    const response = new Uint8Array(4096);
    let responded = false;
    const firstRead = conn.read(response).then((size) => {
      responded = true;
      return size;
    });
    // Hold the producer open. A routing response must wait for the remaining upload.
    await new Promise((resolve) => setTimeout(resolve, 30));
    assertEquals(
      responded,
      false,
      "server responded before consuming the upload",
    );
    const last = "x".repeat(256 * 1024) + "\r\n--upload--\r\n";
    await write(
      `${encoder.encode(last).length.toString(16)}\r\n${last}\r\n0\r\n\r\n`,
    );
    const size = await firstRead;
    assert(size !== null);
    let status = new TextDecoder().decode(response.subarray(0, size));
    while (!status.includes("\r\n")) {
      const next = await conn.read(response);
      assert(next !== null, "connection closed before the status line");
      status += new TextDecoder().decode(response.subarray(0, next));
    }
    assert(
      status.startsWith(
        `HTTP/1.1 ${expectedStatus}`,
      ),
      status,
    );
    // Consume the remaining response before closing to exercise the full lifetime.
    while (await conn.read(response) !== null) { /* discard */ }
  } finally {
    clearTimeout(timer);
    try {
      conn.close();
    } catch { /* already timed out */ }
  }
}

Deno.test("routing errors drain delayed concurrent multipart uploads", async () => {
  const server = new MockServer(spec, {
    host: "127.0.0.1",
    port: 0,
    logLevel: "summary",
    quiet: true,
  });
  const port = await server.start();
  try {
    for (let round = 0; round < 3; round++) {
      const results = await Promise.allSettled(
        ["/missing", "/known", "/missing", "/known"].map((path) =>
          upload(port, path)
        ),
      );
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    }
    await upload(port, "/known", "PROPFIND");
    for (
      const path of [
        "/_x-steady/health",
        "/_x-steady/spec",
        "/_x-steady/redirected",
      ]
    ) {
      await upload(port, path, "POST", 200);
    }
  } finally {
    await server.stop();
  }
});
