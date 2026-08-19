import { assertEquals } from "@std/assert";
import { isHttpMethod } from "./types.ts";

Deno.test("isHttpMethod recognizes query", () => {
  assertEquals(isHttpMethod("query"), true);
});
