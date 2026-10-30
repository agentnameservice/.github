// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";

const read = (path) => yaml.load(fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

test("every shared form and automation label is provisioned by Safe Settings", () => {
  const labels = read("safe-settings/suborgs/defaults.yml").labels.include;
  const names = new Set(labels.map((label) => label.name));
  assert.equal(names.size, labels.length);
  for (const name of ["issue-required", "awaiting-author", "stale", "proposal", "needs-proposal", "accepted", "accepted-with-changes", "declined"])
    assert.ok(names.has(name), name);
  for (const directory of [".github/ISSUE_TEMPLATE/", "repo-templates/specification/ISSUE_TEMPLATE/"]) {
    for (const file of fs.readdirSync(new URL(`../${directory}`, import.meta.url))) {
      const form = read(directory + file);
      for (const name of form.labels || []) assert.ok(names.has(name), `${file}: ${name}`);
      assert.ok(form.name && form.description);
      const ids = form.body.filter((field) => field.id).map((field) => field.id);
      assert.equal(new Set(ids).size, ids.length, file);
    }
  }
});

test("GitVote thresholds implement majority and two-thirds for every eligible TSC size", () => {
  const profiles = read(".gitvote.yml").profiles;
  for (const [name, required] of [
    ["default", (n) => Math.floor(n / 2) + 1],
    ["two-thirds", (n) => Math.ceil(2 * n / 3)],
  ]) {
    const profile = profiles[name];
    assert.equal(profile.pass_threshold_base, "allowed_voters");
    assert.deepEqual(profile.allowed_voters, { teams: ["tsc"] });
    assert.equal(profile.close_on_passing, false);
    assert.equal(profile.duration, "7days");
    for (let eligible = 1; eligible <= 9; eligible++) {
      for (let yes = 0; yes <= eligible; yes++) {
        assert.equal(100 * yes / eligible >= profile.pass_threshold, yes >= required(eligible), `${name}: ${yes}/${eligible}`);
      }
    }
  }
});

test("the privileged caller uses central code and handles push and author-response events", () => {
  const caller = read("workflow-templates/ans-inactive-prs.yml");
  const workflow = read(".github/workflows/inactive-prs.yml");
  assert.equal(caller.jobs.inactive.uses, "agentnameservice/.github/.github/workflows/inactive-prs.yml@main");
  assert.ok(caller.on.pull_request_target.types.includes("synchronize"));
  assert.ok(caller.on.pull_request_target.types.includes("review_requested"));
  assert.ok(caller.on.pull_request_target.types.includes("unlabeled"));
  assert.deepEqual(caller.on.issue_comment.types, ["created", "edited"]);
  assert.ok(caller.on.schedule.length);
  assert.deepEqual(caller.permissions, workflow.permissions);
  const checkout = workflow.jobs.sweep.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.deepEqual(checkout.with, { repository: "agentnameservice/.github", ref: "main", "persist-credentials": false });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});
