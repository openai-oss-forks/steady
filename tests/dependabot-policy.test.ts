import { assertEquals } from "@std/assert";
import { parse } from "@std/yaml";

for (const ecosystem of ["deno", "github-actions"]) {
  Deno.test(`Dependabot ${ecosystem} permits only major version updates without ignoring security fixes`, async () => {
    const config = parse(
      await Deno.readTextFile(
        new URL("../.github/dependabot.yml", import.meta.url),
      ),
    ) as { updates: Record<string, unknown>[] };

    const jobs = config.updates.filter(
      (job) => job["package-ecosystem"] === ecosystem,
    );
    assertEquals(jobs.length, 1, `Expected one ${ecosystem} update job`);
    const [job] = jobs;
    assertEquals(
      job?.allow,
      [{
        "dependency-name": "*",
        "update-types": ["version-update:semver-major"],
      }],
      "Use allow.update-types to limit routine PRs without filtering security updates",
    );
    assertEquals(
      job?.ignore ?? [],
      [],
      "Do not ignore dependencies or versions that may need security fixes",
    );
  });
}
