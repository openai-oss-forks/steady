import type { ServerConfig } from "../types.ts";
import type { Logger } from "../logging/logger.ts";
import type {
  RequestEvent,
  ShutdownEvent,
  StartupEvent,
} from "../logging/types.ts";
import type { Diagnostic } from "../diagnostic.ts";
import type { DiagnosticCollector } from "../diagnostics/collector.ts";
import type { SessionStore } from "../session/store.ts";
import type { PipelineTimer } from "../timing.ts";
import type { HttpMethod } from "../types.ts";
import type { PathItemObject } from "@steady/openapi";

/**
 * Log startup event
 */
export function logStartup(
  spec: {
    info: { title: string; version: string };
    paths: Record<string, PathItemObject>;
  },
  config: ServerConfig,
  logger: Logger,
  collector: DiagnosticCollector,
  sessionStore: SessionStore,
  getMethodsForPath: (pathItem: PathItemObject) => HttpMethod[],
  timer?: PipelineTimer,
): void {
  const startupDiags = config.startupDiagnostics ?? [];

  // Build full endpoint list and pass to collector
  const allEndpoints: string[] = [];
  for (const [pattern, pathItem] of Object.entries(spec.paths)) {
    for (const method of getMethodsForPath(pathItem)) {
      allEndpoints.push(`${method.toUpperCase()} ${pattern}`);
    }
  }
  collector.setAllEndpoints(allEndpoints);
  sessionStore.setAllEndpoints(allEndpoints);
  const endpointCount = allEndpoints.length;

  const timing = timer?.getResult();

  const event: StartupEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    type: "startup",
    spec: {
      title: spec.info.title,
      version: spec.info.version,
      endpointCount,
    },
    server: {
      url: `http://${config.host}:${config.port}`,
      rejectOnSdkError: config.rejectOnSdkError ?? true,
    },
    specPath: config.specPath,
    diagnostics: startupDiags,
    ...(timing ? { timing } : {}),
  };

  logger.startup(event);
}

/**
 * Log shutdown event with session summary
 */
export function logShutdown(
  logger: Logger,
  collector: DiagnosticCollector,
  startTime: Date,
  requestCount: number,
  failedCount: number,
): void {
  const duration = Date.now() - startTime.getTime();

  const topIssues = collector.getTopIssues().map((issue) => ({
    code: issue.code,
    path: issue.path,
    method: issue.method.toUpperCase(),
    message: issue.example.message,
    count: issue.count,
    category: issue.example.category,
    attribution: issue.example.attribution,
  }));

  const stats = collector.getStats();
  const validityRate = stats.requestCount > 0
    ? stats.successCount / stats.requestCount
    : 1;

  const event: ShutdownEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    type: "shutdown",
    session: {
      duration,
      requestCount,
      failedCount,
      validityRate,
      categoryBreakdown: collector.getCategoryBreakdown(),
    },
    topIssues,
    coverage: collector.getCoverage(),
    generationWarnings: collector.getGenerationWarnings(),
  };

  if (collector.getDroppedDiagnosticCount() > 0) {
    logger.warning("Runtime diagnostic retention limit reached", {
      dropped: collector.getDroppedDiagnosticCount(),
    });
  }
  logger.shutdown(event);
}

/**
 * Compute exit code based on session diagnostics and config flags.
 * 0 = clean, 1 = issues detected matching fail criteria.
 */
export function computeExitCode(
  failedCount: number,
  config: ServerConfig,
  collector: DiagnosticCollector,
): number {
  if (failedCount > 0) return 1;

  if (
    config.failOnAmbiguous &&
    collector.hasRuntimeAmbiguous()
  ) {
    return 1;
  }

  if (
    config.failOnWarnings &&
    collector.hasRuntimeWarnings()
  ) {
    return 1;
  }

  return 0;
}

/**
 * Build and log a RequestEvent
 */
export function logRequestEvent(
  config: ServerConfig,
  logger: Logger,
  args: {
    req: Request;
    path: string;
    pathPattern: string;
    method: string;
    status: number;
    statusText: string;
    timing: number;
    diagnostics: Diagnostic[];
    requestBody?: unknown;
    responseHeaders?: Headers;
    responseBody?: unknown;
    responseWarning?: string;
  },
): void {
  if (config.quiet) return;
  const url = new URL(args.req.url);

  const event: RequestEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    type: "request",
    request: {
      method: args.method.toUpperCase(),
      path: args.path,
      pathPattern: args.pathPattern,
      query: url.search,
      headers: args.req.headers,
      body: args.requestBody,
    },
    response: {
      status: args.status,
      statusText: args.statusText,
      timing: args.timing,
      headers: args.responseHeaders ?? new Headers(),
      body: args.responseBody,
      bodySize: args.responseBody !== undefined
        ? new TextEncoder().encode(JSON.stringify(args.responseBody)).length
        : undefined,
      responseWarning: args.responseWarning,
    },
    diagnostics: args.diagnostics,
  };

  logger.request(event);
}
