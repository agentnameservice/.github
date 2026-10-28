// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { prepare, signoff } from "../scripts/manage-repository.mjs";
import { configuration, repositoryName, access } from "../scripts/config.mjs";
import { validate } from "../scripts/validate.mjs";

function config() {
  return {
    repositories: {},
    included: new Set([".github"]),
    deployment: { restrictedRepos: { include: [".github"] } },
    peribolos: {
      orgs: {
        agentnameservice: {
          teams: {
            "sample-maintainers": { members: ["alice"], repos: {} },
            tsc: { members: ["bob"], repos: { governance: "write" } },
            "tsc-owners": {
              maintainers: ["carol", "dave"],
              repos: { ".github": "write" },
            },
          },
        },
      },
    },
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
function fake({
  role = "admin",
  queued = false,
  ci = true,
  owners = "* @agentnameservice/sample-maintainers @agentnameservice/tsc",
} = {}) {
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
            required_status_checks: {
              contexts: ci ? ["DCO", "test"] : [],
              checks: ci ? [{ context: "test", app_id: 15368 }] : [],
            },
          },
        }),
        getContent: async ({ path }) => {
          assert.equal(path, ".github/CODEOWNERS");
          return {
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(owners).toString("base64"),
            },
          };
        },
        listCommitStatusesForRef: "statuses",
      },
      git: {
        getRef: async () => ({ data: { object: { sha: "a".repeat(40) } } }),
      },
      pulls: { list: async () => ({ data: [] }) },
      checks: { listForRef: "checks" },
      teams: {
        getByName: async ({ team_slug }) => ({ data: { name: team_slug } }),
      },
      issues: { get: async () => ({ data: { number: 9 } }) },
    },
    paginate: async (route) =>
      route === "checks"
        ? [{ name: "DCO" }, { name: "test" }, { name: "build" }]
        : route.startsWith("GET /repos/") && queued
          ? [{ type: "merge_queue" }]
          : [],
  };
}
const checks = (result) => result.value.rulesets[0].rules[0].parameters;

test("enrollment writes native repository rules and Peribolos grants without changing membership", async () => {
  const initial = config();
  const result = await prepare(fake(), initial, inputs(), "requester");
  assert.equal(result.value.teams, undefined);
  assert.deepEqual(checks(result).required_status_checks, [
    { context: "DCO" },
    { context: "test", integration_id: 15368 },
  ]);
  assert.equal(checks(result).strict_required_status_checks_policy, true);
  assert.deepEqual(result.deployment.restrictedRepos.include, [
    ".github",
    "sample",
  ]);
  assert.equal(
    result.peribolos.orgs.agentnameservice.teams["sample-maintainers"].repos
      .sample,
    "write",
  );
  assert.equal(
    result.peribolos.orgs.agentnameservice.teams.tsc.repos.sample,
    "write",
  );
  assert.deepEqual(
    result.peribolos.orgs.agentnameservice.teams["sample-maintainers"].members,
    ["alice"],
  );
  assert.deepEqual(
    initial.peribolos.orgs.agentnameservice.teams["sample-maintainers"].repos,
    {},
  );
});

test("merge queues retain loose checks while non-queued repositories stay strict", async () => {
  const result = await prepare(
    fake({ queued: true }),
    config(),
    inputs(),
    "requester",
  );
  assert.equal(checks(result).strict_required_status_checks_policy, false);
  assert.deepEqual(
    checks(result).required_status_checks.find((c) => c.context === "DCO"),
    { context: "DCO" },
  );
});

test("a newly selected DCO requirement uses the App except on merge queues", async () => {
  for (const queued of [false, true]) {
    const result = await prepare(
      fake({ ci: false, queued }),
      config(),
      { ...inputs(), required_checks: "build" },
      "requester",
    );
    assert.deepEqual(
      checks(result).required_status_checks.find((c) => c.context === "DCO"),
      queued ? { context: "DCO" } : { context: "DCO", integration_id: 1861 },
    );
  }
});

test("updating existing config preserves check App bindings and accepts added checks", async () => {
  const first = await prepare(fake(), config(), inputs(), "requester");
  const current = config();
  current.repositories.sample = first.value;
  const result = await prepare(
    fake(),
    current,
    { ...inputs(), required_checks: "test;build" },
    "requester",
  );
  assert.deepEqual(checks(result).required_status_checks, [
    { context: "DCO" },
    { context: "build" },
    { context: "test", integration_id: 15368 },
  ]);
});

test("conflicting check bindings fail instead of dropping an App restriction", async () => {
  const gh = fake();
  const old = gh.paginate;
  gh.paginate = async (route, args) =>
    route.startsWith("GET /repos/")
      ? [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: "test", integration_id: 42 }],
            },
          },
        ]
      : old(route, args);
  await assert.rejects(
    prepare(gh, config(), inputs(), "requester"),
    /Conflicting App bindings/,
  );
});

test("bootstrap grants preserve both administrators and apply only to PR merge restrictions", async () => {
  const result = await prepare(
    fake({
      owners:
        "* @agentnameservice/sample-maintainers @agentnameservice/tsc @agentnameservice/tsc-owners",
    }),
    config(),
    { ...inputs(), bootstrap_access: "Keep current" },
    "requester",
  );
  assert.deepEqual(
    result.value.rulesets[1].bypass_actors.map((a) => [a.name, a.bypass_mode]),
    [
      ["sample-maintainers", "pull_request"],
      ["tsc-owners", "pull_request"],
    ],
  );
  assert.deepEqual(result.value.rulesets[0].bypass_actors, []);
  assert.equal(
    result.peribolos.orgs.agentnameservice.teams["tsc-owners"].repos.sample,
    "write",
  );
  assert.deepEqual(
    result.peribolos.orgs.agentnameservice.teams["tsc-owners"].maintainers,
    ["carol", "dave"],
  );
});

test("removing bootstrap access preserves the administrators' other grants", async () => {
  const initial = config();
  initial.peribolos.orgs.agentnameservice.teams["tsc-owners"].repos.sample =
    "write";
  const result = await prepare(fake(), initial, inputs(), "requester");
  assert.equal(
    result.peribolos.orgs.agentnameservice.teams["tsc-owners"].repos.sample,
    undefined,
  );
  assert.equal(
    result.peribolos.orgs.agentnameservice.teams["tsc-owners"].repos[".github"],
    "write",
  );
});

test("the form uses existing display names rather than renaming teams", async () => {
  const initial = config();
  initial.peribolos.orgs.agentnameservice.teams["Sample Maintainers"] =
    initial.peribolos.orgs.agentnameservice.teams["sample-maintainers"];
  delete initial.peribolos.orgs.agentnameservice.teams["sample-maintainers"];
  const gh = fake();
  gh.rest.teams.getByName = async ({ team_slug }) => ({
    data: {
      name:
        team_slug === "sample-maintainers" ? "Sample Maintainers" : team_slug,
    },
  });
  const result = await prepare(gh, initial, inputs(), "requester");
  assert.equal(
    result.peribolos.orgs.agentnameservice.teams["Sample Maintainers"].repos
      .sample,
    "write",
  );
});

test("missing team configuration and path ownership stop enrollment", async () => {
  const missing = config();
  delete missing.peribolos.orgs.agentnameservice.teams.tsc;
  await assert.rejects(
    prepare(fake(), missing, inputs(), "requester"),
    /Declare team tsc/,
  );
  await assert.rejects(
    prepare(
      fake({
        owners:
          "* @agentnameservice/sample-maintainers @agentnameservice/tsc\n/src/ @agentnameservice/sample-maintainers",
      }),
      config(),
      inputs(),
      "requester",
    ),
    /path-specific/,
  );
});

test("pause changes only settings scope and leaves team access alone", async () => {
  const initial = config();
  initial.included.add("sample");
  initial.deployment.restrictedRepos.include.push("sample");
  const result = await prepare(
    fake(),
    initial,
    { ...inputs(), operation: "Pause management" },
    "requester",
  );
  assert.deepEqual(result.deployment.restrictedRepos.include, [".github"]);
  assert.deepEqual(result.peribolos, initial.peribolos);
});

test("inspection is read-only and publication requires owner authority and DCO", async () => {
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
  await assert.rejects(
    prepare(fake({ role: "member" }), config(), inputs(), "requester"),
    /owner/,
  );
  for (const value of [
    {},
    { certify_dco: true, signoff: "bot" },
    { certify_dco: true, signoff: "Name <a@example.test>\nOther" },
  ])
    assert.throws(() => signoff(value));
  assert.equal(signoff(inputs()), inputs().signoff);
});

test("unknown checks and excluded/foreign names cannot be enrolled", async () => {
  await assert.rejects(
    prepare(fake({ ci: false }), config(), inputs(), "requester"),
    /Select the actual CI/,
  );
  await assert.rejects(
    prepare(
      fake(),
      config(),
      { ...inputs(), required_checks: "never-ran" },
      "requester",
    ),
    /representative PR/,
  );
  for (const name of ["../repo", "other/repo", "governance-archieve", "*"])
    assert.throws(() => repositoryName(name));
});

test("checked-in scope starts with .github; ans preserves its real queued CI", async () => {
  const actual = await configuration();
  validate(actual);
  assert.deepEqual([...actual.included], [".github"]);
  const ans = actual.repositories.ans.rulesets[0].rules[0].parameters;
  assert.equal(ans.strict_required_status_checks_policy, false);
  assert.deepEqual(ans.required_status_checks, [
    { context: "DCO" },
    { context: "Build & Test", integration_id: 15368 },
    { context: "Lint", integration_id: 15368 },
  ]);
  assert.equal(
    access(".github", actual.repositories[".github"]).maintainers,
    "tsc-owners",
  );
});

test("package repositories remain excluded from protection enrollment", async () => {
  const actual = await configuration();
  for (const repository of ["homebrew-ans", "scoop-ans"]) {
    await assert.rejects(
      prepare(fake(), actual, { ...inputs(), repository }, "requester"),
      /excluded from settings management/,
    );
  }
});

test("explicit exclusions cannot be overridden by the include list", async () => {
  for (const repository of ["homebrew-ans", "scoop-ans"]) {
    const actual = await configuration();
    actual.included.add(repository);
    assert.throws(() => validate(actual), /excluded repositories/);
  }
});
