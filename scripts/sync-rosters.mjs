// SPDX-License-Identifier: Apache-2.0
// Approved default-branch rosters -> team membership and Write grants.
import { pathToFileURL } from "node:url";
import {
  ORG,
  REPO,
  TSC,
  BOOTSTRAP,
  access,
  configuration,
  ensure,
} from "./config.mjs";
import { github, optional, owner, trustedWorkflow } from "./github.mjs";
import { roster } from "./rosters.mjs";

export async function synchronize(
  gh,
  config,
  apply = false,
  readRoster = roster,
  report = console.log,
  grantAccess = true,
) {
  const installed = new Set(
    (
      await gh.paginate("GET /installation/repositories", { per_page: 100 })
    ).map((r) => r.name),
  );
  const groups = new Map();
  const blocked = new Set();
  const errors = [];
  const active = Object.entries(config.repositories).filter(
    ([repo]) => !config.excluded.has(repo) && installed.has(repo),
  );
  if (!active.length) return { changes: 0, errors };
  const needsTsc = active.some(([, settings]) =>
    settings.teams.some((t) => t.name === TSC),
  );
  const needsBootstrap = active.some(
    ([repo, settings]) => repo === REPO || access(repo, settings).bootstrap,
  );
  let tsc, bootstrap;
  if (needsTsc)
    try {
      tsc = await readRoster(gh, "governance", config.repositories);
      ensure(
        tsc.maintainers.length && !tsc.reviewers.length,
        "Use the TSC voting roster",
      );
    } catch (error) {
      tsc = undefined;
      blocked.add(TSC);
      errors.push(`TSC: ${error.message}`);
    }
  if (needsBootstrap)
    try {
      bootstrap = await readRoster(gh, REPO, config.repositories);
      ensure(
        !bootstrap.reviewers.length,
        "The bootstrap roster contains only Maintainers",
      );
    } catch (error) {
      blocked.add(BOOTSTRAP);
      errors.push(`Bootstrap: ${error.message}`);
    }
  for (const [repo, settings] of active) {
    const mapping = access(repo, settings);
    try {
      const people =
        repo === "governance"
          ? tsc
          : repo === REPO
            ? bootstrap
            : await readRoster(gh, repo, config.repositories);
      ensure(people, "The TSC voting roster is unavailable");
      if (people.source && people.source !== repo) {
        const source = access(
          people.source,
          config.repositories[people.source],
        );
        ensure(
          mapping.maintainers === source.maintainers &&
            mapping.reviewers === source.reviewers,
          "Shared rosters must use the same teams",
        );
      }
      ensure(
        mapping.reviewers || !people.reviewers.length,
        "Declare a Reviewer team before adding Reviewers",
      );
      for (const role of ["maintainers", "reviewers"]) {
        const slug = mapping[role];
        if (!slug || slug === TSC) continue;
        const current = groups.get(slug);
        ensure(
          !current ||
            JSON.stringify(current.people) === JSON.stringify(people[role]),
          `Shared team ${slug} has conflicting rosters`,
        );
        if (current) current.repos.push(repo);
        else groups.set(slug, { people: people[role], repos: [repo] });
      }
      if (mapping.bootstrap) {
        ensure(bootstrap, "The bootstrap roster is unavailable");
        const current = groups.get(BOOTSTRAP);
        if (current) current.repos.push(repo);
        else
          groups.set(BOOTSTRAP, {
            people: bootstrap.maintainers,
            repos: [repo],
          });
      }
      if (tsc && settings.teams.some((t) => t.name === TSC)) {
        const current = groups.get(TSC);
        if (current) current.repos.push(repo);
        else groups.set(TSC, { people: tsc.maintainers, repos: [repo] });
      }
    } catch (error) {
      [
        mapping.maintainers,
        mapping.reviewers,
        mapping.bootstrap ? BOOTSTRAP : null,
      ]
        .filter(Boolean)
        .forEach((team) => blocked.add(team));
      errors.push(`${repo}: ${error.message}`);
    }
  }
  if (!groups.size) return { changes: 0, errors };
  const members = new Set(
    (
      await gh.paginate(gh.rest.orgs.listMembers, { org: ORG, per_page: 100 })
    ).map((u) => u.login.toLowerCase()),
  );
  let changes = 0;
  for (const [slug, desired] of groups) {
    if (blocked.has(slug)) continue;
    const params = { org: ORG, team_slug: slug };
    try {
      ensure(
        desired.people.every((u) => members.has(u)),
        "Invite the approved people to the organization before syncing",
      );
      const found = await optional(() => gh.rest.teams.getByName(params));
      let current = [];
      let grants = [];
      if (found) {
        ensure(
          found.data.privacy === "closed" && !found.data.parent,
          "Use a visible, unnested team",
        );
        ensure(
          !(
            await gh.paginate("GET /orgs/{org}/teams/{team_slug}/teams", params)
          ).length,
          "Nested team membership needs manual review",
        );
        current = (
          await gh.paginate(gh.rest.teams.listMembersInOrg, params)
        ).map((u) => u.login.toLowerCase());
        grants = await gh.paginate(gh.rest.teams.listReposInOrg, params);
        ensure(
          grants.every(
            (r) =>
              r.owner.login === ORG &&
              ([TSC, BOOTSTRAP].includes(slug)
                ? (r.private === false ||
                    (r.name === "governance" && r.private === true)) &&
                  r.archived === false &&
                  r.fork === false &&
                  r.name !== "governance-archieve"
                : desired.repos.includes(r.name)),
          ),
          "Team has repository grants outside its permitted scope",
        );
        ensure(
          grants.every((r) => !r.permissions.admin && !r.permissions.maintain),
          "Existing elevated grants need manual review",
        );
      }
      const additions = desired.people.filter((u) => !current.includes(u));
      const removals = current.filter((u) => !desired.people.includes(u));
      const newGrants = grantAccess
        ? desired.repos.filter(
            (repo) =>
              !grants.some((r) => r.name === repo && r.permissions.push),
          )
        : [];
      const count =
        Number(!found) + additions.length + removals.length + newGrants.length;
      changes += count;
      report(
        `${slug}: ${found ? "existing team" : "create team"}, add ${additions.length}, remove ${removals.length}, grant Write on ${newGrants.length} repositories${apply ? "" : " (preview)"}`,
      );
      if (!apply) continue;
      if (!found)
        await gh.rest.teams.create({
          org: ORG,
          name: slug,
          privacy: "closed",
          description: "Membership follows the ANS repository rosters",
        });
      for (const username of removals)
        await gh.rest.teams.removeMembershipForUserInOrg({
          ...params,
          username,
        });
      for (const username of additions)
        await gh.rest.teams.addOrUpdateMembershipForUserInOrg({
          ...params,
          username,
          role: "member",
        });
      for (const repo of newGrants)
        await gh.rest.teams.addOrUpdateRepoPermissionsInOrg({
          ...params,
          owner: ORG,
          repo,
          permission: "push",
        });
    } catch (error) {
      errors.push(`${slug}: ${error.message}`);
    }
  }
  return { changes, errors };
}

async function main() {
  const apply = process.env.APPLY === "true";
  const gh = github();
  if (apply) {
    trustedWorkflow();
    if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch")
      await owner(gh, process.env.REQUESTER);
  }
  const result = await synchronize(
    gh,
    await configuration(),
    apply,
    roster,
    console.log,
    process.env.GRANT_ACCESS !== "false",
  );
  for (const error of result.errors) console.error(error);
  ensure(
    !result.errors.length,
    `${result.errors.length} roster/team problems need attention; independent teams were still processed`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
