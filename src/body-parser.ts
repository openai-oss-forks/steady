import {
  DEFAULT_MAX_BODY_BYTES,
  readLimitedBody,
  RequestLimitError,
} from "./server/limits.ts";
/**
 * Body Parser - Extract and parse HTTP request bodies.
 *
 * Handles HTTP-level concerns that happen before schema validation:
 * - Content-Length validation
 * - JSON parsing
 * - Form data parsing (multipart, URL-encoded)
 *
 * Returns either a parsed body or Diagnostic[] on failure.
 */

import type { Diagnostic } from "./diagnostic.ts";
import { getCode } from "./codes/registry.ts";
import {
  type FormParserOptions,
  parseFormData,
  parseUrlEncoded,
} from "./form-parser.ts";
import {
  getMediaType,
  isFormMediaType,
  isJsonMediaType,
  isMultipartFormData,
} from "./media-type.ts";
import type { MultipartFormData, UrlEncoded } from "./media-type.ts";

export interface BodyParseResult {
  body: unknown;
  contentType: string;
  /** Raw form entry key names (with duplicates) for format mismatch detection. */
  rawFormKeys?: string[];
}

export interface BodyParseError {
  diagnostics: Diagnostic[];
}

export type ParseResult = BodyParseResult | BodyParseError;

export function isParseError(r: ParseResult): r is BodyParseError {
  return "diagnostics" in r;
}

/**
 * Parse the request body, returning either the parsed body or diagnostics.
 *
 * @param req - The incoming Request
 * @param _acceptedContentTypes - Content types the operation accepts, or null to skip content-type checking
 * @param formOptions - Options for form data parsing (format, schema for coercion)
 */
export async function parseRequestBody(
  req: Request,
  _acceptedContentTypes: string[] | null,
  formOptions?: FormParserOptions,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<ParseResult> {
  // No Content-Type means no body to parse. Deno's HTTP server may set
  // req.body to an empty ReadableStream even for bodyless requests, so we
  // cannot rely on !req.body alone.
  if (!req.headers.get("content-type")) {
    return { body: undefined, contentType: "" };
  }

  // Check Content-Length header validity
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (isNaN(size) || size < 0) {
      const def = getCode("E3019");
      return {
        diagnostics: [{
          code: "E3019",
          severity: def.severity,
          category: def.category,
          requestPath: "body",
          specPointer: "",
          message:
            `Invalid Content-Length header: "${contentLength}" is not a valid non-negative integer`,
          expected: "valid non-negative integer",
          actual: contentLength,
          attribution: {
            confidence: 0.95,
            reasoning: [
              "Content-Length must be a non-negative integer per HTTP/1.1 (RFC 9110)",
            ],
          },
          suggestion:
            "Ensure the HTTP client sets a valid Content-Length header",
        }],
      };
    }
  }

  const contentTypeHeader = req.headers.get("content-type");
  const maybeMediaType = contentTypeHeader
    ? getMediaType(contentTypeHeader)
    : null;

  try {
    const buffered = new Response(await readLimitedBody(req, maxBodyBytes), {
      headers: req.headers,
    });
    let parsedBody: unknown;

    let rawFormKeys: string[] | undefined;

    if (maybeMediaType && isFormMediaType(maybeMediaType)) {
      const formResult = await parseFormBody(
        buffered,
        maybeMediaType,
        formOptions,
      );
      parsedBody = formResult.body;
      rawFormKeys = formResult.rawFormKeys;
    } else if (maybeMediaType && isJsonMediaType(maybeMediaType)) {
      const body = await readBody(buffered);
      if (body === "") {
        // Empty body with JSON content-type: treat as "no body provided."
        // SDKs commonly set Content-Type: application/json on all requests,
        // including DELETE/cancel endpoints that have no body.
        // The diagnostic engine will emit E3005 if the spec requires a body.
        return { body: undefined, contentType: "" };
      }
      parsedBody = JSON.parse(body);
    } else {
      // No content-type or non-JSON/non-form: read as raw string
      parsedBody = await readBody(buffered);
    }

    return { body: parsedBody, contentType: maybeMediaType ?? "", rawFormKeys };
  } catch (error) {
    if (error instanceof RequestLimitError) throw error;
    if (error instanceof SyntaxError) {
      const def = getCode("E3021");
      return {
        diagnostics: [{
          code: "E3021",
          severity: def.severity,
          category: def.category,
          requestPath: "body",
          specPointer: "",
          message: `Invalid ${maybeMediaType} format: ${error.message}`,
          expected: `valid ${maybeMediaType}`,
          attribution: {
            confidence: 0.95,
            reasoning: [
              `Request body could not be parsed as ${maybeMediaType}`,
            ],
          },
          suggestion:
            "Ensure the request body is well-formed JSON or matches the declared content type",
        }],
      };
    }

    const def = getCode("E3021");
    return {
      diagnostics: [{
        code: "E3021",
        severity: def.severity,
        category: def.category,
        requestPath: "body",
        specPointer: "",
        message: `Failed to read request body: ${
          error instanceof Error ? error.message : String(error)
        }`,
        expected: "readable request body",
        attribution: {
          confidence: 0.8,
          reasoning: [
            "Request body could not be read from the stream",
          ],
        },
        suggestion: "Check the request encoding and content type",
      }],
    };
  }
}

/**
 * Read request body as a string.
 */
async function readBody(req: Response): Promise<string> {
  return await req.text();
}

interface FormBodyResult {
  body: unknown;
  rawFormKeys: string[];
}

/**
 * Parse form data body (multipart/form-data or application/x-www-form-urlencoded).
 */
async function parseFormBody(
  req: Response,
  mediaType: MultipartFormData | UrlEncoded,
  options?: FormParserOptions,
): Promise<FormBodyResult> {
  const parserOptions: FormParserOptions = {
    formArrayFormat: options?.formArrayFormat ?? "repeat",
    formObjectFormat: options?.formObjectFormat ?? "flat",
    schema: options?.schema,
    resolveSchema: options?.resolveSchema,
    partContentTypes: options?.partContentTypes,
  };

  if (isMultipartFormData(mediaType)) {
    const formData = await req.formData();
    const rawFormKeys = [...formData.keys()];
    const parsed = await parseFormData(formData, parserOptions);
    return { body: parsed.data, rawFormKeys };
  }

  // application/x-www-form-urlencoded
  const body = await readBody(req);
  const params = new URLSearchParams(body);
  const rawFormKeys = [...params.keys()];
  const parsed = parseUrlEncoded(body, parserOptions);
  return { body: parsed.data, rawFormKeys };
}
