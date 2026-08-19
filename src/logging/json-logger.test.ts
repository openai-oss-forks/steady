import { assertEquals } from "@std/assert";
import { JsonLogger } from "./json-logger.ts";
import type { RequestEvent, ShutdownEvent, StartupEvent } from "./types.ts";
import type { Diagnostic } from "../diagnostic.ts";

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: "E3007",
    severity: "error",
    category: "sdk-issue",
    requestPath: "body.email",
    specPointer: "#/test",
    message: "Missing required property: email",
    attribution: { confidence: 1.0, reasoning: ["test reasoning"] },
    ...overrides,
  };
}

function makeRequestEvent(
  diagnostics: Diagnostic[] = [],
): RequestEvent {
  return {
    id: "req-1",
    timestamp: new Date("2025-01-01"),
    type: "request",
    request: {
      method: "POST",
      path: "/users",
      pathPattern: "/users",
      query: "",
      headers: new Headers(),
    },
    response: {
      status: 200,
      statusText: "OK",
      timing: 5,
      headers: new Headers(),
    },
    diagnostics,
  };
}

function captureLog(fn: () => void): string[] {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

function parseJsonLine(lines: string[], index = 0): Record<string, unknown> {
  return JSON.parse(lines[index] ?? "{}");
}

Deno.test("JsonLogger", async (t) => {
  await t.step("request event includes attribution on diagnostics", () => {
    const logger = new JsonLogger();
    const lines = captureLog(() =>
      logger.request(makeRequestEvent([makeDiag()]))
    );
    assertEquals(lines.length, 1);
    const output = parseJsonLine(lines);
    const diags = output.diagnostics as Record<string, unknown>[];
    assertEquals(diags.length, 1);
    const d = diags[0];
    assertEquals(d?.category, "sdk-issue");
    assertEquals(d?.requestPath, "body");
    assertEquals(d?.specPointer, "#/test");
    const attr = d?.attribution as Record<string, unknown>;
    assertEquals(attr?.confidence, 1.0);
    assertEquals(attr?.reasoning, []);
    // category should NOT be inside attribution (no redundancy)
    assertEquals(attr?.category, undefined);
  });

  await t.step("request event emits even with no diagnostics", () => {
    const logger = new JsonLogger();
    const lines = captureLog(() => logger.request(makeRequestEvent([])));
    assertEquals(lines.length, 1);
    const output = parseJsonLine(lines);
    assertEquals(output.type, "request");
    const diags = output.diagnostics as unknown[];
    assertEquals(diags.length, 0);
  });

  await t.step(
    "startup event includes attribution on diagnostics",
    () => {
      const logger = new JsonLogger();
      const event: StartupEvent = {
        id: "s1",
        timestamp: new Date("2025-01-01"),
        type: "startup",
        spec: { title: "Test API", version: "1.0", endpointCount: 3 },
        server: { url: "http://localhost:3000", rejectOnSdkError: false },
        diagnostics: [
          makeDiag({
            code: "E1004",
            severity: "error",
            category: "spec-issue",
            attribution: {
              confidence: 1.0,
              reasoning: ["Unresolved $ref"],
            },
          }),
        ],
      };
      const lines = captureLog(() => logger.startup(event));
      const output = parseJsonLine(lines);
      assertEquals(output.type, "startup");
      const diags = output.diagnostics as Record<string, unknown>[];
      assertEquals(diags.length, 1);
      const d = diags[0];
      assertEquals(d?.category, "spec-issue");
      const attr = d?.attribution as Record<string, unknown>;
      assertEquals(attr?.confidence, 1.0);
      assertEquals(attr?.reasoning, ["Unresolved $ref"]);
    },
  );

  await t.step("shutdown topIssues include attribution", () => {
    const logger = new JsonLogger();
    const event: ShutdownEvent = {
      id: "s2",
      timestamp: new Date("2025-01-01"),
      type: "shutdown",
      session: {
        duration: 1000,
        requestCount: 10,
        failedCount: 2,
        validityRate: 0.8,
        categoryBreakdown: { "sdk-issue": 3 },
      },
      topIssues: [
        {
          code: "E3007",
          method: "POST",
          path: "/users",
          message: "Missing required field",
          count: 3,
          category: "sdk-issue",
          attribution: {
            confidence: 1.0,
            reasoning: ["test shutdown reasoning"],
          },
        },
      ],
    };
    const lines = captureLog(() => logger.shutdown(event));
    const output = parseJsonLine(lines);
    assertEquals(output.type, "shutdown");
    const issues = output.topIssues as Record<string, unknown>[];
    assertEquals(issues.length, 1);
    const issue = issues[0];
    assertEquals(issue?.code, "E3007");
    assertEquals(issue?.category, "sdk-issue");
    const attr = issue?.attribution as Record<string, unknown>;
    assertEquals(attr?.confidence, 1.0);
    assertEquals(attr?.reasoning, []);
    // category should NOT be inside attribution
    assertEquals(attr?.category, undefined);
  });

  await t.step(
    "startup diagnostics use requestPath and specPointer fields",
    () => {
      const logger = new JsonLogger();
      const event: StartupEvent = {
        id: "s3",
        timestamp: new Date("2025-01-01"),
        type: "startup",
        spec: { title: "Test API", version: "1.0", endpointCount: 3 },
        server: { url: "http://localhost:3000", rejectOnSdkError: false },
        diagnostics: [
          makeDiag({
            code: "E1004",
            severity: "error",
            category: "spec-issue",
            requestPath: "",
            specPointer: "#/paths/~1users/get",
          }),
        ],
      };
      const lines = captureLog(() => logger.startup(event));
      const output = parseJsonLine(lines);
      const diags = output.diagnostics as Record<string, unknown>[];
      assertEquals(diags[0]?.specPointer, "#/paths/~1users/get");
      assertEquals(diags[0]?.requestPath, "");
      // Should NOT have old "pointer" field
      assertEquals("pointer" in (diags[0] ?? {}), false);
    },
  );

  await t.step("shutdown includes generationWarnings when present", () => {
    const logger = new JsonLogger();
    const event: ShutdownEvent = {
      id: "s4",
      timestamp: new Date("2025-01-01"),
      type: "shutdown",
      session: {
        duration: 500,
        requestCount: 5,
        failedCount: 0,
        validityRate: 1.0,
        categoryBreakdown: {},
      },
      topIssues: [],
      generationWarnings: ["GET /users", "POST /items"],
    };
    const lines = captureLog(() => logger.shutdown(event));
    const output = parseJsonLine(lines);
    assertEquals(output.generationWarnings, ["GET /users", "POST /items"]);
  });

  await t.step(
    "shutdown omits generationWarnings when empty",
    () => {
      const logger = new JsonLogger();
      const event: ShutdownEvent = {
        id: "s5",
        timestamp: new Date("2025-01-01"),
        type: "shutdown",
        session: {
          duration: 500,
          requestCount: 5,
          failedCount: 0,
          validityRate: 1.0,
          categoryBreakdown: {},
        },
        topIssues: [],
      };
      const lines = captureLog(() => logger.shutdown(event));
      const output = parseJsonLine(lines);
      assertEquals(output.generationWarnings, undefined);
    },
  );

  await t.step("details level includes request and response headers", () => {
    const logger = new JsonLogger({ level: "details" });
    const event = makeRequestEvent();
    event.request.headers = new Headers({
      "content-type": "application/json",
      "x-api-key": "secret",
    });
    event.response.headers = new Headers({
      "content-type": "application/json",
      "x-steady-request-valid": "true",
    });
    const lines = captureLog(() => logger.request(event));
    const output = parseJsonLine(lines);
    const req = output.request as Record<string, unknown>;
    const res = output.response as Record<string, unknown>;
    assertEquals(req.headers, {
      "content-type": "[REDACTED]",
      "x-api-key": "[REDACTED]",
    });
    assertEquals(res.headers, {
      "content-type": "[REDACTED]",
      "x-steady-request-valid": "[REDACTED]",
    });
  });

  await t.step("summary level omits headers", () => {
    const logger = new JsonLogger({ level: "summary" });
    const event = makeRequestEvent();
    event.request.headers = new Headers({ "content-type": "application/json" });
    const lines = captureLog(() => logger.request(event));
    const output = parseJsonLine(lines);
    const req = output.request as Record<string, unknown>;
    assertEquals(req.headers, undefined);
  });

  await t.step("warning and error events include id field", () => {
    const logger = new JsonLogger();
    const warnLines = captureLog(() =>
      logger.warning("test warning", { key: "val" })
    );
    const warnOutput = parseJsonLine(warnLines);
    assertEquals(typeof warnOutput.id, "string");
    assertEquals((warnOutput.id as string).length > 0, true);
    assertEquals(warnOutput.context, { key: "[REDACTED]" });

    const errLines = captureLog(() => logger.error("test error"));
    const errOutput = parseJsonLine(errLines);
    assertEquals(typeof errOutput.id, "string");
    assertEquals((errOutput.id as string).length > 0, true);
  });
});
