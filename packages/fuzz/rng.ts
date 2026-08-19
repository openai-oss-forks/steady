/**
 * Seeded pseudo-random number generator.
 *
 * Uses the same LCG algorithm as RegistryResponseGenerator
 * (packages/json-schema/schema-registry.ts) for consistency.
 */

export class SeededRng {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** Shuffle an array in place deterministically (Fisher-Yates). */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      // Both indices are in bounds: i from loop guard, j in [0, i].
      const a = array[i];
      const b = array[j];
      if (a !== undefined && b !== undefined) {
        array[i] = b;
        array[j] = a;
      }
    }
    return array;
  }
}
