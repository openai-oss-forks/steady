/**
 * Server Error Types - Rich error context with SDK vs Spec attribution
 *
 * Error attribution helps developers quickly identify whether an issue is:
 * - SDK Bug: The generated SDK is sending invalid requests
 * - Spec Issue: The OpenAPI specification has problems
 * - Server Error: Internal mock server issue
 */

import { ErrorContext, SteadyError } from "@steady/openapi";

/** Source of the error - helps with debugging */
export type ErrorSource = "sdk" | "spec" | "server" | "unknown";

/**
 * Response generation error - usually a spec issue (missing examples)
 */
export class GenerationError extends SteadyError {
  readonly source: ErrorSource = "spec";

  constructor(message: string, context: ErrorContext) {
    super(message, { ...context, errorType: "generate" });
    this.name = "GenerationError";
  }
}
