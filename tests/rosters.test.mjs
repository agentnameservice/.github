// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { parseRoster } from "../scripts/rosters.mjs";
import { synchronize } from "../scripts/sync-rosters.mjs";
import { roster } from "../scripts/rosters.mjs";

export const ROSTER =
  "# People\n## Maintainers\n| GitHub |\n| --- |\n| @Alice |\n## Reviewers\n| GitHub |\n| --- |\n| @bob |\n## Emeritus\n| GitHub |\n| --- |\n| @eve |\n";
export function override(team = "sample") {
  return {
    teams: [
      { name: team + "-maintainers", permission: "push" },
      { name: team + "-reviewers", permission: "push" },
      { name: "tsc", permission: "push" },
    ],
    rulesets: [
      {
        name: "ANS Maintainer merges",
        bypass_actors: [
          {
            actor_type: "Team",
            name: team + "-maintainers",
            bypass_mode: "pull_request",
          },
        ],
      },
    ],
  };
}
export function fake(teams = {}) {
  const writes = [];
  const write = (method) => async (data) => {
    writes.push({ method, data });
    return { data: {} };
  };
  const gh = {
    rest: {
      orgs: { listMembers: "members" },
      teams: {
        getByName: async ({ team_slug }) => {
          if (!teams[team_slug])
            throw Object.assign(new Error("missing"), { status: 404 });
          return {
            data: { privacy: "closed", parent: null, ...teams[team_slug] },
          };
        },
        listMembersInOrg: "team-members",
        listReposInOrg: "team-repos",
        create: write("create"),
        removeMembershipForUserInOrg: write("remove"),
        addOrUpdateMembershipForUserInOrg: write("add"),
        addOrUpdateRepoPermissionsInOrg: write("grant"),
      },
    },
    paginate: async (route, params) => {
      if (route === "GET /installation/repositories")
        return [
          { name: "a" },
          { name: "b" },
          { name: "c" },
          { name: "governance" },
          { name: ".github" },
        ];
      if (route === "members")
        return [{ login: "alice" }, { login: "bob" }, { login: "tsc-member" }];
      if (route === "team-members")
        return (teams[params.team_slug]?.members || []).map((login) => ({
          login,
        }));
      if (route === "team-repos") return teams[params.team_slug]?.repos || [];
      if (route.endsWith("/teams"))
        return teams[params.team_slug]?.children || [];
      throw new Error("Unexpected API call: " + route);
    },
  };
  return { gh, writes };
}
const people = async (client, name) =>
  name === "governance"
    ? { maintainers: ["tsc-member"], reviewers: [] }
    : { maintainers: ["alice"], reviewers: ["bob"] };
const quiet = () => {};

test("package repositories share the SDK roster without coupling bootstrap handoff", async () => {
  const sdk = override("shared");
  const tap = override("shared");
  tap.teams.push({ name: "tsc-owners", permission: "push" });
  tap.rulesets[0].bypass_actors.push({
    actor_type: "Team",
    name: "tsc-owners",
    bypass_mode: "pull_request",
  });
  const gh = {
    rest: {
      repos: {
        get: async ({ repo }) => ({
          data: {
            full_name: `agentnameservice/${repo}`,
            private: false,
            archived: false,
            fork: false,
            default_branch: "main",
          },
        }),
        getContent: async ({ repo }) => ({
          data: {
            type: "file",
            encoding: "base64",
            content: Buffer.from(
              repo === "homebrew-ans"
                ? "Roster source: agentnameservice/ans-sdk-go/MAINTAINERS.md\n"
                : ROSTER,
            ).toString("base64"),
          },
        }),
      },
      git: {
        getRef: async () => ({ data: { object: { sha: "b".repeat(40) } } }),
      },
    },
  };
  assert.deepEqual(
    await roster(gh, "homebrew-ans", {
      "homebrew-ans": tap,
      "ans-sdk-go": sdk,
    }),
    { maintainers: ["alice"], reviewers: ["bob"] },
  );
});

test("roster ignores prose and emeritus entries", () => {
  assert.deepEqual(parseRoster(ROSTER), {
    maintainers: ["alice"],
    reviewers: ["bob"],
  });
});

test("private governance is read by pinned default-branch SHA; other private sources are rejected", async () => {
  const reads = [];
  const gh = {
    rest: {
      repos: {
        get: async ({ repo }) => ({
          data: {
            full_name: `agentnameservice/${repo}`,
            private: true,
            archived: false,
            fork: false,
            default_branch: "approved",
          },
        }),
        getContent: async (args) => {
          reads.push(args);
          return {
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(
                "## Voting members\n| GitHub |\n| --- |\n| @alice |\n",
              ).toString("base64"),
            },
          };
        },
      },
      git: {
        getRef: async (args) => {
          assert.equal(args.ref, "heads/approved");
          return { data: { object: { sha: "a".repeat(40) } } };
        },
      },
    },
  };
  assert.deepEqual(await roster(gh, "governance", {}), {
    maintainers: ["alice"],
    reviewers: [],
  });
  assert.equal(reads[0].path, "TSC.md");
  assert.equal(reads[0].ref, "a".repeat(40));
  await assert.rejects(roster(gh, "other-private", {}), /must be public/);
  await assert.rejects(roster(gh, "governance-archieve", {}), /excluded/);
  for (const override of [
    { archived: true },
    { fork: true },
    { full_name: "other/governance" },
  ]) {
    gh.rest.repos.get = async () => ({
      data: {
        full_name: "agentnameservice/governance",
        private: true,
        archived: false,
        fork: false,
        ...override,
      },
    });
    await assert.rejects(roster(gh, "governance", {}), /must be/);
  }
  assert.equal(reads.length, 1);
});

test("TSC may retain its existing Write grant on private governance", async () => {
  const { gh, writes } = fake({
    tsc: {
      members: ["tsc-member"],
      repos: [
        {
          owner: { login: "agentnameservice" },
          name: "governance",
          private: true,
          archived: false,
          fork: false,
          permissions: { push: true },
        },
      ],
    },
  });
  const result = await synchronize(
    gh,
    { repositories: { a: override("a") }, excluded: new Set(["governance"]) },
    true,
    people,
    quiet,
  );
  assert.deepEqual(result.errors, []);
  assert.ok(
    !writes.some((w) => w.method === "grant" && w.data.repo === "governance"),
  );
});

test("owners-only .github synchronization needs no governance source and preserves both initial owners", async () => {
  const { gh, writes } = fake({
    "tsc-owners": {
      members: ["alice", "bob"],
      repos: [
        {
          owner: { login: "agentnameservice" },
          name: ".github",
          private: false,
          archived: false,
          fork: false,
          permissions: { push: true },
        },
      ],
    },
  });
  const settings = {
    teams: [{ name: "tsc-owners", permission: "push" }],
    rulesets: [
      {
        name: "ANS Maintainer merges",
        bypass_actors: [
          {
            actor_type: "Team",
            name: "tsc-owners",
            bypass_mode: "pull_request",
          },
        ],
      },
    ],
  };
  const result = await synchronize(
    gh,
    {
      repositories: { ".github": settings },
      excluded: new Set(["governance"]),
    },
    true,
    async (client, name) => {
      assert.equal(name, ".github");
      return { maintainers: ["alice", "bob"], reviewers: [] };
    },
    quiet,
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(writes, []);
});

test("bootstrap team membership comes only from .github; team preparation never grants access", async () => {
  const { gh, writes } = fake();
  const settings = override("a");
  settings.teams.push({ name: "tsc-owners", permission: "push" });
  settings.rulesets[0].bypass_actors.push({
    actor_type: "Team",
    name: "tsc-owners",
    bypass_mode: "pull_request",
  });
  const read = async (client, name) =>
    name === ".github"
      ? { maintainers: ["alice", "bob"], reviewers: [] }
      : people(client, name);
  const result = await synchronize(
    gh,
    { repositories: { a: settings }, excluded: new Set() },
    true,
    read,
    quiet,
    false,
  );
  assert.deepEqual(result.errors, []);
  assert.ok(
    writes.some((w) => w.method === "create" && w.data.name === "tsc-owners"),
  );
  assert.deepEqual(
    writes
      .filter((w) => w.method === "add" && w.data.team_slug === "tsc-owners")
      .map((w) => w.data.username),
    ["alice", "bob"],
  );
  assert.ok(!writes.some((w) => w.method === "grant"));
});
test("malformed or ambiguous rosters fail closed", () => {
  for (const value of [
    ROSTER.replace("| @Alice |", ""),
    "<!--\n" + ROSTER,
    ROSTER + "\n## Maintainers",
    ROSTER.replace("@bob", "@alice"),
    ROSTER.replace("@Alice", "@Alice @eve"),
  ])
    assert.throws(() => parseRoster(value));
});
test("TSC source is its voting table", () => {
  assert.deepEqual(
    parseRoster(
      "## Voting members\n| Name | GitHub |\n| --- | --- |\n| Alice | @alice |\n## Advisors\n| GitHub |\n| --- |\n| @eve |",
      true,
    ),
    { maintainers: ["alice"], reviewers: [] },
  );
});
test("preview plans membership and grants without writes", async () => {
  const { gh, writes } = fake();
  const result = await synchronize(
    gh,
    { repositories: { a: override("a") }, excluded: new Set() },
    false,
    people,
    quiet,
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.changes, 9);
  assert.deepEqual(writes, []);
});
test("malformed project does not block an independent team", async () => {
  const { gh, writes } = fake();
  const result = await synchronize(
    gh,
    {
      repositories: { a: override("a"), b: override("b") },
      excluded: new Set(),
    },
    true,
    async (client, name) => {
      if (name === "a") throw new Error("missing roster");
      return people(client, name);
    },
    quiet,
  );
  assert.equal(result.errors.length, 1);
  assert.ok(writes.length);
  assert.ok(
    writes.every(
      (w) =>
        (w.data.name || w.data.team_slug).startsWith("b-") ||
        (w.data.name || w.data.team_slug) === "tsc",
    ),
  );
});
test("conflicting shared roster blocks that team without blocking others", async () => {
  const { gh, writes } = fake();
  const result = await synchronize(
    gh,
    {
      repositories: {
        a: override("shared"),
        b: override("shared"),
        c: override("c"),
      },
      excluded: new Set(),
    },
    true,
    async (client, name) => ({
      maintainers: [name === "b" ? "bob" : "alice"],
      reviewers: [],
    }),
    quiet,
  );
  assert.equal(result.errors.length, 1);
  assert.ok(
    writes.every(
      (w) =>
        (w.data.name || w.data.team_slug).startsWith("c-") ||
        (w.data.name || w.data.team_slug) === "tsc",
    ),
  );
});
test("nested or externally used teams cannot be overwritten", async () => {
  for (const state of [
    { parent: { slug: "parent" } },
    { children: [{ slug: "child" }] },
    {
      repos: [
        {
          owner: { login: "agentnameservice" },
          name: "outside",
          permissions: { push: true },
        },
      ],
    },
  ]) {
    const { gh, writes } = fake({ "a-maintainers": state });
    const result = await synchronize(
      gh,
      { repositories: { a: override("a") }, excluded: new Set() },
      true,
      people,
      quiet,
    );
    assert.ok(result.errors.length);
    assert.ok(writes.every((w) => w.data.team_slug !== "a-maintainers"));
  }
});
test("extra members are removed only from the declared team", async () => {
  const { gh, writes } = fake({
    "a-maintainers": { members: ["alice", "old-person"] },
  });
  const result = await synchronize(
    gh,
    { repositories: { a: override("a") }, excluded: new Set() },
    true,
    people,
    quiet,
  );
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    writes.filter((w) => w.method === "remove").map((w) => w.data),
    [
      {
        org: "agentnameservice",
        team_slug: "a-maintainers",
        username: "old-person",
      },
    ],
  );
});
test("pause and installation scope exclude repositories", async () => {
  const { gh, writes } = fake();
  const result = await synchronize(
    gh,
    {
      repositories: { a: override("a"), uninstalled: override("other") },
      excluded: new Set(["a"]),
    },
    true,
    people,
    quiet,
  );
  assert.equal(result.changes, 0);
  assert.deepEqual(writes, []);
});

test("one TSC roster supplies one team across repository-specific Maintainers", async () => {
  const { gh, writes } = fake();
  let reads = 0;
  const result = await synchronize(
    gh,
    {
      repositories: { a: override("a"), b: override("b") },
      excluded: new Set(),
    },
    true,
    async (client, name) => {
      if (name === "governance") reads++;
      return people(client, name);
    },
    quiet,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(reads, 1);
  assert.equal(
    writes.filter((w) => w.method === "create" && w.data.name === "tsc").length,
    1,
  );
  assert.deepEqual(
    writes
      .filter((w) => w.method === "add" && w.data.team_slug === "tsc")
      .map((w) => w.data.username),
    ["tsc-member"],
  );
  assert.deepEqual(
    writes
      .filter((w) => w.method === "grant" && w.data.team_slug === "tsc")
      .map((w) => [w.data.repo, w.data.permission]),
    [
      ["a", "push"],
      ["b", "push"],
    ],
  );
  assert.ok(
    !writes.some(
      (w) =>
        w.method === "add" &&
        w.data.team_slug !== "tsc" &&
        w.data.username === "tsc-member",
    ),
  );
});

test("missing TSC source blocks TSC writes but not independent Maintainers", async () => {
  const { gh, writes } = fake();
  const result = await synchronize(
    gh,
    { repositories: { a: override("a") }, excluded: new Set() },
    true,
    async (client, name) => {
      if (name === "governance") throw new Error("missing TSC roster");
      return people(client, name);
    },
    quiet,
  );
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /missing TSC/);
  assert.ok(writes.length > 0);
  assert.ok(writes.every((w) => (w.data.name || w.data.team_slug) !== "tsc"));
});

test("TSC grants may cover public projects outside the current pilot", async () => {
  const { gh, writes } = fake({
    tsc: {
      members: ["tsc-member"],
      repos: [
        {
          owner: { login: "agentnameservice" },
          name: "future-pilot",
          private: false,
          archived: false,
          fork: false,
          permissions: { push: true },
        },
      ],
    },
  });
  const result = await synchronize(
    gh,
    { repositories: { a: override("a") }, excluded: new Set() },
    true,
    people,
    quiet,
  );
  assert.deepEqual(result.errors, []);
  assert.ok(
    writes.some(
      (w) =>
        w.method === "grant" &&
        w.data.team_slug === "tsc" &&
        w.data.repo === "a",
    ),
  );
});

test("TSC scope rejects private, archived, foreign, forked or elevated grants", async () => {
  const base = {
    owner: { login: "agentnameservice" },
    name: "outside",
    private: false,
    archived: false,
    fork: false,
    permissions: { push: true },
  };
  for (const stateOverride of [
    { private: true },
    { archived: true },
    { fork: true },
    { owner: { login: "other" } },
    { permissions: { push: true, maintain: true } },
    { name: "governance-archieve" },
  ]) {
    const { gh, writes } = fake({
      tsc: { members: ["tsc-member"], repos: [{ ...base, ...stateOverride }] },
    });
    const result = await synchronize(
      gh,
      { repositories: { a: override("a") }, excluded: new Set() },
      true,
      people,
      quiet,
    );
    assert.ok(result.errors.length);
    assert.ok(writes.every((w) => (w.data.name || w.data.team_slug) !== "tsc"));
  }
});

test("TSC membership removal leaves repository roles intact", async () => {
  const { gh, writes } = fake({
    tsc: { members: ["alice", "tsc-member"] },
    "a-maintainers": { members: ["alice"] },
  });
  const result = await synchronize(
    gh,
    { repositories: { a: override("a") }, excluded: new Set() },
    true,
    people,
    quiet,
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    writes
      .filter((w) => w.method === "remove")
      .map((w) => [w.data.team_slug, w.data.username]),
    [["tsc", "alice"]],
  );
});
