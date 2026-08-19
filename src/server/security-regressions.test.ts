import { assertEquals, assertFalse } from "@std/assert";
import { MockServer } from "./mod.ts";
import { parseSpecFromFile } from "@steady/openapi";
import type { OpenAPIRaw } from "@steady/openapi";
import type { ServerConfig } from "../types.ts";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  logLevel: "summary",
  quiet: true,
};
const jsonResponse = (example: unknown) => ({
  description: "OK",
  content: { "application/json": { example } },
});

Deno.test({
  name: "Unicode and control bytes in diagnostics are safe HTTP headers",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const spec: OpenAPIRaw = {
      openapi: "3.1.0",
      info: { title: "Review", version: "1" },
      paths: {
        "/ok": {
          get: {
            parameters: [{
              in: "query",
              name: "known",
              schema: { type: "string" },
            }],
            responses: { "200": jsonResponse({ ok: true }) },
          },
        },
      },
    };
    const server = new MockServer(spec, config);
    const base = `http://127.0.0.1:${await server.start()}`;
    try {
      for (const key of ["unknown-😀", "unknown-\r\nvalue"]) {
        const response = await fetch(
          base + "/ok?" + encodeURIComponent(key) + "=1",
          { headers: { "X-Steady-Session": "header-values" } },
        );
        assertEquals(response.status, 200);
        assertEquals(response.headers.get("X-Steady-Error-1-Code"), "E3015");
        assertEquals(await response.json(), { ok: true });
      }
      const report =
        await (await fetch(base + "/_x-steady/sessions/header-values")).json();
      assertEquals(report.result, "passed");
      assertEquals(report.summary, { total: 2, valid: 2, invalid: 0 });
    } finally {
      await server.stop();
    }
  },
});

Deno.test({
  name: "404 and 405 diagnostics never retain raw route values",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const secret = "synthetic-path-secret";
    const spec: OpenAPIRaw = {
      openapi: "3.1.0",
      info: { title: "Review", version: "1" },
      paths: {
        "/users/{id}": {
          get: { responses: { "200": jsonResponse({ ok: true }) } },
        },
      },
    };
    for (const logFormat of ["json", "text", "ci"] as const) {
      const original = console.log;
      const lines: string[] = [];
      console.log = (...args) => lines.push(args.map(String).join(" "));
      const server = new MockServer(spec, {
        ...config,
        quiet: false,
        logLevel: "full",
        logFormat,
      });
      try {
        const base = `http://127.0.0.1:${await server.start()}`;
        for (
          const [path, method, session, status] of [[
            `/missing/${secret}`,
            "GET",
            "route404",
            404,
          ], [`/users/${secret}`, "POST", "route405", 405]] as const
        ) {
          const response = await fetch(base + path, {
            method,
            headers: { "X-Steady-Session": session },
          });
          assertEquals(response.status, status);
          await response.text();
          const report =
            await (await fetch(`${base}/_x-steady/sessions/${session}`)).text();
          assertFalse(report.includes(secret));
        }
      } finally {
        await server.stop();
        console.log = original;
      }
      assertFalse(lines.join("\n").includes(secret));
    }
  },
});

Deno.test({
  name: "session reports count safety rejections exactly once",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { spec } = await parseSpecFromFile(
      "tests/specs/synthetic-service.yaml",
    );
    const server = new MockServer(spec, {
      ...config,
      maxRequestBodyBytes: 128,
    });
    const base = `http://127.0.0.1:${await server.start()}`;
    const headers = { "X-Steady-Session": "limits" };
    try {
      const good = await fetch(base + "/api/v1/hosts", { headers });
      assertEquals(good.status, 200);
      await good.text();
      const large = await fetch(base + "/api/v1/dashboard", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ title: "x".repeat(200) }),
      });
      assertEquals(large.status, 413);
      await large.text();
      const invalid = await fetch(base + "/api/v1/hosts", {
        headers: { ...headers, "X-Steady-Array-Max": "999999" },
      });
      assertEquals(invalid.status, 400);
      await invalid.text();
      const report = await (await fetch(base + "/_x-steady/sessions/limits"))
        .json();
      assertEquals(report.requests, 3);
      assertEquals(report.result, "failed");
      assertEquals(report.summary, { total: 3, valid: 1, invalid: 2 });
      assertEquals(report.sdk_issues.map((d: { code: string }) => d.code), [
        "E3024",
        "E3024",
      ]);
    } finally {
      await server.stop();
    }
  },
});

Deno.test({
  name: "media examples cannot bypass output limits",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const spec: OpenAPIRaw = {
      openapi: "3.1.0",
      info: { title: "Review", version: "1" },
      paths: {
        "/large": {
          get: {
            responses: { "200": jsonResponse({ value: "x".repeat(65537) }) },
          },
        },
        "/safe": { get: { responses: { "200": jsonResponse({ ok: true }) } } },
      },
    };
    const server = new MockServer(spec, config);
    const base = `http://127.0.0.1:${await server.start()}`;
    try {
      const large = await fetch(base + "/large", {
        headers: { "X-Steady-Session": "output" },
      });
      assertEquals(large.status, 400);
      await large.text();
      const report = await (await fetch(base + "/_x-steady/sessions/output"))
        .json();
      assertEquals(report.summary, { total: 1, valid: 0, invalid: 1 });
      assertEquals(report.result, "failed");
      assertEquals(report.spec_issues[0].code, "E3024");
      const safe = await fetch(base + "/safe");
      assertEquals(safe.status, 200);
      assertEquals(await safe.json(), { ok: true });
    } finally {
      await server.stop();
    }
  },
});
