export const MAX_GENERATED_ARRAY_ITEMS = 1000;
export const MAX_GENERATED_STRING_LENGTH = 65536;
export const MAX_GENERATED_NODES = 10000;
export const MAX_GENERATION_DEPTH = 100;
export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export class GenerationLimitError extends Error {
  constructor() {
    super("Response generation exceeds the configured safety limits");
    this.name = "GenerationLimitError";
  }
}

export function checkGenerationCount(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new GenerationLimitError();
  }
}

/** Budget the actual JSON value, including literal/example subtrees. */
export class GeneratedValueBudget {
  private nodes = 0;
  private bytes = 0;
  private encoder = new TextEncoder();

  private charge(bytes: number): void {
    this.bytes += bytes;
    if (this.bytes > MAX_RESPONSE_BYTES) throw new GenerationLimitError();
  }

  container(children: number): void {
    if (++this.nodes > MAX_GENERATED_NODES) throw new GenerationLimitError();
    this.charge(2 + Math.max(0, children - 1));
  }

  key(key: string): void {
    checkGenerationCount(key.length, MAX_GENERATED_STRING_LENGTH);
    this.charge(this.encoder.encode(JSON.stringify(key)).byteLength + 1);
  }

  add(value: unknown, depth = 0, ancestors = new Set<object>()): void {
    if (depth > MAX_GENERATION_DEPTH) throw new GenerationLimitError();
    if (value !== null && typeof value === "object") {
      if (ancestors.has(value)) throw new GenerationLimitError();
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          checkGenerationCount(value.length, MAX_GENERATED_ARRAY_ITEMS);
          this.container(value.length);
          for (const item of value) this.add(item, depth + 1, ancestors);
        } else {
          const prototype = Object.getPrototypeOf(value);
          if (prototype !== Object.prototype && prototype !== null) {
            throw new GenerationLimitError();
          }
          const keys = Object.keys(value);
          checkGenerationCount(keys.length, MAX_GENERATED_NODES);
          this.container(keys.length);
          for (const key of keys) {
            this.key(key);
            this.add(
              (value as Record<string, unknown>)[key],
              depth + 1,
              ancestors,
            );
          }
        }
      } finally {
        ancestors.delete(value);
      }
      return;
    }
    if (++this.nodes > MAX_GENERATED_NODES) throw new GenerationLimitError();
    if (typeof value === "string") {
      checkGenerationCount(value.length, MAX_GENERATED_STRING_LENGTH);
    }
    if (
      value !== undefined && value !== null &&
      !["string", "number", "boolean"].includes(typeof value)
    ) throw new GenerationLimitError();
    this.charge(
      this.encoder.encode(JSON.stringify(value) ?? "null").byteLength,
    );
  }
}

export function checkGeneratedValue(value: unknown): void {
  new GeneratedValueBudget().add(value);
}

/** Exact encoded-byte limit, shared by ordinary and streaming responses. */
export function checkResponseBytes(bytes: number): void {
  checkGenerationCount(bytes, MAX_RESPONSE_BYTES);
}
