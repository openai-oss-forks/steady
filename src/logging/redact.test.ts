import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { JsonLogger } from "./json-logger.ts";
import { TextLogger } from "./text-logger.ts";
import { CILogger } from "./ci-logger.ts";
import { REDACTED } from "./redact.ts";
import type { Diagnostic } from "../diagnostic.ts";
import type { RequestEvent } from "./types.ts";
import { DiagnosticCollector } from "../diagnostics/collector.ts";
import { SessionStore } from "../session/store.ts";
import { computeExitCode } from "../server/lifecycle.ts";

const secret = "canary-sensitive-value";
const diagnostic: Diagnostic = {
  code: "E3008",
  severity: "error",
  category: "sdk-issue",
  requestPath: `body.${secret}`,
  specPointer: "#/components/schemas/Input",
  message: `Invalid value ${secret}`,
  expected: secret,
  actual: { nested: secret },
  attribution: { confidence: 1, reasoning: [secret] },
  suggestion: secret,
  display: { context: [{ text: secret }], notes: [secret] },
};

Deno.test("all logger formats redact request values without mutating events", () => {
  const event: RequestEvent = {
    type: "request",
    id: "test",
    timestamp: new Date(),
    request: {
      method: "POST",
      path: `/users/${secret}`,
      pathPattern: "/users/{id}",
      query: `?token=${secret}`,
      headers: new Headers({
        Authorization: secret,
        Cookie: secret,
        "x-custom-key": secret,
      }),
      body: { password: secret, nested: [secret] },
    },
    response: {
      status: 400,
      statusText: "Bad Request",
      timing: 1,
      headers: new Headers({ "set-cookie": secret }),
      body: { token: secret },
    },
    diagnostics: [diagnostic],
  };
  for (const Logger of [JsonLogger, TextLogger, CILogger]) {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args) => lines.push(args.map(String).join(" "));
    try {
      new Logger({ level: "full", logBodies: true, color: false }).request(
        event,
      );
    } finally {
      console.log = original;
    }
    const output = lines.join("\n");
    assertFalse(output.includes(secret));
    assertStringIncludes(output, "E3008");
    assertStringIncludes(output, "/users/{id}");
  }
  assertEquals(event.request.headers.get("authorization"), secret);
  assertEquals(event.diagnostics[0]?.message, `Invalid value ${secret}`);
});

Deno.test("retained runtime diagnostics are redacted and bounded", () => {
  const collector = new DiagnosticCollector();
  collector.addRuntimeDiagnostics(
    Array(10002).fill(diagnostic),
    "post",
    "/users/{id}",
    false,
  );
  assertEquals(collector.getRuntimeDiagnostics().length, 10000);
  assertEquals(collector.getDroppedDiagnosticCount(), 2);
  collector.addRuntimeDiagnostics(
    [
      { ...diagnostic, category: "ambiguous", severity: "warning" },
    ],
    "get",
    "/",
    true,
  );
  assertEquals(
    computeExitCode(0, {
      host: "127.0.0.1",
      port: 0,
      logLevel: "summary",
      failOnWarnings: true,
    }, collector),
    1,
  );
  assertEquals(collector.getCategoryBreakdown().ambiguous, 1);
  assertFalse(JSON.stringify(collector.getTopIssues()).includes(secret));
  assertEquals(collector.getRuntimeDiagnostics()[0]?.actual, REDACTED);
  const sessions = new SessionStore();
  sessions.addRequest(
    "first",
    "post",
    `/users/${secret}`,
    Array(1002).fill(diagnostic),
    "/users/{id}",
  );
  assertEquals(sessions.getSession("first")?.sdkIssues.length, 1000);
  assertEquals(sessions.getSession("first")?.droppedDiagnostics, 2);
  assertFalse(JSON.stringify(sessions.getSession("first")).includes(secret));
  for (let i = 0; i < 1000; i++) sessions.addRequest(String(i), "get", "/", []);
  assertEquals(sessions.getSession("first"), undefined);
});
