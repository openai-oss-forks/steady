import { assertEquals, assertExists } from "@std/assert";
import { PipelineTimer } from "./timing.ts";

Deno.test("PipelineTimer - single phase", () => {
  const timer = new PipelineTimer();
  timer.start("parse");
  timer.stop("parse");

  const result = timer.getResult();
  assertEquals(result.phases.length, 1);
  assertEquals(result.phases[0]?.name, "parse");
  assertEquals(typeof result.phases[0]?.duration, "number");
  assertEquals(result.phases[0]?.children, undefined);
  assertEquals(typeof result.total, "number");
});

Deno.test("PipelineTimer - nested phases", () => {
  const timer = new PipelineTimer();
  timer.start("server-init");
  timer.start("document");
  timer.start("registry");
  timer.stop("registry");
  timer.stop("document");
  timer.stop("server-init");

  const result = timer.getResult();
  assertEquals(result.phases.length, 1);

  const serverInit = result.phases[0];
  assertExists(serverInit);
  assertEquals(serverInit.name, "server-init");
  assertExists(serverInit.children);
  assertEquals(serverInit.children.length, 1);

  const document = serverInit.children[0];
  assertExists(document);
  assertEquals(document.name, "document");
  assertExists(document.children);
  assertEquals(document.children.length, 1);

  const registry = document.children[0];
  assertExists(registry);
  assertEquals(registry.name, "registry");
  assertEquals(registry.children, undefined);
});

Deno.test("PipelineTimer - sequential phases", () => {
  const timer = new PipelineTimer();
  timer.start("parse");
  timer.stop("parse");
  timer.start("analyze");
  timer.stop("analyze");
  timer.start("server-init");
  timer.stop("server-init");

  const result = timer.getResult();
  assertEquals(result.phases.length, 3);
  assertEquals(result.phases[0]?.name, "parse");
  assertEquals(result.phases[1]?.name, "analyze");
  assertEquals(result.phases[2]?.name, "server-init");
});

Deno.test("PipelineTimer - mixed nesting", () => {
  const timer = new PipelineTimer();

  timer.start("parse");
  timer.start("io");
  timer.stop("io");
  timer.start("yaml");
  timer.stop("yaml");
  timer.stop("parse");

  timer.start("analyze");
  timer.stop("analyze");

  const result = timer.getResult();
  assertEquals(result.phases.length, 2);

  const parse = result.phases[0];
  assertExists(parse);
  assertEquals(parse.name, "parse");
  assertExists(parse.children);
  assertEquals(parse.children.length, 2);
  assertEquals(parse.children[0]?.name, "io");
  assertEquals(parse.children[1]?.name, "yaml");
});

Deno.test("PipelineTimer - stop with no matching start is no-op", () => {
  const timer = new PipelineTimer();
  timer.stop("nonexistent");

  const result = timer.getResult();
  assertEquals(result.phases.length, 0);
});

Deno.test("PipelineTimer - unclosed phases auto-close on getResult", () => {
  const timer = new PipelineTimer();
  timer.start("outer");
  timer.start("inner");
  // Never stopped

  const result = timer.getResult();
  assertEquals(result.phases.length, 1);
  assertEquals(result.phases[0]?.name, "outer");
  assertExists(result.phases[0]?.children);
  assertEquals(result.phases[0]?.children.length, 1);
  assertEquals(result.phases[0]?.children[0]?.name, "inner");
});

Deno.test("PipelineTimer - memory snapshot", () => {
  const timer = new PipelineTimer();
  const result = timer.getResult();

  // Deno.memoryUsage() should be available in test context
  assertExists(result.memory);
  assertEquals(typeof result.memory.heapUsed, "number");
  assertEquals(typeof result.memory.heapTotal, "number");
  // Heap used should be positive
  assertEquals(result.memory.heapUsed > 0, true);
});

Deno.test("PipelineTimer - duration precision", () => {
  const timer = new PipelineTimer();
  timer.start("fast");
  timer.stop("fast");

  const result = timer.getResult();
  const duration = result.phases[0]?.duration;
  assertExists(duration);
  // Duration should be a number with at most 2 decimal places
  const rounded = Math.round(duration * 100) / 100;
  assertEquals(duration, rounded);
});

Deno.test("PipelineTimer - total includes all phases", () => {
  const timer = new PipelineTimer();
  timer.start("a");
  timer.stop("a");
  timer.start("b");
  timer.stop("b");

  const result = timer.getResult();
  // Total should be >= sum of phase durations (includes gaps between phases)
  const sumPhases = result.phases.reduce((s, p) => s + p.duration, 0);
  assertEquals(result.total >= sumPhases, true);
});
