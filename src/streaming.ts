import { RequestLimitError } from "./server/limits.ts";
/**
 * Streaming response generator for NDJSON and SSE formats
 *
 * Supports:
 * - application/x-ndjson: Newline-delimited JSON (each line is a complete JSON object)
 * - text/event-stream: Server-Sent Events (data: {...}\n\n format)
 *
 * NDJSON Examples:
 * - Array of objects: each object is streamed as a JSON line
 * - Multiline string: each line is parsed as JSON and streamed
 * - No example: generates from schema with _stream metadata
 *
 * SSE Examples:
 * - Array of SSE events: each item with event/data fields is streamed
 * - No example: generates from schema
 */

import type { Schema, SchemaRegistry } from "@steady/json-schema";
import {
  checkGeneratedValue,
  checkResponseBytes,
  RegistryResponseGenerator,
} from "@steady/json-schema";
import type { GenerateOptions } from "@steady/json-schema";
import type { ReferenceObject } from "@steady/openapi";
import type { FragmentPointer } from "@steady/json-pointer";
import {
  getMediaType,
  getStreamingFormat,
  isStreamingMediaType,
} from "./media-type.ts";
export type { StreamingMediaType } from "./media-type.ts";

/**
 * SSE event structure for examples.
 * Supports the standard SSE fields: event, data, id, retry
 */
export interface SSEEvent {
  /** Event type name (default: "message") */
  event?: string;
  /** Event data payload */
  data: unknown;
  /** Event ID for client tracking */
  id?: string | number;
  /** Retry timeout in milliseconds */
  retry?: number;
}

/** Check if a raw Content-Type header value is a streaming type. */
export function isStreamingContentType(contentType: string): boolean {
  const essence = getMediaType(contentType);
  return essence !== null && isStreamingMediaType(essence);
}

/** Get the streaming format from a raw Content-Type header value. */
export function getStreamFormat(
  contentType: string,
): "ndjson" | "sse" | null {
  const essence = getMediaType(contentType);
  if (!essence) return null;
  return getStreamingFormat(essence);
}

export interface StreamingOptions {
  /** Number of items to stream (default: 5) */
  count?: number;
  /** Interval between items in milliseconds (default: 100) */
  interval?: number;
  /** Generator options for creating items */
  generatorOptions?: GenerateOptions;
  /** Pre-defined example events (for SSE) */
  example?: unknown;
}

const DEFAULT_STREAM_COUNT = 5;
const DEFAULT_STREAM_INTERVAL = 100;

/**
 * Check if an example is an SSE event sequence (array of events with data fields)
 */
export function isSSEEventSequence(example: unknown): example is SSEEvent[] {
  if (!Array.isArray(example) || example.length === 0) {
    return false;
  }
  // Check if items look like SSE events (have data field or event field)
  return example.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      ("data" in item || "event" in item),
  );
}

/**
 * Check if an example is a valid NDJSON example.
 * Valid formats:
 * - Array of objects (that are NOT SSE events)
 * - Multiline string where each line is a valid JSON object
 * - Single-line string that is a valid JSON object
 */
export function isNDJSONExample(example: unknown): boolean {
  // Array of objects (but not SSE event sequences)
  if (Array.isArray(example)) {
    if (example.length === 0) {
      return false;
    }
    // If it looks like SSE events, it's not NDJSON
    if (isSSEEventSequence(example)) {
      return false;
    }
    // Must be array of objects
    return example.every(
      (item) => typeof item === "object" && item !== null,
    );
  }

  // Multiline string of JSON objects
  if (typeof example === "string") {
    const lines = example.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) {
      return false;
    }
    // Try to parse each line as JSON
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        // Each line must be an object (not array, string, number, etc.)
        if (
          typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Parse an NDJSON example into an array of objects.
 * Handles both array format and multiline string format.
 */
export function parseNDJSONExample(example: unknown): unknown[] {
  // Array format - return as-is
  if (Array.isArray(example)) {
    return example;
  }

  // Multiline string format - parse each line
  if (typeof example === "string") {
    const lines = example.split("\n").filter((line) => line.trim() !== "");
    return lines.map((line) => JSON.parse(line));
  }

  // Fallback - should not reach here if isNDJSONExample was checked
  return [];
}

export function validateStreamingOptions(options: StreamingOptions): void {
  if (
    options.count !== undefined &&
    (!Number.isSafeInteger(options.count) || options.count < 1 ||
      options.count > 1000)
  ) throw new RequestLimitError("Invalid stream count");
  if (
    options.interval !== undefined &&
    (!Number.isSafeInteger(options.interval) || options.interval < 0 ||
      options.interval > 10000)
  ) throw new RequestLimitError("Invalid stream interval");
}

/**
 * Creates a streaming response body as a ReadableStream.
 * Returns the stream and any warnings that should be logged by the caller.
 */
/** Generate at most one bounded chunk per read, including while a client is slow. */
function createTimedStream(
  chunks: Iterator<string>,
  interval: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let bytes = 0;
  let first = true;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = chunks.next();
        if (next.done) {
          controller.close();
          return;
        }
        if (!first && interval > 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, interval);
          });
          timer = undefined;
          wake = undefined;
        }
        if (cancelled) return;
        first = false;
        const chunk = encoder.encode(next.value);
        bytes += chunk.byteLength;
        checkResponseBytes(bytes);
        controller.enqueue(chunk);
      } catch (error) {
        cancelled = true;
        controller.error(error);
        chunks.return?.();
      }
    },
    cancel() {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      wake?.();
      chunks.return?.();
    },
  }, { highWaterMark: 0 });
}

export function createStreamingResponse(
  registry: SchemaRegistry,
  schema: Schema | ReferenceObject,
  schemaPointer: FragmentPointer,
  format: "ndjson" | "sse",
  options: StreamingOptions = {},
): { stream: ReadableStream<Uint8Array>; warnings: string[] } {
  validateStreamingOptions(options);
  const warnings: string[] = [];

  // For SSE with event sequence examples, use the example-based streaming
  if (
    format === "sse" && options.example && isSSEEventSequence(options.example)
  ) {
    return { stream: createSSEFromExample(options.example, options), warnings };
  }

  // For NDJSON with examples (array of objects or multiline string), use example-based streaming
  if (format === "ndjson" && options.example) {
    if (isNDJSONExample(options.example)) {
      return {
        stream: createNDJSONFromExample(options.example, options),
        warnings,
      };
    }
    // Example provided but not valid NDJSON format - warn and fall back to schema
    warnings.push(
      `NDJSON example provided but not valid. ` +
        `Expected array of objects or multiline JSON string. Falling back to schema generation.`,
    );
  }

  // Otherwise, generate from schema
  return {
    stream: createStreamFromSchema(
      registry,
      schema,
      schemaPointer,
      format,
      options,
    ),
    warnings,
  };
}

/**
 * Create SSE stream from a pre-defined event sequence example
 */
function createSSEFromExample(
  events: SSEEvent[],
  options: StreamingOptions,
): ReadableStream<Uint8Array> {
  if (events.length > 1000) {
    throw new RequestLimitError("Too many stream events");
  }
  checkGeneratedValue(events);
  function* chunks(): Generator<string> {
    for (let index = 0; index < events.length; index++) {
      const event = events[index];
      if (event) yield formatSSEEvent(event, index);
    }
    const last = events[events.length - 1]?.event?.toLowerCase();
    if (last !== "done" && last !== "complete" && last !== "end") {
      yield "event: done\ndata: {}\n\n";
    }
  }
  return createTimedStream(
    chunks(),
    options.interval ?? DEFAULT_STREAM_INTERVAL,
  );
}

/**
 * Create NDJSON stream from a pre-defined example (array or multiline string).
 * Unlike schema-generated NDJSON, example-based NDJSON does NOT add _stream metadata.
 */
function createNDJSONFromExample(
  example: unknown,
  options: StreamingOptions,
): ReadableStream<Uint8Array> {
  const items = parseNDJSONExample(example);
  if (items.length > 1000) {
    throw new RequestLimitError("Too many stream events");
  }
  checkGeneratedValue(items);
  function* chunks(): Generator<string> {
    for (const item of items) yield JSON.stringify(item) + "\n";
  }
  return createTimedStream(
    chunks(),
    options.interval ?? DEFAULT_STREAM_INTERVAL,
  );
}

/**
 * Format an SSE event from an example
 *
 * Supports OpenAI-style events where:
 * - event: null or "" skips the event line (for data-only events like [DONE])
 * - id: null skips the id line
 * - String data is output as-is (not JSON encoded)
 */
function formatSSEEvent(event: SSEEvent, index: number): string {
  const lines: string[] = [];

  // Add ID unless explicitly null (use provided or auto-generate)
  if (event.id !== null) {
    const id = event.id ?? index;
    lines.push(`id: ${id}`);
  }

  // Add retry if specified
  if (event.retry !== undefined) {
    lines.push(`retry: ${event.retry}`);
  }

  // Add event type - skip if null or empty string (for OpenAI-style [DONE])
  if (event.event !== null && event.event !== "") {
    const eventType = event.event ?? "message";
    lines.push(`event: ${eventType}`);
  }

  // Add data - strings output as-is, objects JSON encoded
  const data = typeof event.data === "string"
    ? event.data
    : JSON.stringify(event.data);

  // Handle multi-line data (each line needs "data: " prefix)
  const dataLines = data.split("\n");
  for (const line of dataLines) {
    lines.push(`data: ${line}`);
  }

  // End with double newline
  return lines.join("\n") + "\n\n";
}

/**
 * Create stream from schema (original behavior)
 */
function createStreamFromSchema(
  registry: SchemaRegistry,
  schema: Schema | ReferenceObject,
  schemaPointer: FragmentPointer,
  format: "ndjson" | "sse",
  options: StreamingOptions,
): ReadableStream<Uint8Array> {
  const count = options.count ?? DEFAULT_STREAM_COUNT;
  const generatorOptions = options.generatorOptions ?? {};
  const baseSeed = generatorOptions.seed ?? 123456789;
  function* chunks(): Generator<string> {
    for (let index = 0; index < count; index++) {
      const generator = new RegistryResponseGenerator(registry, {
        ...generatorOptions,
        seed: baseSeed + index,
      });
      let item: unknown;
      if ("$ref" in schema && typeof schema.$ref === "string") {
        const resolved = registry.resolveRef(schema.$ref);
        item = resolved
          ? generator.generateFromSchema(resolved.raw, resolved.pointer)
          : { error: `Unresolved reference: ${schema.$ref}` };
      } else {
        item = generator.generateFromSchema(schema, schemaPointer);
      }
      checkGeneratedValue(item);
      yield formatSchemaStreamItem(item, format, index, count);
    }
    if (format === "sse") yield "event: done\ndata: {}\n\n";
  }
  return createTimedStream(
    chunks(),
    options.interval ?? DEFAULT_STREAM_INTERVAL,
  );
}

/**
 * Format a schema-generated item for streaming output
 */
function formatSchemaStreamItem(
  item: unknown,
  format: "ndjson" | "sse",
  index: number,
  total: number,
): string {
  if (format === "sse") {
    // For SSE, wrap in proper event format
    const json = JSON.stringify(item);
    return `id: ${index}\nevent: message\ndata: ${json}\n\n`;
  }

  // NDJSON format: add metadata and output as JSON line
  const itemWithMeta = addStreamingMetadata(item, index, total);
  return JSON.stringify(itemWithMeta) + "\n";
}

/**
 * Add streaming metadata to an item (for NDJSON)
 */
function addStreamingMetadata(
  item: unknown,
  index: number,
  total: number,
): unknown {
  // If item is an object, add metadata fields
  if (typeof item === "object" && item !== null && !Array.isArray(item)) {
    return Object.assign({}, item, {
      _stream: {
        index,
        total,
        timestamp: new Date().toISOString(),
      },
    });
  }
  // For non-objects, wrap in an object
  return {
    data: item,
    _stream: {
      index,
      total,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Parse streaming options from request headers
 */
export function parseStreamingOptions(req: Request): StreamingOptions {
  const countHeader = req.headers.get("X-Steady-Stream-Count");
  const intervalHeader = req.headers.get("X-Steady-Stream-Interval-Ms");

  const options: StreamingOptions = {};

  if (countHeader) {
    const count = parseInt(countHeader, 10);
    if (!isNaN(count) && count > 0 && count <= 1000) {
      options.count = count;
    }
  }

  if (intervalHeader) {
    const interval = parseInt(intervalHeader, 10);
    if (!isNaN(interval) && interval >= 0 && interval <= 10000) {
      options.interval = interval;
    }
  }

  return options;
}
