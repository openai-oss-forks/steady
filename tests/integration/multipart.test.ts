/**
 * Integration tests for multipart/form-data request handling.
 *
 * Covers two bugs found via the openai-go SDK:
 * 1. Form array format flags (e.g. --validator-form-array-format=brackets)
 *    are not threaded into parseRequestBody, so `files[]` is never
 *    normalized to `files`.
 * 2. No schema is passed to the form parser, so string-to-boolean coercion
 *    (multipart `default=true` -> boolean true) never happens.
 */

import { assertEquals } from "@std/assert";
import { parseSpecFromFile } from "../../packages/openapi/mod.ts";
import { MockServer } from "../../src/server/mod.ts";

// ── Helpers ─────────────────────────────────────────────────────────

interface ServerContext {
  server: MockServer;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

async function withServer(
  specPath: string,
  fn: (ctx: ServerContext) => Promise<void>,
  opts?: {
    validator?: {
      formArrayFormat?: "brackets" | "repeat";
      formObjectFormat?: "brackets" | "flat";
    };
  },
): Promise<void> {
  const { spec } = await parseSpecFromFile(specPath);
  const server = new MockServer(spec, {
    port: 0,
    host: "localhost",
    logLevel: "summary",
    ...opts,
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

/** Extract X-Steady-* diagnostic headers from a response. */
function diagnosticHeaders(response: Response): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of response.headers) {
    if (key.toLowerCase().startsWith("x-steady-")) {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}

const SPEC = "./tests/specs/multipart-test.yaml";
const serverTestOpts = { sanitizeOps: false, sanitizeResources: false };

// ── Bug 1: form array format not threaded ───────────────────────────

Deno.test({
  name:
    "multipart: brackets format normalizes files[] to files for required property",
  ...serverTestOpts,
  fn: async () => {
    await withServer(
      SPEC,
      async (ctx) => {
        const form = new FormData();
        form.append(
          "files[]",
          new File(["hello"], "part-1.txt", { type: "text/plain" }),
        );
        form.append(
          "files[]",
          new File(["world"], "part-2.txt", { type: "text/plain" }),
        );

        const response = await ctx.fetch("/uploads/upload_123/parts", {
          method: "POST",
          body: form,
        });

        const diags = diagnosticHeaders(response);
        assertEquals(
          response.status,
          200,
          `Expected 200, got ${response.status}. ` +
            `error-count=${diags["x-steady-error-count"]}, ` +
            `error-1=${diags["x-steady-error-1-code"]}: ${
              diags["x-steady-error-1-message"]
            }`,
        );
        assertEquals(diags["x-steady-error-count"], "0");
        await response.body?.cancel();
      },
      { validator: { formArrayFormat: "brackets" } },
    );
  },
});

// ── Bug 2: type coercion missing for multipart ──────────────────────

Deno.test({
  name:
    "multipart: string 'true' is coerced to boolean for type: boolean field",
  ...serverTestOpts,
  fn: async () => {
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append("default", "true");
      form.append(
        "files[]",
        new File(["hello"], "upload.txt", { type: "text/plain" }),
      );

      const response = await ctx.fetch("/skills/skill_123/versions", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

Deno.test({
  name: "multipart: string '42' is coerced to integer for type: integer field",
  ...serverTestOpts,
  fn: async () => {
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append("name", "widget");
      form.append("count", "42");

      const response = await ctx.fetch("/items", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

// ── Multipart-only spec (no application/json entry) ─────────────────

Deno.test({
  name:
    "multipart: coercion works when spec has multipart/form-data but no application/json",
  ...serverTestOpts,
  fn: async () => {
    await withServer(SPEC, async (ctx) => {
      // /items only has multipart/form-data, no application/json
      const form = new FormData();
      form.append("name", "gadget");
      form.append("count", "7");
      form.append("active", "false");

      const response = await ctx.fetch("/items", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

// ── JSON-encoded multipart parts ───────────────────────────────────

Deno.test({
  name:
    "multipart: JSON-encoded object part with explicit encoding validates as object",
  ...serverTestOpts,
  fn: async () => {
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append(
        "metadata",
        new File(
          ['{"main_module":"worker.js","compatibility_date":"2024-01-01"}'],
          "blob",
          { type: "application/json" },
        ),
      );
      form.append(
        "script",
        new File(["export default {}"], "worker.js", {
          type: "application/javascript",
        }),
      );

      const response = await ctx.fetch("/workers", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

Deno.test({
  name:
    "multipart: implicit JSON encoding for object property without explicit encoding",
  ...serverTestOpts,
  fn: async () => {
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append(
        "config",
        new File(
          ['{"region":"us-east-1","replicas":3}'],
          "blob",
          { type: "application/json" },
        ),
      );
      form.append(
        "source",
        new File(["console.log('hi')"], "app.js", {
          type: "application/javascript",
        }),
      );

      const response = await ctx.fetch("/deployments", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

Deno.test({
  name:
    "multipart: malformed JSON in a JSON-typed part produces validation error, not crash",
  ...serverTestOpts,
  fn: async () => {
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append(
        "metadata",
        new File(
          ["not valid json {{{"],
          "blob",
          { type: "application/json" },
        ),
      );
      form.append(
        "script",
        new File(["export default {}"], "worker.js", {
          type: "application/javascript",
        }),
      );

      const response = await ctx.fetch("/workers", {
        method: "POST",
        body: form,
      });

      // Should get a validation error, not a 500
      assertEquals(response.status < 500, true);
      await response.body?.cancel();
    });
  },
});

Deno.test({
  name:
    "multipart: binary file with application/json type and format:binary schema stays as file",
  ...serverTestOpts,
  fn: async () => {
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append(
        "metadata",
        new File(
          ['{"main_module":"worker.js"}'],
          "blob",
          { type: "application/json" },
        ),
      );
      // script has format: binary in schema. Even though we give it
      // application/json type, it should be treated as a file upload.
      form.append(
        "script",
        new File(['{"not":"parsed"}'], "data.json", {
          type: "application/json",
        }),
      );

      const response = await ctx.fetch("/workers", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

Deno.test({
  name:
    "multipart: two JSON-array parts for the same key produce an array-of-arrays",
  ...serverTestOpts,
  fn: async () => {
    // Regression guard. An earlier implementation merged multiple
    // JSON parts via `Array.isArray(existing)` and would concatenate
    // when the first value happened to be an array, losing the outer
    // grouping. With the bucket-based merge, each part is one element
    // of the outer array regardless of its own shape.
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append(
        "items",
        new File(["[1,2,3]"], "blob", { type: "application/json" }),
      );
      form.append(
        "items",
        new File(["[4,5,6]"], "blob", { type: "application/json" }),
      );

      const response = await ctx.fetch("/batches", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

// ── Nested object property, flat SDK serialization ─────────────────

Deno.test({
  name:
    "multipart: nested object sent as dot-notation flat keys unflattens to object",
  ...serverTestOpts,
  fn: async () => {
    // SDKs (e.g. Go) serialize nested object properties as flat
    // dot-notation keys rather than JSON-encoded parts. The schema
    // says expires_after is an object, so partContentTypes labels it
    // JSON. The form keys `expires_after.anchor` and
    // `expires_after.seconds` do not match `expires_after` exactly,
    // so they fall through to the kernel's dot-unflattening path.
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append(
        "file",
        new File(["file contents"], "data.bin", {
          type: "application/octet-stream",
        }),
      );
      form.append("purpose", "assistants");
      form.append("expires_after.anchor", "created_at");
      form.append("expires_after.seconds", "3600");

      const response = await ctx.fetch("/files", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

Deno.test({
  name:
    "multipart: nested object sent as JSON-encoded part validates as object",
  ...serverTestOpts,
  fn: async () => {
    // Same spec as the flat-keys test, but this time the SDK sends
    // expires_after as a single JSON-encoded part. partContentTypes
    // labels the key JSON, so the parser decodes it inline.
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append(
        "file",
        new File(["file contents"], "data.bin", {
          type: "application/octet-stream",
        }),
      );
      form.append("purpose", "assistants");
      form.append(
        "expires_after",
        new File(
          ['{"anchor":"created_at","seconds":3600}'],
          "blob",
          { type: "application/json" },
        ),
      );

      const response = await ctx.fetch("/files", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

Deno.test({
  name:
    "multipart: nested object sent as bracketed flat keys unflattens to object",
  ...serverTestOpts,
  fn: async () => {
    // Rails/PHP-style brackets serialization: `expires_after[anchor]`.
    await withServer(
      SPEC,
      async (ctx) => {
        const form = new FormData();
        form.append(
          "file",
          new File(["file contents"], "data.bin", {
            type: "application/octet-stream",
          }),
        );
        form.append("purpose", "assistants");
        form.append("expires_after[anchor]", "created_at");
        form.append("expires_after[seconds]", "3600");

        const response = await ctx.fetch("/files", {
          method: "POST",
          body: form,
        });

        const diags = diagnosticHeaders(response);
        assertEquals(
          response.status,
          200,
          `Expected 200, got ${response.status}. ` +
            `error-count=${diags["x-steady-error-count"]}, ` +
            `error-1=${diags["x-steady-error-1-code"]}: ${
              diags["x-steady-error-1-message"]
            }`,
        );
        assertEquals(diags["x-steady-error-count"], "0");
        await response.body?.cancel();
      },
      { validator: { formObjectFormat: "brackets" } },
    );
  },
});

// ── type: string + encoding contentType: application/json ─────────

Deno.test({
  name:
    "multipart: type: string with encoding application/json keeps value as string",
  ...serverTestOpts,
  fn: async () => {
    // When the schema says the field is a string but encoding says
    // the part's Content-Type is application/json, the value is a
    // string whose contents happen to be JSON text. Steady must not
    // decode it: schema wins over transport metadata.
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append("manifest", '{"index.html":"abc123","style.css":"def456"}');

      const response = await ctx.fetch("/manifests", {
        method: "POST",
        body: form,
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});

// ── Per-request header override ─────────────────────────────────────

Deno.test({
  name: "multipart: X-Steady-Form-Array-Format header overrides server config",
  ...serverTestOpts,
  fn: async () => {
    // Server has no formArrayFormat configured (defaults to repeat).
    // The per-request header should override to brackets.
    await withServer(SPEC, async (ctx) => {
      const form = new FormData();
      form.append(
        "files[]",
        new File(["hello"], "part-1.txt", { type: "text/plain" }),
      );

      const response = await ctx.fetch("/uploads/upload_123/parts", {
        method: "POST",
        body: form,
        headers: {
          "X-Steady-Form-Array-Format": "brackets",
        },
      });

      const diags = diagnosticHeaders(response);
      assertEquals(
        response.status,
        200,
        `Expected 200, got ${response.status}. ` +
          `error-count=${diags["x-steady-error-count"]}, ` +
          `error-1=${diags["x-steady-error-1-code"]}: ${
            diags["x-steady-error-1-message"]
          }`,
      );
      assertEquals(diags["x-steady-error-count"], "0");
      await response.body?.cancel();
    });
  },
});
