/**
 * End-to-end tests for runtime request diagnostics.
 *
 * Each test goes through the full pipeline:
 *   spec file → parseSpecFromFile → OpenAPISpec → TreeValidator →
 *   DiagnosticEngine → analyze(request) → assert on diagnostics
 *
 * No mocks, no shortcuts. Exercises the real parser, schema resolution,
 * tree validation, and diagnostic engine against the acme-api fixture.
 */

import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { parseSpecFromFile } from "@steady/openapi";
import { SchemaRegistry } from "../../packages/json-schema/schema-registry.ts";
import { OpenAPISpec } from "../../packages/openapi/spec.ts";
import { TreeValidator } from "../../packages/json-schema/tree-validator.ts";
import {
  type AnalyzeRequest,
  DiagnosticEngine,
} from "../../src/engine/diagnostic-engine.ts";
import type { Diagnostic } from "../../src/diagnostic.ts";
import { Router } from "../../src/router.ts";

/** Load the acme spec once, shared across all tests. */
let engine: DiagnosticEngine;

async function getEngine(): Promise<DiagnosticEngine> {
  if (engine) return engine;

  const { spec } = await parseSpecFromFile("test-fixtures/acme-api-3.1.yaml");
  const registry = SchemaRegistry.fromSpec(spec);
  const doc = new OpenAPISpec(registry);
  const validator = new TreeValidator({ registry });
  const router = new Router(spec.paths);
  engine = new DiagnosticEngine(doc, validator, router);
  return engine;
}

/** Helper: analyze a request and return diagnostics. */
async function analyze(request: AnalyzeRequest): Promise<Diagnostic[]> {
  const e = await getEngine();
  return e.analyze(request);
}

// ── Routing ─────────────────────────────────────────────────────────

Deno.test("valid route → no diagnostics", async () => {
  const diagnostics = await analyze({ path: "/status", method: "GET" });
  assertEquals(diagnostics.length, 0);
});

Deno.test("unknown path → E2001", async (t) => {
  const diagnostics = await analyze({ path: "/nonexistent", method: "GET" });
  await assertSnapshot(t, diagnostics);
});

Deno.test("wrong method → E2002", async (t) => {
  const diagnostics = await analyze({ path: "/accounts", method: "DELETE" });
  await assertSnapshot(t, diagnostics);
});

Deno.test("path with parameter matches correctly", async () => {
  const diagnostics = await analyze({
    path: "/accounts/abc-123",
    method: "GET",
  });
  assertEquals(diagnostics.length, 0);
});

// ── Body validation ─────────────────────────────────────────────────

Deno.test("POST /accounts with empty body → missing required field", async (t) => {
  const diagnostics = await analyze({
    path: "/accounts",
    method: "POST",
    body: {},
  });
  await assertSnapshot(t, diagnostics);
});

Deno.test("POST /accounts with wrong type → E3008", async (t) => {
  const diagnostics = await analyze({
    path: "/accounts",
    method: "POST",
    body: { name: 42 },
  });
  await assertSnapshot(t, diagnostics);
});

Deno.test("POST /accounts with invalid enum → E3016", async (t) => {
  const diagnostics = await analyze({
    path: "/accounts",
    method: "POST",
    body: { name: "Alice", plan: "INVALID" },
  });
  await assertSnapshot(t, diagnostics);
});

Deno.test("POST /accounts with valid body → no diagnostics", async () => {
  const diagnostics = await analyze({
    path: "/accounts",
    method: "POST",
    body: { name: "Alice", plan: "FREE" },
  });
  assertEquals(diagnostics.length, 0);
});

// ── Nested $ref resolution ──────────────────────────────────────────

Deno.test("POST /accounts with invalid nested address → errors at nested path", async (t) => {
  const diagnostics = await analyze({
    path: "/accounts",
    method: "POST",
    body: {
      name: "Alice",
      address: { city: 123 },
    },
  });
  await assertSnapshot(t, diagnostics);
});

// ── oneOf with discriminator ────────────────────────────────────────

Deno.test("POST /accounts/{id}/link with valid google link → no diagnostics", async () => {
  const diagnostics = await analyze({
    path: "/accounts/abc-123/link",
    method: "POST",
    body: { type: "google", google_account_id: "12345" },
  });
  assertEquals(diagnostics.length, 0);
});

Deno.test("POST /accounts/{id}/link with wrong variant data → errors", async (t) => {
  const diagnostics = await analyze({
    path: "/accounts/abc-123/link",
    method: "POST",
    body: { type: "google", facebook_account_id: "12345" },
  });
  await assertSnapshot(t, diagnostics);
});

// ── Multiple diagnostic types ───────────────────────────────────────

Deno.test("multiple errors: wrong type + invalid enum", async (t) => {
  const diagnostics = await analyze({
    path: "/accounts",
    method: "POST",
    body: { name: 42, plan: "INVALID", state: "UNKNOWN" },
  });
  await assertSnapshot(t, diagnostics);
});
