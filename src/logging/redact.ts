import { getCode, hasCode } from "../codes/registry.ts";
import type { Diagnostic } from "../diagnostic.ts";
import type { RequestEvent, ShutdownEvent } from "./types.ts";

export const REDACTED = "[REDACTED]";

/** Keep useful structure, never request/response values. Bound log expansion. */
export function redactValues(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined;
  if (depth >= 4) return REDACTED;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValues(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 50).map(
        ([key, item]) => [key, redactValues(item, depth + 1)],
      ),
    );
  }
  return REDACTED;
}

function redactHeaders(headers: Headers): Headers {
  return new Headers([...headers].map(([key]) => [key, REDACTED]));
}

/** Dynamic diagnostic prose can repeat values even when `actual` is removed. */
export function redactDiagnostic(d: Diagnostic): Diagnostic {
  const location = d.requestPath.split(/[.\[]/, 1)[0] ?? "";
  return {
    code: d.code,
    severity: d.severity,
    category: d.category,
    requestPath:
      ["body", "query", "header", "cookie", "path"].includes(location)
        ? location
        : "",
    // Routing diagnostics historically put a raw HTTP path here. Only retain
    // schema-fragment pointers; those are produced from the selected spec.
    specPointer: d.code === "E2001" || d.code === "E2002"
      ? ""
      : d.specPointer === "#" || d.specPointer.startsWith("#/")
      ? d.specPointer
      : "",
    message: getCode(d.code).title,
    expected: d.expected === undefined ? undefined : REDACTED,
    actual: d.actual === undefined ? undefined : REDACTED,
    attribution: { confidence: d.attribution.confidence, reasoning: [] },
    suggestion: `Run steady explain ${d.code}`,
  };
}

export function redactRequest(event: RequestEvent): RequestEvent {
  return {
    ...event,
    request: {
      ...event.request,
      path: event.request.pathPattern,
      query: event.request.query ? REDACTED : "",
      headers: redactHeaders(event.request.headers),
      body: event.request.body === undefined ? undefined : REDACTED,
    },
    response: {
      ...event.response,
      headers: redactHeaders(event.response.headers),
      body: event.response.body === undefined ? undefined : REDACTED,
    },
    diagnostics: event.diagnostics.map(redactDiagnostic),
  };
}

export function redactShutdown(event: ShutdownEvent): ShutdownEvent {
  return {
    ...event,
    topIssues: event.topIssues.map((issue) => ({
      ...issue,
      message: hasCode(issue.code) ? getCode(issue.code).title : REDACTED,
      attribution: { confidence: issue.attribution.confidence, reasoning: [] },
    })),
  };
}
