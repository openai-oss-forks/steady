export const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;
export const BODY_TIMEOUT_MS = 30_000;

export class RequestLimitError extends Error {
  constructor(message: string, readonly status: 400 | 408 | 413 = 400) {
    super(message);
    this.name = "RequestLimitError";
  }
}

/** The mock server has no authentication; do not expose its control endpoints. */
export function loopbackHost(host: string): string {
  if (host === "localhost" || host === "127.0.0.1") return "127.0.0.1";
  if (host === "::1" || host === "[::1]") return "::1";
  throw new Error("Steady only supports loopback TCP bindings");
}

export function validateBodyLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024 ** 3) {
    throw new Error(
      "maxRequestBodyBytes must be an integer between 1 and 1073741824",
    );
  }
  return limit;
}

/** Count actual streamed bytes; Content-Length alone is not a security boundary. */
export async function readLimitedBody(
  req: Request,
  limit = DEFAULT_MAX_BODY_BYTES,
  timeoutMs = BODY_TIMEOUT_MS,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  await consumeLimitedBody(req, limit, timeoutMs, (chunk) => {
    chunks.push(chunk);
    size += chunk.byteLength;
  });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Discard a rejected upload without retaining it, using the same read limits. */
export function drainLimitedBody(
  req: Request,
  limit = DEFAULT_MAX_BODY_BYTES,
  timeoutMs = BODY_TIMEOUT_MS,
): Promise<void> {
  return consumeLimitedBody(req, limit, timeoutMs, () => {});
}

async function consumeLimitedBody(
  req: Request,
  limit: number,
  timeoutMs: number,
  consume: (chunk: Uint8Array) => void,
): Promise<void> {
  validateBodyLimit(limit);
  const declared = req.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    void req.body?.cancel().catch(() => {});
    throw new RequestLimitError("Request body exceeds the byte limit", 413);
  }
  if (!req.body) return;
  const reader = req.body.getReader();
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new RequestLimitError("Request body timed out", 408)),
      timeoutMs,
    );
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        throw new RequestLimitError("Request body exceeds the byte limit", 413);
      }
      consume(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
