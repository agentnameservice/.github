// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { Octokit } from "@octokit/rest";
import { observedChecks } from "../scripts/manage-repository.mjs";

function client(routes) {
  return new Octokit({
    request: {
      fetch: async (url) => {
        const pathname = new URL(String(url)).pathname;
        assert.ok(
          Object.hasOwn(routes, pathname),
          `Unexpected request: ${pathname}`,
        );
        const response = new Response(JSON.stringify(routes[pathname]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
        Object.defineProperty(response, "url", { value: String(url) });
        return response;
      },
    },
  });
}

test("real Octokit normalizes check-run collections", async () => {
  const gh = client({
    "/repos/agentnameservice/example/pulls": [],
    "/repos/agentnameservice/example/commits/main/check-runs": {
      total_count: 1,
      check_runs: [{ name: "CI" }],
    },
    "/repos/agentnameservice/example/commits/main/statuses": [
      { context: "DCO" },
    ],
  });
  assert.deepEqual(await observedChecks(gh, "example", "main"), ["CI", "DCO"]);
});
