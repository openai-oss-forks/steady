import { observeResponse } from "./outcome.ts";
import { getCode } from "../codes/registry.ts";
import {
  DEFAULT_MAX_BODY_BYTES,
  loopbackHost,
  RequestLimitError,
  validateBodyLimit,
} from "./limits.ts";
import { GenerationLimitError } from "@steady/json-schema";
/**
 * Steady Mock Server
 *
 * Features:
 * - Document-centric architecture for proper $ref resolution
 * - Pre-compiled path patterns for O(1) route matching
 * - Lazy schema processing with caching
 * - Graceful shutdown handling
 * - Text and JSON logging modes
 */

import type { ServerConfig } from "../types.ts";
import type { PipelineTimer } from "../timing.ts";
import {
  HEADERS,
  isHttpMethod,
  isValidArrayFormat,
  isValidFormArrayFormat,
  isValidFormObjectFormat,
  isValidObjectFormat,
  VERSION,
} from "../types.ts";
import { isReference } from "@steady/openapi";
import type { OpenAPIRaw } from "@steady/openapi";
import { GenerationError } from "../errors.ts";
import { SchemaRegistry } from "@steady/json-schema";
import type { DocIndex } from "@steady/json-schema";
import type { Logger } from "../logging/logger.ts";
import { TextLogger } from "../logging/text-logger.ts";
import { JsonLogger } from "../logging/json-logger.ts";
import { CILogger } from "../logging/ci-logger.ts";
import { getStatusText } from "../logging/colors.ts";
import { isParseError, parseRequestBody } from "../body-parser.ts";
import type { FormParserOptions } from "../form-parser.ts";
import { OpenAPISpec } from "@steady/openapi";
import { isSchema, TreeValidator } from "@steady/json-schema";
import { getMediaType, isFormMediaType } from "../media-type.ts";
import {
  type AnalyzeRequest,
  DiagnosticEngine,
} from "../engine/diagnostic-engine.ts";
import type { Diagnostic } from "../diagnostic.ts";
import { SessionStore } from "../session/store.ts";
import { handleSessionRequest } from "../session/endpoints.ts";
import { DiagnosticCollector } from "../diagnostics/collector.ts";

import { getMethodsForPath, Router } from "../router.ts";
import {
  addDiagnosticHeaders,
  generateResponseFromObject,
} from "./response-generator.ts";
import {
  getEffectiveGeneratorOptions,
  getEffectiveStreamingOptions,
  getRejectOnSdkError,
} from "./options.ts";
import {
  computeExitCode,
  logRequestEvent,
  logShutdown,
  logStartup,
} from "./lifecycle.ts";

export class MockServer {
  /** Structured spec access with universal $ref resolution */
  private specDoc: OpenAPISpec;
  private abortController: AbortController;
  private logger: Logger;
  private diagnosticEngine: DiagnosticEngine;
  private collector: DiagnosticCollector;
  private sessionStore: SessionStore;
  private signalListeners: Array<
    { signal: Deno.Signal; listener: () => void }
  > = [];
  private serverFinished: Promise<void> | null = null;
  private startTime: Date = new Date();
  private requestCount = 0;
  private failedCount = 0;

  // Unified router: pre-compiled routes with query disambiguation
  private router: Router;

  constructor(
    spec: OpenAPIRaw,
    private config: ServerConfig,
    docIndex?: DocIndex,
    private timer?: PipelineTimer,
  ) {
    if (!config.socketPath) config.host = loopbackHost(config.host);
    validateBodyLimit(config.maxRequestBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    // Build schema registry (indexes all schemas for O(1) $ref resolution)
    timer?.start("document");
    const registry = docIndex
      ? new SchemaRegistry(spec, docIndex)
      : SchemaRegistry.fromSpec(spec);
    timer?.stop("document");

    // Single document facade: all $ref resolution flows through here
    timer?.start("diagnostics-engine");
    this.specDoc = new OpenAPISpec(registry);
    this.router = new Router(spec.paths);
    const treeValidator = new TreeValidator({ registry, direction: "request" });
    this.diagnosticEngine = new DiagnosticEngine(
      this.specDoc,
      treeValidator,
      this.router,
    );
    timer?.stop("diagnostics-engine");

    this.abortController = new AbortController();
    this.sessionStore = new SessionStore();

    // Create logger based on format
    if (config.logFormat === "ci") {
      this.logger = new CILogger({
        level: config.logLevel,
        logBodies: config.logBodies,
      });
    } else if (config.logFormat === "json") {
      this.logger = new JsonLogger({
        level: config.logLevel,
        logBodies: config.logBodies,
      });
    } else {
      this.logger = new TextLogger({
        level: config.logLevel,
        color: config.color ?? true,
        logBodies: config.logBodies,
      });
    }

    // Diagnostic collector for session-level aggregation
    this.collector = new DiagnosticCollector();
    this.collector.setStaticDiagnostics(config.startupDiagnostics ?? []);

    // Note: route compilation happens in Router constructor above
  }

  /** The port the server is actually listening on (set after start()). */
  get port(): number {
    return this._port;
  }
  private _port = 0;

  start(): Promise<number> {
    this.startTime = new Date();

    const { promise: listening, resolve: onReady } = Promise.withResolvers<
      number
    >();

    const handler = (req: Request) => this.handleRequest(req);

    const onListen = (port: number) => {
      this._port = port;
      logStartup(
        this.specDoc.rawSpec,
        this.config,
        this.logger,
        this.collector,
        this.sessionStore,
        getMethodsForPath,
        this.timer,
      );
      onReady(port);
    };

    const serveOptions = this.config.socketPath
      ? {
        path: this.config.socketPath,
        signal: this.abortController.signal,
        onListen: () => onListen(0),
      }
      : {
        port: this.config.port,
        hostname: this.config.host,
        signal: this.abortController.signal,
        onListen: ({ port }: { port: number }) => onListen(port),
      };

    const server = Deno.serve(serveOptions, handler);

    // Store the finished promise for proper shutdown
    this.serverFinished = server.finished;

    // Handle graceful shutdown
    const handleShutdownSignal = () => {
      logShutdown(
        this.logger,
        this.collector,
        this.startTime,
        this.requestCount,
        this.failedCount,
      );
      this.stop();
      Deno.exit(computeExitCode(this.failedCount, this.config, this.collector));
    };
    // Handle common shutdown signals
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"] as const) {
      try {
        Deno.addSignalListener(signal, handleShutdownSignal);
        this.signalListeners.push({ signal, listener: handleShutdownSignal });
      } catch {
        // Signal not supported on this platform
      }
    }

    return listening;
  }

  /**
   * Stop the server and wait for it to fully shut down.
   * Returns a Promise that resolves when the server has stopped.
   */
  async stop(): Promise<void> {
    for (const { signal, listener } of this.signalListeners) {
      Deno.removeSignalListener(signal, listener);
    }
    this.signalListeners = [];
    this.abortController.abort();
    // Wait for the server to fully stop
    if (this.serverFinished) {
      await this.serverFinished;
    }
  }

  private async handleRequest(req: Request): Promise<Response> {
    const startTime = performance.now();
    const url = new URL(req.url);
    const rawMethod = req.method.toLowerCase();
    const path = url.pathname;

    // Handle special endpoints (no logging for these)
    if (path === "/_x-steady/health") {
      return this.handleHealth();
    }

    if (path === "/_x-steady/spec") {
      return this.handleSpec();
    }

    if (path === "/_x-steady/redirected") {
      return new Response(
        JSON.stringify({ status: "redirected" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (path.startsWith("/_x-steady/sessions/") && rawMethod === "get") {
      const sessionId = path.slice("/_x-steady/sessions/".length);
      return handleSessionRequest(sessionId, this.sessionStore);
    }

    // Validate HTTP method before any processing
    if (!isHttpMethod(rawMethod)) {
      return new Response(`Method ${req.method} is not supported`, {
        status: 405,
        headers: { "Content-Type": "text/plain" },
      });
    }
    const method = rawMethod;

    // Check if request should reject on SDK errors
    const rejectOnSdkError = getRejectOnSdkError(req, this.config);

    // Route matching (unified router handles query disambiguation + diagnostics)
    const routeResult = this.router.match({
      path,
      method,
      queryParams: url.searchParams,
    });

    if (!routeResult.matched) {
      // Route not found or method not allowed
      const timing = Math.round(performance.now() - startTime);
      this.requestCount++;
      this.failedCount++;

      const routeDiags = routeResult.diagnostics;

      // Collect runtime diagnostics
      this.collector.addRuntimeDiagnostics(
        routeDiags,
        method,
        "[unmatched route]",
        false,
      );

      // Track session if X-Steady-Session header present
      const sessionId = req.headers.get("X-Steady-Session");
      if (sessionId) {
        this.sessionStore.addRequest(
          sessionId,
          method,
          "[unmatched route]",
          routeDiags,
        );
      }

      // E2002 (method not allowed) -> 405, E2001 (path not found) -> 404
      const isMethodNotAllowed = routeDiags.some((d) => d.code === "E2002");
      const status = isMethodNotAllowed ? 405 : 404;
      const statusText = isMethodNotAllowed
        ? "Method Not Allowed"
        : "Not Found";

      logRequestEvent(this.config, this.logger, {
        req,
        path,
        pathPattern: "[unmatched route]",
        method,
        status,
        statusText,
        timing,
        diagnostics: routeDiags,
      });

      const firstDiag = routeDiags[0];
      const errorResponse = new Response(
        JSON.stringify({
          error: firstDiag?.message ?? "Route not found",
          suggestion: firstDiag?.suggestion,
        }),
        {
          status,
          headers: { "Content-Type": "application/json" },
        },
      );
      return addDiagnosticHeaders(errorResponse, routeDiags);
    }

    const {
      operation,
      statusCode,
      pathPattern,
      pathParams,
      consumedQueryParams,
    } = routeResult;

    let allDiagnostics: Diagnostic[] = [];
    let outcomeSucceeded = false;
    let httpFailed = false;
    let deferredOutcome = false;
    let recorded = false;
    const runtimeFailure = (error: unknown): Diagnostic => {
      const limited = error instanceof RequestLimitError ||
        error instanceof GenerationLimitError;
      const code = limited ? "E3024" : "E1023";
      const definition = getCode(code);
      return {
        code,
        severity: definition.severity,
        category: error instanceof GenerationLimitError
          ? "spec-issue"
          : definition.category,
        requestPath: "",
        specPointer: "",
        message: definition.title,
        attribution: { confidence: 1, reasoning: [] },
        suggestion: `Run steady explain ${code}`,
      };
    };
    const recordOutcome = () => {
      if (recorded) return;
      recorded = true;
      this.requestCount++;
      if (httpFailed) this.failedCount++;
      const success = outcomeSucceeded &&
        !allDiagnostics.some((d) => d.category === "sdk-issue");
      const sessionId = req.headers.get("X-Steady-Session");
      if (sessionId) {
        this.sessionStore.addRequest(
          sessionId,
          method,
          path,
          allDiagnostics,
          pathPattern,
          success,
        );
      }
      this.collector.addRuntimeDiagnostics(
        allDiagnostics,
        method,
        pathPattern,
        success,
      );
    };
    try {
      // Build form parsing options only for form content types
      const rawContentType = req.headers.get("content-type");
      const essence = rawContentType ? getMediaType(rawContentType) : null;
      let formOptions: FormParserOptions | undefined;

      if (essence && isFormMediaType(essence)) {
        // Merge form format: per-request header > config
        const headerFormArrayFmt = req.headers.get(HEADERS.FORM_ARRAY_FORMAT);
        const headerFormObjectFmt = req.headers.get(HEADERS.FORM_OBJECT_FORMAT);

        const configFormArrayFmt = this.config.validator?.formArrayFormat ??
          null;
        const configFormObjectFmt = this.config.validator?.formObjectFormat ??
          null;
        const formArrayFormat = isValidFormArrayFormat(headerFormArrayFmt)
          ? headerFormArrayFmt
          : isValidFormArrayFormat(configFormArrayFmt)
          ? configFormArrayFmt
          : undefined;
        const formObjectFormat = isValidFormObjectFormat(headerFormObjectFmt)
          ? headerFormObjectFmt
          : isValidFormObjectFormat(configFormObjectFmt)
          ? configFormObjectFmt
          : undefined;

        // Resolve body schema for type coercion
        const bodyInfo = this.specDoc.getBodySchema(
          pathPattern,
          method,
          essence,
        );

        formOptions = {
          formArrayFormat,
          formObjectFormat,
          schema: bodyInfo?.schema,
          partContentTypes: bodyInfo?.partContentTypes,
          resolveSchema: (schema) => {
            if (isReference(schema)) {
              const resolved = this.specDoc.resolveRef(schema.$ref);
              if (isSchema(resolved)) return resolved;
              return undefined;
            }
            return schema;
          },
        };
      }

      // Parse request body
      const parseResult = await parseRequestBody(
        req,
        null,
        formOptions,
        this.config.maxRequestBodyBytes,
      );
      let parseDiags: Diagnostic[] = [];
      let body: unknown;
      let rawFormKeys: string[] | undefined;
      if (isParseError(parseResult)) {
        parseDiags = parseResult.diagnostics;
        body = undefined;
      } else {
        body = parseResult.body;
        rawFormKeys = parseResult.rawFormKeys;
      }

      // Track request count and endpoint coverage
      this.collector.trackEndpoint(method, pathPattern);

      // Run diagnostics engine
      const engineDiags = this.runDiagnosticEngine(
        path,
        method,
        url.searchParams,
        req.headers,
        body,
        pathParams,
        consumedQueryParams,
        rawFormKeys,
        formOptions,
      );

      allDiagnostics = [...parseDiags, ...engineDiags];

      const hasSdkIssues = allDiagnostics.some((d) =>
        d.category === "sdk-issue"
      );

      // If --reject-on-sdk-error is active and diagnostics found SDK issues, return 400
      if (hasSdkIssues && rejectOnSdkError) {
        httpFailed = true;
        const timing = Math.round(performance.now() - startTime);

        logRequestEvent(this.config, this.logger, {
          req,
          path,
          pathPattern,
          method,
          status: 400,
          statusText: "Bad Request",
          timing,
          diagnostics: allDiagnostics,
          requestBody: body,
        });

        const errorResponse = new Response(
          JSON.stringify({
            error: "Validation failed",
            steady: {
              valid: false,
              errors: allDiagnostics.map((d) => ({
                code: d.code,
                severity: d.severity,
                category: d.category,
                path: d.requestPath,
                message: d.message,
                expected: d.expected,
                actual: d.actual,
                attribution: d.attribution,
                suggestion: d.suggestion,
              })),
            },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
        return addDiagnosticHeaders(errorResponse, allDiagnostics);
      }

      const generatorOptions = getEffectiveGeneratorOptions(req, this.config);
      const streamingOptions = getEffectiveStreamingOptions(req, this.config);
      streamingOptions.generatorOptions = generatorOptions;

      const responseObj = this.specDoc.getResponseObject(
        pathPattern,
        method,
        statusCode,
      );
      if (!responseObj) {
        throw new GenerationError("Response not defined", {
          httpPath: path,
          httpMethod: method.toUpperCase(),
          errorType: "generate",
          reason: `No response defined for status code ${statusCode}`,
          suggestion: `Available response codes: ${
            Object.keys(operation.responses).join(", ")
          }`,
        });
      }

      const { response, body: responseBody, minimal, nullBodyStripped } =
        generateResponseFromObject(
          this.specDoc,
          this.logger,
          this.collector,
          req.headers.get("Accept"),
          responseObj,
          statusCode,
          path,
          method,
          pathPattern,
          generatorOptions,
          streamingOptions,
        );

      // Add response warning header for minimal responses
      if (minimal) {
        response.headers.set("X-Steady-Response-Warning", "minimal");
      }

      const timing = Math.round(performance.now() - startTime);
      const status = parseInt(statusCode, 10);

      // Track failed responses
      httpFailed = status >= 400;
      outcomeSucceeded = true;

      const responseWarning = nullBodyStripped
        ? "null-body-stripped"
        : minimal
        ? "minimal"
        : undefined;

      logRequestEvent(this.config, this.logger, {
        req,
        path,
        pathPattern,
        method,
        status,
        statusText: response.statusText || getStatusText(status),
        timing,
        diagnostics: allDiagnostics,
        requestBody: body,
        responseHeaders: response.headers,
        responseBody,
        responseWarning,
      });

      const finalResponse = addDiagnosticHeaders(response, allDiagnostics);
      if (
        finalResponse.headers.get(HEADERS.STREAMING) === "true" &&
        finalResponse.body
      ) {
        deferredOutcome = true;
        return observeResponse(finalResponse, recordOutcome, (error) => {
          outcomeSucceeded = false;
          httpFailed = true;
          allDiagnostics = [...allDiagnostics, runtimeFailure(error)];
          this.logger.error("Response stream failed");
          recordOutcome();
        });
      }
      return finalResponse;
    } catch (error) {
      outcomeSucceeded = false;
      if (
        error instanceof RequestLimitError ||
        error instanceof GenerationLimitError
      ) {
        const status = error instanceof RequestLimitError ? error.status : 400;
        httpFailed = true;
        allDiagnostics = [...allDiagnostics, runtimeFailure(error)];
        logRequestEvent(this.config, this.logger, {
          req,
          path,
          pathPattern,
          method,
          status,
          statusText: getStatusText(status),
          timing: Math.round(performance.now() - startTime),
          diagnostics: allDiagnostics,
        });
        return addDiagnosticHeaders(
          Response.json({ error: error.message }, { status }),
          allDiagnostics,
        );
      }
      const timing = Math.round(performance.now() - startTime);
      httpFailed = true;
      allDiagnostics = [...allDiagnostics, runtimeFailure(error)];

      // 500 - internal error
      logRequestEvent(this.config, this.logger, {
        req,
        path,
        pathPattern: "[unmatched route]",
        method,
        status: 500,
        statusText: "Internal Server Error",
        timing,
        diagnostics: [],
      });
      this.logger.error("Internal server error");

      const serverError = new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
      return addDiagnosticHeaders(serverError, allDiagnostics);
    } finally {
      if (!deferredOutcome) recordOutcome();
    }
  }

  private handleHealth(): Response {
    const stats = this.specDoc.registry.getStats();
    return new Response(
      JSON.stringify({
        status: "healthy",
        version: VERSION,
        spec: {
          title: this.specDoc.rawSpec.info.title,
          version: this.specDoc.rawSpec.info.version,
        },
        schemas: {
          totalRefs: stats.totalRefs,
          cached: stats.cachedSchemas,
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  private handleSpec(): Response {
    return new Response(
      JSON.stringify(this.specDoc.rawSpec, null, 2),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  /**
   * Run the diagnostics engine on a request.
   * Returns engine diagnostics without affecting the existing validation flow.
   */
  private runDiagnosticEngine(
    path: string,
    method: string,
    queryParams: URLSearchParams,
    reqHeaders: Headers,
    body: unknown,
    pathParams?: Record<string, string>,
    consumedQueryParams?: string[],
    rawFormKeys?: string[],
    formOptions?: FormParserOptions,
  ): Diagnostic[] {
    const headers: Record<string, string> = {};
    reqHeaders.forEach((value, key) => {
      headers[key] = value;
    });

    // Merge query format: per-request header > config > "auto"
    const headerArrayFmt = reqHeaders.get(HEADERS.QUERY_ARRAY_FORMAT);
    const headerObjectFmt = reqHeaders.get(HEADERS.QUERY_OBJECT_FORMAT);

    const queryArrayFormat = isValidArrayFormat(headerArrayFmt)
      ? headerArrayFmt
      : this.config.validator?.queryArrayFormat;
    const queryObjectFormat = isValidObjectFormat(headerObjectFmt)
      ? headerObjectFmt
      : this.config.validator?.queryObjectFormat;

    const request: AnalyzeRequest = {
      path,
      method,
      queryParams,
      headers,
      pathParams,
      body,
      queryArrayFormat,
      queryObjectFormat,
      consumedQueryParams,
      formArrayFormat: formOptions?.formArrayFormat,
      formObjectFormat: formOptions?.formObjectFormat,
      rawFormKeys,
    };

    return this.diagnosticEngine.analyze(request);
  }
}
