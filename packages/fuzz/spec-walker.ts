/**
 * Walk an OpenAPI spec and extract testable operations.
 *
 * Uses OpenAPISpec for $ref resolution and parameter merging.
 * Detects ambiguous path templates (e.g., /v1/{name} and /v1/{resourceName})
 * and filters out operations that would lose in router matching.
 */

import type { OpenAPISpec } from "@steady/openapi";
import { getMediaType } from "@steady/media-type";
import { buildBaseline } from "./request-builder.ts";
import type { OperationInfo, ParameterInfo } from "./types.ts";

/**
 * A function that matches a concrete path + method against path templates.
 * Returns the matched path pattern, or null if no match.
 */
export type PathMatcher = (
  path: string,
  method: string,
) => string | null;

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
  "trace",
] as const;

/**
 * Walk all operations in a spec and extract structured info for fuzzing.
 *
 * Filters out operations with ambiguous path templates. When two paths
 * like /v1/{name} and /v1/{resourceName} match the same URLs, the router
 * picks one. Operations on the "losing" path would produce false positives
 * because mutations target one schema but validation runs against another.
 *
 * @param doc - A parsed OpenAPISpec (handles $ref resolution)
 * @returns One OperationInfo per operation in the spec
 */
export function walkSpec(
  doc: OpenAPISpec,
  pathMatcher?: PathMatcher,
): OperationInfo[] {
  const operations: OperationInfo[] = [];
  const paths = doc.paths;

  for (const pathPattern of Object.keys(paths)) {
    // Skip paths with URI fragments (#). These appear in AWS and Box specs
    // as an RPC disambiguation hack (e.g. /#X-Amz-Target=Kinesis.CreateStream).
    // Fragments are stripped by HTTP clients before sending, so these paths
    // cannot be matched or tested over the wire.
    if (pathPattern.includes("#")) continue;

    // Skip paths with templated query values (e.g., /search?query={query}).
    // OpenAPI path templates only support {param} in the path portion.
    // Query parameters belong in the parameters array with in: query.
    // These malformed paths cause routing/validation mismatches.
    const queryIdx = pathPattern.indexOf("?");
    if (queryIdx >= 0 && pathPattern.slice(queryIdx).includes("{")) continue;

    const pathItem = paths[pathPattern];
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const params = doc.getParameters(pathPattern, method);

      const pathParams: ParameterInfo[] = [];
      const queryParams: ParameterInfo[] = [];
      const headerParams: ParameterInfo[] = [];

      for (const p of params) {
        const info: ParameterInfo = {
          name: p.name,
          in: p.in,
          required: p.required,
          schema: p.schema,
        };

        switch (p.in) {
          case "path":
            pathParams.push(info);
            break;
          case "query":
            queryParams.push(info);
            break;
          case "header":
            headerParams.push(info);
            break;
          case "cookie":
            // rarely used in practice; skip for now
            break;
        }
      }

      const contentTypes = doc.getAcceptedContentTypes(pathPattern, method);
      // The fuzzer generates JSON bodies, so always look up the JSON schema.
      const bodySchema = doc.getBodySchema(
        pathPattern,
        method,
        "application/json",
      );

      const bodyInfo = bodySchema
        ? {
          schema: bodySchema.schema,
          required: bodySchema.required,
          contentTypes: (contentTypes ?? []).flatMap((ct) => {
            const e = getMediaType(ct);
            return e ? [e] : [];
          }),
        }
        : null;

      // Extract routing query params from the path pattern's query string
      let routingQueryParams: Set<string> | undefined;
      if (queryIdx >= 0) {
        const pathQuery = new URLSearchParams(pathPattern.slice(queryIdx + 1));
        routingQueryParams = new Set(pathQuery.keys());
      }

      operations.push({
        path: pathPattern,
        method,
        pathParams,
        queryParams,
        headerParams,
        bodyInfo,
        routingQueryParams,
      });
    }
  }

  if (!pathMatcher) return operations;
  return filterAmbiguousOperations(operations, pathMatcher);
}

/**
 * Filter out operations whose concrete URL would route to a different
 * path template. This happens when specs have ambiguous paths like
 * /v1/{name} and /v1/{resourceName} with overlapping methods.
 */
function filterAmbiguousOperations(
  operations: OperationInfo[],
  pathMatcher: PathMatcher,
): OperationInfo[] {
  // Only build a router if there are parameterized paths that could conflict
  const paramPaths = operations.filter((op) => op.path.includes("{"));
  if (paramPaths.length === 0) return operations;

  return operations.filter((op) => {
    // Non-parameterized paths can't be ambiguous
    if (!op.path.includes("{")) return true;

    // Build a concrete URL and check which path the router matches
    const baseline = buildBaseline(op);
    const matchedPattern = pathMatcher(baseline.path, op.method);

    if (!matchedPattern) return true;

    // Strip query disambiguation from both patterns for comparison
    const expectedBase = op.path.split("?")[0];
    const matchedBase = matchedPattern.split("?")[0];

    if (matchedBase !== expectedBase) {
      // Router would match a different path template. Skip this operation.
      return false;
    }

    return true;
  });
}
