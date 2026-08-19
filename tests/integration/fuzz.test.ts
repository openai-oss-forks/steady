/**
 * Integration test: run the fuzz library against a real MockServer.
 *
 * Uses FuzzSession to generate and deduplicate cases, sends each to
 * the server, and checks for false positives.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { request as httpRequest } from "node:http";
import { parseSpecFromFile } from "../../packages/openapi/mod.ts";
import { OpenAPISpec } from "../../packages/openapi/spec.ts";
import { SchemaRegistry } from "@steady/json-schema";
import { MockServer } from "../../src/server/mod.ts";
import { FuzzSession } from "@steady/fuzz";
import type { FuzzRequest, PathMatcher } from "@steady/fuzz";
import { Router } from "../../src/router.ts";

// ── Unix socket helper ──────────────────────────────────────────────
// Uses a unix socket instead of TCP to avoid client-side ephemeral port
// exhaustion (TIME_WAIT accumulation from ~40k fetch() calls across
// ~1970 specs in the openapi-directory fuzz suite).

const socketPath = `${
  Deno.env.get("TMPDIR") ?? "/tmp"
}/steady-fuzz-${Deno.pid}.sock`;

// ── Helpers ─────────────────────────────────────────────────────────

interface ServerContext {
  server: MockServer;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

/** Transport info for routing requests to the right backend. */
interface Transport {
  client: Deno.HttpClient;
  socketPath: string;
}

const NO_FETCH_BODY_METHODS = new Set(["GET", "HEAD"]);

/**
 * Send an HTTP request via fetch() or node:http.
 *
 * fetch() is preferred, but the fetch spec forbids bodies on GET/HEAD.
 * For those cases, fall back to node:http which allows it. When using
 * unix sockets, node:http's socketPath option routes through the socket.
 */
function sendRequest(
  url: string,
  init?: RequestInit,
  transport?: Transport,
): Promise<Response> {
  const method = init?.method ?? "GET";
  const hasBody = init?.body !== undefined && init.body !== null;

  if (!hasBody || !NO_FETCH_BODY_METHODS.has(method)) {
    return fetch(
      url,
      transport ? { ...init, client: transport.client } : init,
    );
  }

  // fetch() throws on GET/HEAD with body. Use node:http instead,
  // with socketPath for unix sockets or hostname/port for TCP.
  return sendViaNodeHttp(url, method, init, transport?.socketPath);
}

/** Send a GET/HEAD request with body via node:http. */
function sendViaNodeHttp(
  url: string,
  method: string,
  init?: RequestInit,
  unixSocketPath?: string,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOpts = unixSocketPath
      ? {
        socketPath: unixSocketPath,
        path: u.pathname + u.search,
        method,
        headers: init?.headers as Record<string, string>,
      }
      : {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: init?.headers as Record<string, string>,
      };

    const req = httpRequest(reqOpts, (res) => {
      const chunks: Uint8Array[] = [];
      res.on("data", (chunk: Uint8Array) => chunks.push(chunk));
      res.on("end", () => {
        const body = new Uint8Array(
          chunks.reduce((acc, c) => acc + c.length, 0),
        );
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.length;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value) {
            const v = Array.isArray(value) ? value[0] : value;
            if (v) headers.set(key, v);
          }
        }
        resolve(
          new Response(body.length > 0 ? body : null, {
            status: res.statusCode ?? 200,
            headers,
          }),
        );
      });
    });
    req.on("error", reject);
    req.write(init!.body as string);
    req.end();
  });
}

async function withServer(
  specPath: string,
  fn: (ctx: ServerContext) => Promise<void>,
  opts?: { useSocket?: boolean },
): Promise<void> {
  const spec = (await parseSpecFromFile(specPath)).spec;
  const useSocket = opts?.useSocket ?? false;

  if (useSocket) {
    try {
      await Deno.remove(socketPath);
    } catch { /* ignore */ }
  }

  const server = new MockServer(spec, {
    port: 0,
    host: "localhost",
    quiet: true,
    logLevel: "summary",
    ...(useSocket ? { socketPath } : {}),
  });

  const port = await server.start();
  const transport = useSocket
    ? {
      client: Deno.createHttpClient({
        proxy: { url: "unix:" + socketPath },
      }),
      socketPath,
    }
    : undefined;
  const baseUrl = useSocket ? "http://localhost" : `http://localhost:${port}`;

  try {
    await fn({
      server,
      fetch: (path, init) => sendRequest(`${baseUrl}${path}`, init, transport),
    });
  } finally {
    transport?.client.close();
    await server.stop();
  }
}

function buildUrl(req: FuzzRequest): string {
  const queryEntries = Object.entries(req.query);
  if (queryEntries.length === 0) return req.path;
  const params = new URLSearchParams();
  for (const [key, value] of queryEntries) {
    params.set(key, value);
  }
  return `${req.path}?${params.toString()}`;
}

function toRequestInit(req: FuzzRequest): RequestInit {
  const init: RequestInit = {
    method: req.method.toUpperCase(),
    headers: { ...req.headers },
    redirect: "manual",
  };
  if (req.body !== undefined) {
    init.body = JSON.stringify(req.body);
  }
  return init;
}

function getDiagnosticCodes(response: Response): string[] {
  const codes: string[] = [];
  const count = parseInt(
    response.headers.get("x-steady-error-count") ?? "0",
    10,
  );
  for (let i = 1; i <= count; i++) {
    const code = response.headers.get(`x-steady-error-${i}-code`);
    if (code) codes.push(code);
  }
  return codes;
}

function createPathMatcher(
  spec: { paths: import("@steady/openapi").PathsObject },
): PathMatcher {
  const router = new Router(spec.paths);
  return (path, method) => {
    const result = router.match({ path, method });
    return result.matched ? result.pathPattern : null;
  };
}

// ── Tests ────────────────────────────────────────────────────────────

const FUZZ_SPEC = "./tests/specs/fuzz-test-spec.yaml";

Deno.test({
  name: "fuzz session: finds no false positives",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await withServer(FUZZ_SPEC, async (ctx) => {
      const { spec } = await parseSpecFromFile(FUZZ_SPEC);
      const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
      const pathMatcher = createPathMatcher(spec);

      const session = new FuzzSession(doc, { seed: 42, pathMatcher });

      for (const fuzzCase of session) {
        await t.step(
          `${fuzzCase.operation}: ${fuzzCase.mutation}`,
          async () => {
            const url = buildUrl(fuzzCase.request);
            const init = toRequestInit(fuzzCase.request);
            const response = await ctx.fetch(url, init);
            await response.body?.cancel();

            const valid = response.headers.get("x-steady-request-valid");
            const codes = getDiagnosticCodes(response);
            const status = response.status;

            // 5xx = Steady crashed, which is worse than a false positive
            const serverError = status >= 500;

            session.record(fuzzCase, {
              accepted: valid === "true" || serverError,
              reportedCodes: codes,
            });

            assertEquals(
              serverError,
              false,
              `SERVER ERROR (${status}): ${fuzzCase.operation} / ${fuzzCase.mutation}`,
            );
            assertEquals(
              valid,
              "false",
              `FALSE POSITIVE: ${fuzzCase.operation} / ${fuzzCase.mutation}`,
            );
          },
        );
      }

      const report = session.report();

      await t.step("report summary", () => {
        assertNotEquals(report.totalCases, 0, "Should have tested some cases");
        assertEquals(
          report.falsePositives,
          0,
          `Found ${report.falsePositives} false positive(s):\n` +
            report.falsePositiveDetails
              .map((fp) => `  - ${fp.operation}: ${fp.mutation}`)
              .join("\n"),
        );
      });
    });
  },
});

// ── Misc ────────────────────────────────────────────────────────────

Deno.test({
  name: "fuzz session: maxCases budget is respected",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withServer(FUZZ_SPEC, async (ctx) => {
      const { spec } = await parseSpecFromFile(FUZZ_SPEC);
      const doc = new OpenAPISpec(SchemaRegistry.fromSpec(spec));
      const pathMatcher = createPathMatcher(spec);

      const session = new FuzzSession(doc, { maxCases: 3, pathMatcher });

      let count = 0;
      for (const fuzzCase of session) {
        const url = buildUrl(fuzzCase.request);
        const init = toRequestInit(fuzzCase.request);
        const response = await ctx.fetch(url, init);
        await response.body?.cancel();

        const valid = response.headers.get("x-steady-request-valid");
        session.record(fuzzCase, { accepted: valid === "true" });
        count++;
      }

      assertEquals(count, 3);
      const report = session.report();
      assertEquals(report.totalCases, 3);
      assertEquals(report.stopReason, "maxCases");
    });
  },
});
