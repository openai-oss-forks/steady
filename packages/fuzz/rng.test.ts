import { assertEquals, assertNotEquals } from "@std/assert";
import { SeededRng } from "./rng.ts";

Deno.test("SeededRng", async (t) => {
  await t.step("deterministic: same seed produces same sequence", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      assertEquals(a.next(), b.next());
    }
  });

  await t.step("different seeds produce different sequences", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    // At least one of the first 10 values should differ
    let allSame = true;
    for (let i = 0; i < 10; i++) {
      if (a.next() !== b.next()) allSame = false;
    }
    assertEquals(allSame, false);
  });

  await t.step("values are in [0, 1)", () => {
    const rng = new SeededRng(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      assertEquals(v >= 0, true, `value ${v} should be >= 0`);
      assertEquals(v < 1, true, `value ${v} should be < 1`);
    }
  });

  await t.step("shuffle is deterministic", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    a.shuffle(arr1);
    b.shuffle(arr2);
    assertEquals(arr1, arr2);
  });

  await t.step("shuffle actually reorders", () => {
    const rng = new SeededRng(42);
    const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = [...original];
    rng.shuffle(shuffled);
    // Extremely unlikely (1 in 10!) that shuffle produces the same order
    assertNotEquals(shuffled, original);
  });

  await t.step("shuffle preserves elements", () => {
    const rng = new SeededRng(99);
    const arr = ["a", "b", "c", "d", "e"];
    rng.shuffle(arr);
    assertEquals(arr.sort(), ["a", "b", "c", "d", "e"]);
  });
});
