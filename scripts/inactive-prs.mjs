// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { github, optional } from "./github.mjs";

const DAY = 24 * 60 * 60 * 1000;
const WAITING = "awaiting-author";
const STALE = "stale";
const REMINDER = /<!-- ans-inactive-pr head:([a-f0-9]{40}) -->/;

async function snapshot(gh, owner, repo, number) {
  const { repository } = await gh.graphql(`
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          state isDraft headRefOid updatedAt author { login }
          reviewDecision reviewRequests(first: 1) { totalCount }
          labels(first: 100) { nodes { name } pageInfo { hasNextPage } }
        }
      }
    }`, { owner, repo, number });
  const pr = repository.pullRequest;
  const labels = pr.labels.pageInfo.hasNextPage
    ? await gh.paginate(gh.rest.issues.listLabelsOnIssue, { owner, repo, issue_number: number, per_page: 100 })
    : pr.labels.nodes;
  return { ...pr, labels: new Set(labels.map((label) => label.name)) };
}

function waiting(pr) {
  return pr.state === "OPEN" && !pr.isDraft &&
    pr.reviewDecision === "CHANGES_REQUESTED" && pr.reviewRequests.totalCount === 0;
}

export async function processPullRequest(gh, owner, repo, number, event = {}, now = Date.now(), dryRun = true) {
  const params = { owner, repo, issue_number: number };
  const pr = await snapshot(gh, owner, repo, number);
  async function remove(label) {
    if (!dryRun && pr.labels.has(label))
      await optional(() => gh.rest.issues.removeLabel({ ...params, name: label }));
  }
  async function restart() {
    await remove(STALE);
    await remove(WAITING);
    if (!dryRun) await gh.rest.issues.addLabels({ ...params, labels: [WAITING] });
    return dryRun ? "would start a new 60-day author-response period" : "started a new 60-day author-response period";
  }
  async function unchanged() {
    const current = await snapshot(gh, owner, repo, number);
    return waiting(current) && current.headRefOid === pr.headRefOid && current.updatedAt === pr.updatedAt;
  }
  if (!waiting(pr)) {
    await remove(STALE);
    await remove(WAITING);
    return dryRun && (pr.labels.has(STALE) || pr.labels.has(WAITING))
      ? "not waiting on the author; would remove inactivity labels" : "not waiting on the author";
  }
  if (!pr.labels.has(WAITING) || event.action === "synchronize" ||
      (event.action === "unlabeled" && event.label?.name === STALE)) {
    return restart();
  }

  const events = await gh.paginate(gh.rest.issues.listEvents, { ...params, per_page: 100 });
  const startedAt = Math.max(0, ...events
    .filter((entry) => entry.event === "labeled" && entry.label?.name === WAITING)
    .map((entry) => Date.parse(entry.created_at)));
  if (!startedAt) return "no author-response timestamp available; left unchanged";
  if (events.some((entry) => entry.event === "unlabeled" && entry.label?.name === STALE &&
      Date.parse(entry.created_at) > startedAt)) return restart();
  const since = new Date(startedAt).toISOString();
  const [comments, reviewComments, reviews] = await Promise.all([
    gh.paginate(gh.rest.issues.listComments, { ...params, since, per_page: 100 }),
    gh.paginate(gh.rest.pulls.listReviewComments, { owner, repo, pull_number: number, since, per_page: 100 }),
    gh.paginate(gh.rest.pulls.listReviews, { owner, repo, pull_number: number, per_page: 100 }),
  ]);
  const authorResponded = [...comments, ...reviewComments].some((comment) =>
    comment.user?.login === pr.author?.login && Date.parse(comment.updated_at) > startedAt);
  const reviewActivity = reviews.some((review) => Date.parse(review.submitted_at) > startedAt &&
    (review.state === "CHANGES_REQUESTED" || (review.user?.login === pr.author?.login && review.body?.trim())));
  if (authorResponded || reviewActivity) return restart();

  const reminder = comments
    .filter((comment) => comment.user?.login === "github-actions[bot]" &&
      REMINDER.test(comment.body) && Date.parse(comment.created_at) >= startedAt + 60 * DAY)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  // Bind the warning to the code that was reviewed, including pushes missed by event delivery.
  if (reminder && reminder.body.match(REMINDER)[1] !== pr.headRefOid) return restart();
  if (!await unchanged()) return "PR changed during inspection; left unchanged";

  if (pr.labels.has(STALE) && reminder) {
    if (now - Date.parse(reminder.created_at) < 30 * DAY) return "within the reminder period";
    if (dryRun) return "would close after the author-response and reminder periods";
    await gh.rest.pulls.update({ owner, repo, pull_number: number, state: "closed" });
    await remove(STALE);
    await remove(WAITING);
    await gh.rest.issues.createComment({
      ...params,
      body: "Closed after 60 days waiting on the author and a further 30 days without an author response to the reminder. Reopen this PR when ready to continue and re-request review. Related issues remain open.",
    });
    return "closed after the author-response and reminder periods";
  }
  if (now - startedAt < 60 * DAY) {
    await remove(STALE);
    return dryRun && pr.labels.has(STALE)
      ? "within the author-response period; would remove the premature stale label" : "within the author-response period";
  }
  if (dryRun) return reminder ? "would restore stale; the reminder was already posted" : "would remind the author and mark stale";
  // A manually added stale label cannot substitute for a dated reminder from this workflow.
  if (!reminder) {
    await gh.rest.issues.createComment({
      ...params,
      body: `This PR has been waiting on its author for 60 days with no author response. Please push an update, reply, or re-request review. If it is still waiting on the author in 30 days, it will be closed; it can be reopened later.\n\n<!-- ans-inactive-pr head:${pr.headRefOid} -->`,
    });
  }
  await gh.rest.issues.addLabels({ ...params, labels: [STALE] });
  return "reminded the author and marked stale";
}

export async function run(gh, repository, eventName, event, dryRun = true) {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must identify the caller repository");
  if (eventName === "issue_comment" && !event.issue?.pull_request) return;
  if (["labeled", "unlabeled"].includes(event.action) &&
      ![WAITING, STALE].includes(event.label?.name)) return;
  const number = event.pull_request?.number || event.issue?.number;
  if (!number && !["schedule", "workflow_dispatch"].includes(eventName)) return;
  const numbers = number ? [number] : (await gh.paginate(gh.rest.pulls.list, {
    owner, repo, state: "open", per_page: 100,
  })).map((pr) => pr.number);
  const results = [];
  for (const candidate of numbers) {
    const result = await processPullRequest(gh, owner, repo, candidate, event, Date.now(), dryRun);
    const line = `#${candidate}: ${result}`;
    console.log(line);
    results.push(line);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const dryRun = process.env.DRY_RUN !== "false";
  const results = await run(github(), process.env.GITHUB_REPOSITORY, process.env.GITHUB_EVENT_NAME, event, dryRun);
  if (process.env.GITHUB_STEP_SUMMARY && results?.length)
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## Inactive PRs (${dryRun ? "dry-run; no changes made" : "active"})\n\n${results.map((line) => `- ${line}`).join("\n")}\n`);
}
