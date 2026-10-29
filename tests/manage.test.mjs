// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { prepare, signoff } from "../scripts/manage-repository.mjs";
import { configuration, repositoryName } from "../scripts/config.mjs";
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
  teamNames = {},
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
      teams: { list: "teams" },
      issues: { get: async () => ({ data: { number: 9 } }) },
    },
    paginate: async (route) => {
      if (route === "teams")
        return [
          "sample-maintainers", "custom-maintainers", "sample-reviewers",
          "other-reviewers", "triage-reviewers", "tsc", "tsc-owners",
        ]
          .filter((slug) => teamNames[slug] !== null)
          .map((slug) => ({ slug, name: teamNames[slug] || slug }));
      if (route === "checks")
        return [{ name: "DCO" }, { name: "test" }, { name: "build" }];
      if (route.startsWith("GET /repos/") && queued)
        return [{ type: "merge_queue" }];
      return [];
    },
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

test("reviewer teams retain review access without becoming the inferred merge team", async () => {
  const initial = config();
  const teams = initial.peribolos.orgs.agentnameservice.teams;
  teams["custom-maintainers"] = teams["sample-maintainers"];
  delete teams["sample-maintainers"];
  teams["sample-reviewers"] = { members: ["reviewer"], repos: { sample: "write" } };
  teams["other-reviewers"] = { members: ["other"], repos: { other: "write" } };
  teams["triage-reviewers"] = { members: ["triager"], repos: { sample: "triage" } };
  const result = await prepare(
    fake({ owners: "* @agentnameservice/custom-maintainers @agentnameservice/sample-reviewers @agentnameservice/tsc" }),
    initial,
    inputs(),
    "requester",
  );
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.value.rulesets[1].bypass_actors, [
    { actor_type: "Team", name: "custom-maintainers", bypass_mode: "exempt" },
  ]);
  for (const team of ["sample-reviewers", "other-reviewers", "triage-reviewers"])
    assert.deepEqual(result.peribolos.orgs.agentnameservice.teams[team], teams[team]);
});

test("configured reviewer routing is required and undeclared owners remain blocked", async () => {
  const initial = config();
  initial.peribolos.orgs.agentnameservice.teams["sample-reviewers"] = {
    members: ["reviewer"], repos: { sample: "write" },
  };
  for (const owners of [
    "* @agentnameservice/sample-maintainers @agentnameservice/tsc",
    "* @agentnameservice/sample-maintainers @agentnameservice/sample-reviewers @agentnameservice/rogue-reviewers @agentnameservice/tsc",
  ]) {
    const result = await prepare(
      fake({ owners }), initial, { ...inputs(), operation: "Inspect repository" }, "requester",
    );
    assert.ok(result.pending.includes(
      "Merge CODEOWNERS with * @agentnameservice/sample-maintainers @agentnameservice/sample-reviewers @agentnameservice/tsc.",
    ));
    assert.deepEqual(result.value.rulesets[1].bypass_actors.map(a => a.name), ["sample-maintainers"]);
    await assert.rejects(
      prepare(fake({ owners }), initial, inputs(), "requester"),
      /Merge CODEOWNERS with .*sample-reviewers/,
    );
  }
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

test("bootstrap grants preserve both administrators and exempt only the update gate", async () => {
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
      ["sample-maintainers", "exempt"],
      ["tsc-owners", "exempt"],
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
  const gh = fake({ teamNames: { "sample-maintainers": "Sample Maintainers" } });
  const result = await prepare(gh, initial, inputs(), "requester");
  assert.equal(
    result.peribolos.orgs.agentnameservice.teams["Sample Maintainers"].repos
      .sample,
    "write",
  );
});

test("reviewer display names resolve to live slugs without gaining merge access", async () => {
  const initial = config();
  const teams = initial.peribolos.orgs.agentnameservice.teams;
  teams["Sample Maintainers"] = teams["sample-maintainers"];
  delete teams["sample-maintainers"];
  teams["Sample Reviewers"] = { members: ["reviewer"], repos: { sample: "write" } };
  const result = await prepare(
    fake({
      teamNames: {
        "sample-maintainers": "Sample Maintainers",
        "sample-reviewers": "Sample Reviewers",
      },
      owners: "* @agentnameservice/sample-maintainers @agentnameservice/sample-reviewers @agentnameservice/tsc",
    }),
    initial,
    inputs(),
    "requester",
  );
  assert.deepEqual(result.pending, []);
  assert.deepEqual(result.value.rulesets[1].bypass_actors.map((a) => a.name), [
    "sample-maintainers",
  ]);
  assert.deepEqual(
    result.peribolos.orgs.agentnameservice.teams["Sample Reviewers"],
    teams["Sample Reviewers"],
  );
  assert.equal(result.peribolos.orgs.agentnameservice.teams["sample-reviewers"], undefined);
});

test("a declared reviewer team must exist before enrollment", async () => {
  const initial = config();
  initial.peribolos.orgs.agentnameservice.teams["sample-reviewers"] = {
    members: ["reviewer"], repos: { sample: "write" },
  };
  await assert.rejects(
    prepare(
      fake({ teamNames: { "sample-reviewers": null } }),
      initial,
      inputs(),
      "requester",
    ),
    /Apply team sample-reviewers from peribolos.yml/,
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

test("checked-in native configuration satisfies the governance invariants", async () => {
  validate(await configuration());
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

test("update-gate exceptions cannot bypass review or status-check rules", async () => {
  for (const target of ["baseline", "checks", "gate"]) {
    const actual = await configuration();
    const gate = actual.repositories.ans.rulesets.find(
      (rule) => rule.name === "ANS Maintainer merges",
    );
    if (target === "baseline") {
      actual.defaults.rulesets[0].bypass_actors = gate.bypass_actors;
      assert.throws(() => validate(actual), /baseline has no bypass actors/);
    } else if (target === "checks") {
      actual.repositories.ans.rulesets[0].bypass_actors = gate.bypass_actors;
      assert.throws(() => validate(actual), /CI requirements have no bypass/);
    } else {
      gate.rules.push({
        type: "pull_request",
        parameters: { required_approving_review_count: 1 },
      });
      assert.throws(() => validate(actual), /limited to the update restriction/);
    }
  }
});
