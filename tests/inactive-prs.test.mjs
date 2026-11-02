// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { processPullRequest, run } from "../scripts/inactive-prs.mjs";

const DAY = 86_400_000;
const START = Date.parse("2026-01-01T00:00:00Z");
function fixture() {
  let now = START;
  let nextCommentId = 1;
  const labels = new Set();
  const events = [];
  const comments = [];
  const reviewComments = [];
  const reviews = [];
  const calls = [];
  const pr = {
    state: "OPEN", isDraft: false, headRefOid: "a".repeat(40),
    updatedAt: new Date(now).toISOString(), author: { login: "author" },
    reviewDecision: "CHANGES_REQUESTED", reviewRequests: { totalCount: 0 },
  };
  const stamp = () => { pr.updatedAt = new Date(now).toISOString(); };
  const gh = {
    graphql: async () => ({ repository: { pullRequest: {
      ...pr, labels: { nodes: [...labels].map((name) => ({ name })), pageInfo: { hasNextPage: false } },
    } } }),
    paginate: async (route, params) => {
      calls.push([route, params]);
      if (route === "events") return events;
      if (route === "comments") return comments.filter((comment) => !params.since || Date.parse(comment.updated_at) > Date.parse(params.since));
      if (route === "reviewComments") return reviewComments;
      if (route === "reviews") return reviews;
      if (route === "pulls") return [{ number: 1 }];
      throw new Error(`Unexpected route: ${route}`);
    },
    rest: {
      issues: {
        listEvents: "events", listComments: "comments",
        addLabels: async ({ labels: additions }) => {
          for (const name of additions) {
            if (!labels.has(name)) events.push({ event: "labeled", label: { name }, created_at: new Date(now).toISOString() });
            labels.add(name);
          }
          stamp();
        },
        removeLabel: async ({ name }) => {
          labels.delete(name);
          events.push({ event: "unlabeled", label: { name }, actor: { login: "github-actions[bot]" }, created_at: new Date(now).toISOString() });
          stamp();
        },
        createComment: async ({ body }) => {
          comments.push({ id: nextCommentId++, body, user: { login: "github-actions[bot]" }, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() });
          stamp();
        },
        updateComment: async ({ comment_id, body }) => {
          const comment = comments.find((entry) => entry.id === comment_id);
          assert.ok(comment, `Unknown comment: ${comment_id}`);
          comment.body = body;
          comment.updated_at = new Date(now).toISOString();
          stamp();
        },
      },
      pulls: {
        list: "pulls", listReviewComments: "reviewComments", listReviews: "reviews",
        update: async ({ state }) => { pr.state = state.toUpperCase(); stamp(); },
      },
    },
  };
  return {
    gh, pr, labels, events, comments, reviewComments, reviews, calls,
    day: (day) => { now = START + day * DAY; },
    tick: (event = {}, dryRun = false) => processPullRequest(gh, "agentnameservice", "sample", 1, event, now, dryRun),
    reply: (collection = comments, login = "author") => {
      collection.push({ id: nextCommentId++, body: "Update", user: { login }, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() });
      stamp();
    },
  };
}

test("observation is the default and does not start a timer", async () => {
  const f = fixture();
  const result = await processPullRequest(f.gh, "agentnameservice", "sample", 1);
  assert.match(result, /would start/);
  assert.equal(f.labels.size, 0);
  assert.equal(f.events.length, 0);
  assert.equal(f.comments.length, 0);
});

test("dry-run performs no writes for any inactivity transition", async () => {
  const scenarios = [
    async () => {},
    async (f) => { await f.tick(); f.pr.isDraft = true; },
    async (f) => { await f.tick(); f.day(10); f.labels.add("stale"); },
    async (f) => { await f.tick(); f.day(60); },
    async (f) => { await f.tick(); f.day(60); await f.tick(); f.day(90); },
    async (f) => { await f.tick(); f.day(60); await f.tick(); f.day(70); f.reply(); },
    async (f) => { await f.tick(); f.day(60); await f.tick(); f.pr.headRefOid = "b".repeat(40); },
  ];
  for (const prepare of scenarios) {
    const f = fixture();
    await prepare(f);
    const forbidden = async () => { assert.fail("Dry-run attempted a write"); };
    f.gh.rest.issues.addLabels = forbidden;
    f.gh.rest.issues.removeLabel = forbidden;
    f.gh.rest.issues.createComment = forbidden;
    f.gh.rest.issues.updateComment = forbidden;
    f.gh.rest.pulls.update = forbidden;
    assert.match(await f.tick({}, true), /would/);
  }
});

test("a timer begins at activation after an observation period", async () => {
  const f = fixture();
  await f.tick({}, true);
  f.day(100); await f.tick({}, true);
  assert.equal(f.labels.size, 0);
  await f.tick();
  f.day(159); await f.tick();
  assert.equal(f.comments.length, 1);
  f.day(160); await f.tick();
  assert.ok(f.labels.has("stale"));
  f.day(189); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  f.day(190); await f.tick();
  assert.equal(f.pr.state, "CLOSED");
});

test("a PR gets a full 60-day response period and 30-day reminder period", async () => {
  const f = fixture();
  await f.tick();
  assert.deepEqual([...f.labels], ["awaiting-author"]);
  assert.equal(f.comments.length, 1);
  f.day(59); await f.tick();
  assert.equal(f.comments.length, 1);
  f.day(60); await f.tick();
  assert.ok(f.labels.has("stale"));
  assert.equal(f.comments.length, 2);
  f.day(89); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  f.day(90); await f.tick();
  assert.equal(f.pr.state, "CLOSED");
  assert.equal(f.labels.size, 0);
  assert.match(f.comments.at(-1).body, /Related issues remain open/);
});

test("drafts, closed PRs, approvals, and pending reviews clear author-wait labels", async () => {
  for (const update of [
    { isDraft: true }, { state: "CLOSED" }, { reviewDecision: "APPROVED" },
    { reviewDecision: null }, { reviewDecision: "REVIEW_REQUIRED" }, { reviewRequests: { totalCount: 1 } },
  ]) {
    const f = fixture();
    await f.tick(); f.day(60); await f.tick();
    Object.assign(f.pr, update);
    f.day(100); await f.tick();
    assert.equal(f.labels.size, 0);
    assert.equal(f.comments.length, 2);
  }
});

test("author replies in either comment channel reset the complete period", async () => {
  for (const channel of ["comments", "reviewComments"]) {
    const f = fixture();
    await f.tick(); f.day(60); await f.tick();
    f.day(70); f.reply(f[channel]); await f.tick();
    assert.ok(!f.labels.has("stale"));
    f.day(100); await f.tick();
    assert.equal(f.pr.state, "OPEN");
    assert.ok(!f.labels.has("stale"));
    f.day(130); await f.tick();
    assert.ok(f.labels.has("stale"));
    f.day(159); await f.tick();
    assert.equal(f.pr.state, "OPEN");
    f.day(160); await f.tick();
    assert.equal(f.pr.state, "CLOSED");
  }
});

test("replies and pushes reuse one period comment while preserving the full deadline", async () => {
  const f = fixture();
  await f.tick();
  const marker = { ...f.comments[0] };
  f.day(1); f.reply(); await f.tick();
  f.day(3); f.reply(); await f.tick();
  f.day(5); f.pr.headRefOid = "b".repeat(40); await f.tick({ action: "synchronize" });
  const markers = f.comments.filter((comment) => comment.user.login === "github-actions[bot]");
  assert.equal(markers.length, 1);
  assert.equal(markers[0].id, marker.id);
  assert.equal(markers[0].created_at, marker.created_at);
  assert.equal(markers[0].updated_at, new Date(START + 5 * DAY).toISOString());
  assert.ok(markers[0].body.includes(`waiting head:${f.pr.headRefOid}`));
  f.day(64); await f.tick();
  assert.ok(!f.labels.has("stale"));
  f.day(65); await f.tick();
  assert.ok(f.labels.has("stale"));
  f.day(94); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  f.day(95); await f.tick();
  assert.equal(f.pr.state, "CLOSED");
});

test("a new waiting period reuses the comment from before reviewer handoff", async () => {
  const f = fixture();
  await f.tick();
  const markerId = f.comments[0].id;
  f.day(10); f.pr.reviewRequests.totalCount = 1; await f.tick();
  assert.equal(f.labels.size, 0);
  f.day(20); f.pr.reviewRequests.totalCount = 0; await f.tick();
  assert.equal(f.comments.length, 1);
  assert.equal(f.comments[0].id, markerId);
  assert.equal(f.comments[0].updated_at, new Date(START + 20 * DAY).toISOString());
  f.day(79); await f.tick();
  assert.ok(!f.labels.has("stale"));
  f.day(80); await f.tick();
  assert.ok(f.labels.has("stale"));
});

test("edited author replies reset the period", async () => {
  const f = fixture();
  f.reply(); await f.tick(); f.day(60); await f.tick();
  f.comments[0].updated_at = new Date(START + 70 * DAY).toISOString();
  f.day(70); await f.tick();
  assert.ok(!f.labels.has("stale"));
});

test("new change requests and author review summaries restart the full period", async () => {
  for (const review of [
    { state: "CHANGES_REQUESTED", user: { login: "reviewer" }, body: "Please adjust the API." },
    { state: "COMMENTED", user: { login: "author" }, body: "Here is the remaining work." },
  ]) {
    const f = fixture();
    await f.tick(); f.day(60); await f.tick();
    f.reviews.push({ ...review, submitted_at: new Date(START + 80 * DAY).toISOString() });
    f.day(90); await f.tick();
    assert.equal(f.pr.state, "OPEN");
    assert.ok(!f.labels.has("stale"));
  }
});

test("bot and reviewer comments do not reset the author-response clock", async () => {
  const f = fixture();
  await f.tick(); f.day(50); f.reply(f.comments, "another-bot[bot]"); await f.tick();
  f.day(60); await f.tick();
  assert.ok(f.labels.has("stale"));
  f.day(80); f.reply(f.comments, "reviewer"); await f.tick();
  f.day(90); await f.tick();
  assert.equal(f.pr.state, "CLOSED");
});

test("a push or manual removal of stale restarts the full response period", async () => {
  for (const event of [{ action: "synchronize" }, { action: "unlabeled", label: { name: "stale" } }]) {
    const f = fixture();
    await f.tick(); f.day(60); await f.tick();
    f.day(80); await f.tick(event);
    assert.ok(!f.labels.has("stale"));
    f.day(110); await f.tick();
    assert.equal(f.pr.state, "OPEN");
    assert.ok(!f.labels.has("stale"));
  }
});

test("a changed head cannot be closed using a warning for earlier code", async () => {
  const f = fixture();
  await f.tick(); f.day(60); await f.tick();
  f.pr.headRefOid = "b".repeat(40);
  f.day(90); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  assert.ok(!f.labels.has("stale"));
});

test("a missed push before the reminder starts a fresh full response period", async () => {
  const f = fixture();
  await f.tick();
  f.day(30); f.pr.headRefOid = "b".repeat(40);
  f.day(60); await f.tick();
  assert.ok(!f.labels.has("stale"));
  f.day(90); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  f.day(120); await f.tick();
  assert.ok(f.labels.has("stale"));
  f.day(149); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  f.day(150); await f.tick();
  assert.equal(f.pr.state, "CLOSED");
});

test("bot cleanup does not defer the author-response clock", async () => {
  const f = fixture();
  await f.tick();
  f.day(10); f.labels.add("stale"); await f.tick();
  f.day(11); await f.tick({ action: "unlabeled", label: { name: "stale" }, sender: { login: "github-actions[bot]" } });
  f.day(60); await f.tick();
  assert.ok(f.labels.has("stale"));
  f.day(90); await f.tick();
  assert.equal(f.pr.state, "CLOSED");
});

test("a missing or contributor-forged period marker starts a fresh timer", async () => {
  for (const forged of [false, true]) {
    const f = fixture();
    await f.tick();
    f.comments.length = 0;
    if (forged) {
      f.day(50); f.reply(f.comments, "contributor");
      f.comments[0].body = `<!-- ans-inactive-pr waiting head:${f.pr.headRefOid} -->`;
    }
    f.day(90); await f.tick();
    assert.equal(f.pr.state, "OPEN");
    assert.ok(!f.labels.has("stale"));
    f.day(149); await f.tick();
    assert.ok(!f.labels.has("stale"));
    f.day(150); await f.tick();
    assert.ok(f.labels.has("stale"));
  }
});

test("label history preserves a manual deferral if its workflow event was missed", async () => {
  const f = fixture();
  await f.tick(); f.day(60); await f.tick();
  f.labels.delete("stale");
  f.events.push({ event: "unlabeled", label: { name: "stale" }, created_at: new Date(START + 80 * DAY).toISOString() });
  f.day(90); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  assert.ok(!f.labels.has("stale"));
});

test("a manually applied stale label cannot bypass the reminder", async () => {
  const f = fixture();
  await f.tick(); f.day(10); f.labels.add("stale"); await f.tick();
  assert.ok(!f.labels.has("stale"));
  f.day(90); f.labels.add("stale"); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  assert.equal(f.comments.length, 2);
  f.day(119); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  f.day(120); await f.tick();
  assert.equal(f.pr.state, "CLOSED");
});

test("contributor text cannot impersonate the workflow's reminder", async () => {
  const f = fixture();
  await f.tick();
  f.day(60); f.reply(f.comments, "contributor");
  f.comments.at(-1).body = `<!-- ans-inactive-pr head:${f.pr.headRefOid} -->`;
  f.labels.add("stale");
  f.day(90); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  assert.equal(f.comments.length, 3);
});

test("missing timer history does not guess a closure date", async () => {
  const f = fixture();
  f.labels.add("awaiting-author"); f.labels.add("stale");
  f.day(200); await f.tick();
  assert.equal(f.pr.state, "OPEN");
  assert.equal(f.comments.length, 0);
});

test("an update during inspection prevents automatic closure", async () => {
  const f = fixture();
  await f.tick(); f.day(60); await f.tick(); f.day(90);
  const read = f.gh.graphql;
  let calls = 0;
  f.gh.graphql = async (...args) => {
    if (++calls === 2) f.pr.reviewRequests.totalCount = 1;
    return read(...args);
  };
  await f.tick();
  assert.equal(f.pr.state, "OPEN");
  assert.equal(f.comments.length, 2);
});

test("scheduled sweeps paginate open PRs and activity", async (t) => {
  t.mock.method(console, "log", () => {});
  const f = fixture();
  const paginate = f.gh.paginate;
  f.gh.paginate = async (route, params) => route === "pulls"
    ? Array.from({ length: 201 }, (_, i) => ({ number: i + 1 }))
    : paginate(route, params);
  let processed = 0;
  f.gh.graphql = async () => {
    processed++;
    return { repository: { pullRequest: { ...f.pr, reviewDecision: "APPROVED", labels: { nodes: [], pageInfo: { hasNextPage: false } } } } };
  };
  await run(f.gh, "agentnameservice/sample", "schedule", {});
  assert.equal(processed, 201);
  const activity = fixture();
  await activity.tick(); activity.day(60); await activity.tick();
  for (const route of ["events", "comments", "reviewComments", "reviews"])
    assert.ok(activity.calls.some(([name, params]) => name === route && params.per_page === 100));
});

test("ordinary issues and unrelated labels do not run PR automation", async () => {
  const f = fixture();
  f.gh.graphql = async () => { throw new Error("Should not inspect a PR"); };
  await run(f.gh, "agentnameservice/sample", "issue_comment", { issue: { number: 1 } });
  await run(f.gh, "agentnameservice/sample", "pull_request_target", { action: "labeled", label: { name: "proposal" }, pull_request: { number: 1 } });
});
