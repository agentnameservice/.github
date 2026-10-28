// SPDX-License-Identifier: Apache-2.0
import { Octokit } from "@octokit/rest";
import { ORG, REPO, ensure, loginPattern, repositoryName } from "./config.mjs";

export function github() {
  return new Octokit({ auth: process.env.GH_TOKEN });
}
export async function optional(call) {
  try {
    return await call();
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}
export async function textFile(gh, repo, file, ref) {
  const result = await optional(() =>
    gh.rest.repos.getContent({ owner: ORG, repo, path: file, ref }),
  );
  if (!result) return null;
  ensure(
    result.data.type === "file" && result.data.encoding === "base64",
    `Expected a normal file: ${repo}/${file}`,
  );
  return Buffer.from(result.data.content, "base64").toString("utf8");
}
export async function publicRepository(gh, name) {
  return repository(gh, name, false);
}
export async function rosterRepository(gh, name) {
  return repository(gh, name, name === "governance");
}
async function repository(gh, name, allowPrivate) {
  repositoryName(name);
  const { data } = await gh.rest.repos.get({ owner: ORG, repo: name });
  ensure(
    data.full_name.toLowerCase() === `${ORG}/${name}` &&
      (allowPrivate || !data.private) &&
      !data.archived &&
      !data.fork,
    `${name}: must be ${allowPrivate ? "" : "public, "}active, non-forked, and owned by ANS`,
  );
  return data;
}
export async function head(gh, repo, branch) {
  const { data } = await gh.rest.git.getRef({
    owner: ORG,
    repo,
    ref: `heads/${branch}`,
  });
  return data.object.sha;
}
export async function owner(gh, actor) {
  ensure(loginPattern.test(actor || ""), "Invalid requester");
  const { data } = await gh.rest.orgs.getMembershipForUser({
    org: ORG,
    username: actor,
  });
  ensure(
    data.state === "active" && data.role === "admin",
    "An organization owner must make this request",
  );
}
export function trustedWorkflow() {
  ensure(
    process.env.GITHUB_REPOSITORY === `${ORG}/${REPO}` &&
      process.env.GITHUB_REF === "refs/heads/main",
    "Run this workflow on agentnameservice/.github main",
  );
}
