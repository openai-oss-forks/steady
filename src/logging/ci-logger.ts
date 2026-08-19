/**
 * CILogger - GitHub Actions annotation output.
 *
 * Minimal per-request output (only requests with diagnostics).
 * Uses ::error::, ::warning::, and ::notice:: annotations for GitHub Actions.
 * All lines prefixed with STEADY: for easy filtering.
 * Summary-first shutdown with pass/fail verdict.
 */

import { BaseLogger } from "./logger.ts";
import type {
  LoggerOptions,
  RequestEvent,
  ShutdownEvent,
  StartupEvent,
} from "./types.ts";

export class CILogger extends BaseLogger {
  constructor(options: Partial<LoggerOptions> = {}) {
    super({ ...options, color: false });
  }

  protected writeRequest(event: RequestEvent): void {
    // Only log requests that have diagnostics
    if (event.diagnostics.length === 0) return;

    const method = event.request.method;
    const path = event.request.path;
    const status = event.response.status;

    console.log(
      `STEADY: ${method} ${path} -> ${status} (${event.diagnostics.length} diagnostics)`,
    );

    for (const d of event.diagnostics) {
      const level = d.severity === "error"
        ? "error"
        : d.severity === "info"
        ? "notice"
        : "warning";
      // GitHub Actions annotation format
      console.log(
        `::${level}::STEADY ${d.code} [${d.category}] ${d.requestPath}: ${d.message}`,
      );
    }
  }

  startup(event: StartupEvent): void {
    const timingSuffix = event.timing
      ? ` in ${Math.round(event.timing.total)}ms`
      : "";
    console.log(
      `STEADY: Loaded ${event.spec.title} v${event.spec.version} (${event.spec.endpointCount} endpoints)${timingSuffix}`,
    );
    console.log(`STEADY: Server listening at ${event.server.url}`);

    if (event.diagnostics.length > 0) {
      console.log(
        `STEADY: ${event.diagnostics.length} spec diagnostics at startup`,
      );
      for (const d of event.diagnostics) {
        const level = d.severity === "error"
          ? "error"
          : d.severity === "info"
          ? "notice"
          : "warning";
        console.log(`::${level}::STEADY ${d.code}: ${d.message}`);
      }
    }
  }

  protected writeShutdown(event: ShutdownEvent): void {
    const { session, topIssues, coverage } = event;
    const passed = session.failedCount === 0;
    const verdict = passed ? "PASSED" : "FAILED";

    console.log("");
    console.log(`STEADY: ${verdict}`);
    console.log(
      `STEADY: ${session.requestCount} requests, ${session.failedCount} failed, validity ${
        (session.validityRate * 100).toFixed(0)
      }%`,
    );

    if (coverage) {
      console.log(
        `STEADY: Coverage ${coverage.tested}/${coverage.total} endpoints`,
      );
    }

    if (
      event.generationWarnings && event.generationWarnings.length > 0
    ) {
      const unique = [...new Set(event.generationWarnings)];
      console.log(
        `STEADY: ${unique.length} endpoint${
          unique.length === 1 ? "" : "s"
        } returned minimal responses`,
      );
    }

    if (topIssues.length > 0) {
      console.log(`STEADY: Top issues:`);
      for (const issue of topIssues) {
        const level = issue.category === "sdk-issue" ? "error" : "warning";
        console.log(
          `::${level}::STEADY ${issue.code} [${issue.category}] ${issue.method} ${issue.path}: ${issue.message} (x${issue.count})`,
        );
      }
    }
  }

  protected writeWarning(
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const ctx = context ? ` (${JSON.stringify(context)})` : "";
    console.log(`::warning::STEADY: ${message}${ctx}`);
  }

  protected writeError(
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const ctx = context ? ` (${JSON.stringify(context)})` : "";
    console.log(`::error::STEADY: ${message}${ctx}`);
  }
}
