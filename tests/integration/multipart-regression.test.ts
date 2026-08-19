/**
 * End-to-end repro for the multipart request-body validation bug.
 *
 * These tests assert the intended behavior:
 * - the endpoint accepts both multipart/form-data and application/json
 * - the multipart request sends `default=true` and `files[]`
 * - Steady should accept the multipart body and return 200
 */

import { assertEquals } from "@std/assert";
import { parseSpecFromFile } from "../../packages/openapi/mod.ts";
import { MockServer } from "../../src/server/mod.ts";

interface ServerContext {
  server: MockServer;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

async function withServer(
  specPath: string,
  fn: (ctx: ServerContext) => Promise<void>,
): Promise<void> {
  const { spec } = await parseSpecFromFile(specPath);
  const server = new MockServer(spec, {
    port: 0,
    host: "localhost",
    logLevel: "summary",
    validator: { formArrayFormat: "brackets" },
  });

  const port = await server.start();

  try {
    await fn({
      server,
      fetch: (path, init) => fetch(`http://localhost:${port}${path}`, init),
    });
  } finally {
    await server.stop();
  }
}

const MULTIPART_REPRO_SPEC = "./tests/specs/multipart-regression.yaml";

Deno.test({
  name: "multipart request with boolean field should coerce true to boolean",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(MULTIPART_REPRO_SPEC, async (ctx) => {
      const form = new FormData();
      form.append("default", "true");
      form.append(
        "files[]",
        new File(["hello"], "upload.txt", { type: "text/plain" }),
      );

      const response = await ctx.fetch("/uploads/upload_123/versions", {
        method: "POST",
        body: form,
      });

      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body, { ok: true });
    });
  },
});

Deno.test({
  name:
    "multipart request with bracketed array field should normalize files[] to files",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(MULTIPART_REPRO_SPEC, async (ctx) => {
      const form = new FormData();
      form.append(
        "files[]",
        new File(["hello"], "part-1.txt", { type: "text/plain" }),
      );
      form.append(
        "files[]",
        new File(["world"], "part-2.txt", { type: "text/plain" }),
      );

      const response = await ctx.fetch("/uploads/upload_123/arrays", {
        method: "POST",
        body: form,
      });

      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body, { ok: true });
    });
  },
});
