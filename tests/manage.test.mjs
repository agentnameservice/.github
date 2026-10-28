// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { prepare, signoff } from "../scripts/manage-repository.mjs";
import { configuration, repositoryName } from "../scripts/config.mjs";
import { validate } from "../scripts/validate.mjs";

const roster =
  "## Maintainers\n| GitHub |\n| --- |\n| @alice |\n## Reviewers\n| GitHub |\n| --- |\n";
function fake(
  role = "admin",
  ci = true,
  owners = "* @agentnameservice/sample-maintainers @agentnameservice/tsc",
) {
  return {
    rest: {
      orgs: {
        getMembershipForUser: async () => ({ data: { state: "active", role } }),
      },
      repos: {
        get: async ({ repo }) => ({
          data: {
            full_name: "agentnameservice/" + repo,
            private: false,
            archived: false,
            fork: false,
            default_branch: "main",
          },
        }),
        getBranchProtection: async () => ({
          data: {
            required_status_checks: { contexts: ci ? ["DCO", "test"] : [] },
          },
        }),
        getContent: async ({ path }) => ({
          data: {
            type: "file",
            encoding: "base64",
            content: Buffer.from(
              path === ".github/CODEOWNERS"
                ? owners
                : path === "TSC.md"
                  ? "## Voting members\n| GitHub |\n| --- |\n| @tsc-member |\n"
                  : roster,
            ).toString("base64"),
          },
        }),
        listCommitStatusesForRef: "statuses",
      },
      git: {
        getRef: async () => ({ data: { object: { sha: "a".repeat(40) } } }),
      },
      pulls: { list: async () => ({ data: [] }) },
      checks: { listForRef: "checks" },
      issues: { get: async () => ({ data: { number: 9 } }) },
    },
    paginate: async (route) =>
      route === "checks"
        ? [{ name: "DCO" }, { name: "test" }, { name: "build" }]
        : [],
  };
}
const inputs = () => ({
  repository: "sample",
  operation: "Enroll or update",
  issue: "9",
  signoff: "Example Person <person@example.test>",
  certify_dco: true,
  bootstrap_access: "Remove",
});
const config = () => ({
  repositories: {},
  excluded: new Set(["governance-archieve"]),
  deployment: { restrictedRepos: { exclude: ["governance-archieve"] } },
});

test("enrollment writes native configuration and imports existing checks", async () => {
  const result = await prepare(fake(), config(), inputs(), "requester");
  assert.deepEqual(result.value.teams, [
    { name: "sample-maintainers", permission: "push" },
    { name: "sample-reviewers", permission: "push" },
    { name: "tsc", permission: "push" },
  ]);
  assert.deepEqual(
    result.value.rulesets[0].rules[0].parameters.required_status_checks.map(
      (c) => c.context,
    ),
    ["test"],
  );
  const full = await configuration();
  full.repositories.sample = result.value;
  validate(full);
  result.value.rulesets[0].rules[0].parameters.required_status_checks.push({
    context: "DCO",
  });
  assert.throws(() => validate(full), /additional/);
});
test("inspection does not require a signoff or issue", async () => {
  const result = await prepare(
    fake(),
    config(),
    {
      repository: "sample",
      operation: "Inspect repository",
      bootstrap_access: "Remove",
    },
    "requester",
  );
  assert.equal(result.signoff, undefined);
  assert.deepEqual(result.pending, []);
});
test("only organization owners can request changes", async () => {
  await assert.rejects(
    prepare(fake("member"), config(), inputs(), "requester"),
    /owner/,
  );
});
test("DCO is explicit, not invented or silently certified", () => {
  for (const value of [
    {},
    { certify_dco: true, signoff: "bot" },
    {
      certify_dco: true,
      signoff: "Name <a@example.test>\nSigned-off-by: Other <x@example.test>",
    },
  ])
    assert.throws(() => signoff(value));
  assert.equal(signoff(inputs()), inputs().signoff);
});
test("first CI choice must be supplied rather than guessed", async () => {
  await assert.rejects(
    prepare(fake("admin", false), config(), inputs(), "requester"),
    /Select the actual CI/,
  );
  const result = await prepare(
    fake("admin", false),
    config(),
    { ...inputs(), required_checks: "build" },
    "requester",
  );
  assert.deepEqual(
    result.value.rulesets[0].rules[0].parameters.required_status_checks.map(
      (c) => c.context,
    ),
    ["build"],
  );
});
test("an explicit check update supports a renamed CI job through a reviewed diff", async () => {
  const result = await prepare(
    fake(),
    config(),
    { ...inputs(), required_checks: "build" },
    "requester",
  );
  assert.deepEqual(
    result.value.rulesets[0].rules[0].parameters.required_status_checks.map(
      (c) => c.context,
    ),
    ["build"],
  );
});
test("archive and cross-organization paths are rejected", () => {
  for (const value of ["governance-archieve", "../repo", "other/repo", "*"])
    assert.throws(() => repositoryName(value));
});
test("initial configuration manages only .github through tsc-owners", async () => {
  const initial = await configuration();
  validate(initial);
  assert.deepEqual(Object.keys(initial.repositories), [".github"]);
  assert.deepEqual(initial.repositories[".github"].teams, [
    { name: "tsc-owners", permission: "push" },
  ]);
});

test("TSC reviews do not grant merge or protection bypass rights", async () => {
  const { value } = await prepare(fake(), config(), inputs(), "requester");
  const full = await configuration();
  full.repositories.sample = value;
  validate(full);
  assert.deepEqual(value.rulesets[1].bypass_actors, [
    {
      actor_type: "Team",
      name: "sample-maintainers",
      bypass_mode: "pull_request",
    },
  ]);
  assert.deepEqual(value.rulesets[0].bypass_actors, []);
  assert.deepEqual(full.defaults.rulesets[0].bypass_actors, []);
  value.rulesets[1].bypass_actors[0].name = "tsc";
  assert.throws(() => validate(full), /does not confer project merge/);
});

test("CODEOWNERS recognizes either team order and checks the effective catch-all", async () => {
  const result = await prepare(
    fake(
      "admin",
      true,
      "* @agentnameservice/old-maintainers @agentnameservice/tsc\n* @agentnameservice/tsc @agentnameservice/sample-maintainers # fallback",
    ),
    config(),
    inputs(),
    "requester",
  );
  assert.equal(
    result.value.rulesets[1].bypass_actors[0].name,
    "sample-maintainers",
  );
  await assert.rejects(
    prepare(
      fake(
        "admin",
        true,
        "* @agentnameservice/sample-maintainers @agentnameservice/tsc\n* @agentnameservice/sample-maintainers",
      ),
      config(),
      inputs(),
      "requester",
    ),
    /Merge CODEOWNERS/,
  );
});

test("path-specific CODEOWNERS cannot silently remove the TSC fallback", async () => {
  await assert.rejects(
    prepare(
      fake(
        "admin",
        true,
        "* @agentnameservice/sample-maintainers @agentnameservice/tsc\n/src/ @agentnameservice/sample-reviewers",
      ),
      config(),
      inputs(),
      "requester",
    ),
    /path-specific/,
  );
});

test("enrollment requires the published TSC source before granting its access", async () => {
  const gh = fake();
  const original = gh.rest.repos.getContent;
  gh.rest.repos.getContent = async (args) => {
    if (args.path === "TSC.md")
      throw Object.assign(new Error("missing"), { status: 404 });
    return original(args);
  };
  await assert.rejects(
    prepare(gh, config(), inputs(), "requester"),
    /governance: merge its approved roster into the default branch first/,
  );
});

test("private governance can supply the TSC roster without becoming a managed private repo", async () => {
  const gh = fake();
  const original = gh.rest.repos.get;
  gh.rest.repos.get = async (args) => {
    const response = await original(args);
    response.data.private = args.repo === "governance";
    return response;
  };
  const result = await prepare(gh, config(), inputs(), "requester");
  assert.deepEqual(result.pending, []);
  await assert.rejects(
    prepare(
      gh,
      config(),
      { ...inputs(), repository: "governance" },
      "requester",
    ),
    /must be public/,
  );
});

test("new repositories retain bootstrap approval and PR-only merge access by default", async () => {
  const gh = fake(
    "admin",
    true,
    "* @agentnameservice/sample-maintainers @agentnameservice/tsc @agentnameservice/tsc-owners",
  );
  const request = { ...inputs() };
  delete request.bootstrap_access;
  const { value } = await prepare(gh, config(), request, "requester");
  assert.deepEqual(
    value.rulesets[1].bypass_actors.map((a) => [a.name, a.bypass_mode]),
    [
      ["sample-maintainers", "pull_request"],
      ["tsc-owners", "pull_request"],
    ],
  );
  assert.ok(
    value.teams.some((t) => t.name === "tsc-owners" && t.permission === "push"),
  );
  const full = await configuration();
  full.repositories.sample = value;
  validate(full);
  assert.deepEqual(value.rulesets[0].bypass_actors, []);
  value.rulesets[1].bypass_actors[1].bypass_mode = "always";
  assert.throws(() => validate(full), /through PRs/);
});

test("bootstrap handoff stays removed on subsequent updates", async () => {
  const { value } = await prepare(fake(), config(), inputs(), "requester");
  const current = config();
  current.repositories.sample = value;
  const result = await prepare(
    fake(),
    current,
    { ...inputs(), bootstrap_access: "Keep current" },
    "requester",
  );
  assert.deepEqual(
    result.value.rulesets[1].bypass_actors.map((a) => a.name),
    ["sample-maintainers"],
  );
});

test("bootstrap CODEOWNERS cannot be omitted on path-specific rules", async () => {
  await assert.rejects(
    prepare(
      fake(
        "admin",
        true,
        "* @agentnameservice/sample-maintainers @agentnameservice/tsc @agentnameservice/tsc-owners\n/private/ @agentnameservice/tsc",
      ),
      config(),
      { ...inputs(), bootstrap_access: "Enable" },
      "requester",
    ),
    /tsc-owners on every CODEOWNERS/,
  );
});

test("initial .github enrollment does not depend on any TSC roster", async () => {
  const gh = fake("admin", true, "* @agentnameservice/tsc-owners");
  const original = gh.rest.repos.get;
  gh.rest.repos.get = async (args) => {
    assert.equal(
      args.repo,
      ".github",
      "No governance read is needed for the owners-only initial configuration",
    );
    return original(args);
  };
  const { value } = await prepare(
    gh,
    config(),
    { ...inputs(), repository: ".github" },
    "requester",
  );
  assert.deepEqual(value.teams, [{ name: "tsc-owners", permission: "push" }]);
  const full = await configuration();
  full.repositories[".github"] = value;
  validate(full);
});

test("governance and .github retain their distinct merge authorities", async () => {
  for (const [repository, team] of [
    ["governance", "tsc"],
    [".github", "tsc-owners"],
  ]) {
    const gh = fake(
      "admin",
      true,
      "* " +
        [...new Set([team, "tsc"])]
          .map((t) => "@agentnameservice/" + t)
          .join(" "),
    );
    const original = gh.rest.repos.getContent;
    gh.rest.repos.getContent = async (args) =>
      args.path === "TSC.md"
        ? {
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(
                "## Voting members\n| GitHub |\n| --- |\n| @alice |\n",
              ).toString("base64"),
            },
          }
        : original(args);
    const { value } = await prepare(
      gh,
      config(),
      { ...inputs(), repository },
      "requester",
    );
    const full = await configuration();
    full.repositories[repository] = value;
    validate(full);
    assert.deepEqual(
      value.rulesets[1].bypass_actors.map((a) => a.name),
      [team],
    );
    assert.equal(value.teams.filter((t) => t.name === "tsc").length, 1);
  }
});
