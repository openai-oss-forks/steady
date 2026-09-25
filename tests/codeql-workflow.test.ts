import { assert, assertEquals, assertMatch } from "@std/assert";
import { parse } from "@std/yaml";

Deno.test("CodeQL steps use one SHA-pinned action release", async () => {
  const workflow = parse(
    await Deno.readTextFile(
      new URL("../.github/workflows/codeql.yml", import.meta.url),
    ),
  ) as { jobs: Record<string, { steps: { uses?: string }[] }> };

  const actions = Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .map((step) => step.uses ?? "")
    .filter((uses) => uses.startsWith("github/codeql-action/"));
  assert(actions.some((uses) => uses.startsWith("github/codeql-action/init@")));
  assert(
    actions.some((uses) => uses.startsWith("github/codeql-action/analyze@")),
  );
  for (const action of actions) {
    assertMatch(action, /^github\/codeql-action\/[^@]+@[0-9a-f]{40}$/);
  }
  assertEquals(
    new Set(actions.map((action) => action.split("@")[1])).size,
    1,
    "Update all CodeQL steps together; init and analyze must use the same release",
  );
});
