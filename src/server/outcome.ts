/** Observe a streaming response without buffering it or losing backpressure. */
export function observeResponse(
  response: Response,
  complete: () => void,
  failed: (error: unknown) => void,
): Response {
  if (!response.body) {
    complete();
    return response;
  }
  const reader = response.body.getReader();
  let settled = false;
  const finish = (error?: { value: unknown }) => {
    if (settled) return;
    settled = true;
    if (error) failed(error.value);
    else complete();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
          reader.releaseLock();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        finish({ value: error });
        controller.error(error);
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      // Deliberate client cancellation is normal for SDK streaming tests.
      try {
        await reader.cancel(reason);
        finish();
      } catch (error) {
        finish({ value: error });
      } finally {
        reader.releaseLock();
      }
    },
  });
  return new Response(body, response);
}
