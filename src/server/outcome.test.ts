import { assertEquals, assertRejects } from "@std/assert";
import { observeResponse } from "./outcome.ts";

Deno.test("stream outcomes are recorded once on EOF, error, and cancellation", async () => {
  for (const mode of ["eof", "error", "cancel"] as const) {
    const outcomes: string[] = [];
    let source: ReadableStreamDefaultController<Uint8Array>;
    const response = observeResponse(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
            controller.enqueue(new Uint8Array([1]));
          },
        }),
      ),
      () => outcomes.push("complete"),
      () => outcomes.push("failed"),
    );
    const reader = response.body!.getReader();
    assertEquals((await reader.read()).value, new Uint8Array([1]));
    if (mode === "eof") {
      source!.close();
      assertEquals((await reader.read()).done, true);
    }
    if (mode === "error") {
      source!.error(new Error("test"));
      await assertRejects(() => reader.read());
    }
    if (mode === "cancel") await reader.cancel();
    assertEquals(outcomes, [mode === "error" ? "failed" : "complete"]);
    reader.releaseLock();
  }
});
