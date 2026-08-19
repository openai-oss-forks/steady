/**
 * JsonLogger - NDJSON output for CI and machine parsing.
 *
 * Outputs Diagnostic objects directly. No transformation or
 * reformatting; the Diagnostic type is already the right shape.
 */

import { BaseLogger } from "./logger.ts";
import type {
  LoggerOptions,
  RequestEvent,
  ShutdownEvent,
  StartupEvent,
} from "./types.ts";

export class JsonLogger extends BaseLogger {
  constructor(options: Partial<LoggerOptions> = {}) {
    super({ ...options, color: false });
  }

  /** Convert Headers to a plain object for JSON serialization. */
  private headersToObject(headers: Headers): Record<string, string> {
    const obj: Record<string, string> = {};
    headers.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  protected writeRequest(event: RequestEvent): void {
    const output: Record<string, unknown> = {
      type: "request",
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      request: {
        method: event.request.method,
        path: event.request.path,
        pathPattern: event.request.pathPattern,
        query: event.request.query || undefined,
        ...(this.showDetails()
          ? { headers: this.headersToObject(event.request.headers) }
          : {}),
        ...(this.shouldShowBodies() && event.request.body !== undefined
          ? { body: event.request.body }
          : {}),
      },
      response: {
        status: event.response.status,
        statusText: event.response.statusText,
        timing: event.response.timing,
        ...(this.showDetails()
          ? { headers: this.headersToObject(event.response.headers) }
          : {}),
        ...(this.shouldShowBodies() && event.response.body !== undefined
          ? { body: event.response.body }
          : {}),
        ...(event.response.responseWarning
          ? { responseWarning: event.response.responseWarning }
          : {}),
      },
      diagnostics: event.diagnostics.map((d) => ({
        code: d.code,
        severity: d.severity,
        category: d.category,
        requestPath: d.requestPath,
        specPointer: d.specPointer,
        message: d.message,
        expected: d.expected,
        actual: d.actual,
        attribution: {
          confidence: d.attribution.confidence,
          reasoning: d.attribution.reasoning,
        },
        suggestion: d.suggestion,
      })),
    };

    console.log(JSON.stringify(output));
  }

  startup(event: StartupEvent): void {
    const output: Record<string, unknown> = {
      type: "startup",
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      spec: event.spec,
      server: event.server,
      diagnostics: event.diagnostics.map((d) => ({
        severity: d.severity,
        code: d.code,
        category: d.category,
        requestPath: d.requestPath,
        specPointer: d.specPointer,
        message: d.message,
        attribution: {
          confidence: d.attribution.confidence,
          reasoning: d.attribution.reasoning,
        },
        suggestion: d.suggestion,
      })),
    };

    if (event.timing) {
      output.timing = event.timing;
    }

    console.log(JSON.stringify(output));
  }

  protected writeShutdown(event: ShutdownEvent): void {
    const output: Record<string, unknown> = {
      type: "shutdown",
      id: event.id,
      timestamp: event.timestamp.toISOString(),
      session: event.session,
      topIssues: event.topIssues.map((i) => ({
        code: i.code,
        method: i.method,
        path: i.path,
        message: i.message,
        count: i.count,
        category: i.category,
        attribution: {
          confidence: i.attribution.confidence,
          reasoning: i.attribution.reasoning,
        },
      })),
    };

    if (event.coverage) {
      output.coverage = event.coverage;
    }

    if (
      event.generationWarnings && event.generationWarnings.length > 0
    ) {
      output.generationWarnings = event.generationWarnings;
    }

    console.log(JSON.stringify(output));
  }

  protected writeWarning(
    message: string,
    context?: Record<string, unknown>,
  ): void {
    console.log(JSON.stringify({
      type: "warning",
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message,
      context,
    }));
  }

  protected writeError(
    message: string,
    context?: Record<string, unknown>,
  ): void {
    console.log(JSON.stringify({
      type: "error",
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message,
      context,
    }));
  }
}
