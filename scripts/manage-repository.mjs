// SPDX-License-Identifier: Apache-2.0
// A small form adapter: read GitHub, then edit native Safe Settings YAML for a PR.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  ROOT,
  ORG,
  REPO,
  CHECKS,
  MERGE,
  TSC,
  BOOTSTRAP,
  access,
  codeOwners,
  configuration,
  ensure,
  repositoryName,
  writeYaml,
} from "./config.mjs";
import {
  github,
  optional,
  owner,
  publicRepository,
  head,
  textFile,
  trustedWorkflow,
} from "./github.mjs";
import { roster } from "./rosters.mjs";

export function signoff(inputs) {
  ensure(
    String(inputs.certify_dco) === "true",
    "Certify the DCO before requesting a commit",
  );
  const value = String(inputs.signoff || "").trim();
  ensure(
    /^[^<>\x00-\x1f]{2,120} <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/.test(value),
    "Supply your own Full Name <email>; it will appear in the commit",
  );
  return value;
}

export async function observedChecks(gh, repo, sha) {
  const prs = await gh.rest.pulls.list({
    owner: ORG,
    repo,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: 5,
  });
  const checks = new Set();
  for (const ref of new Set([sha, ...prs.data.map((p) => p.head.sha)])) {
    const runs = await gh.paginate(gh.rest.checks.listForRef, {
      owner: ORG,
      repo,
      ref,
      per_page: 100,
    });
    const statuses = await gh.paginate(gh.rest.repos.listCommitStatusesForRef, {
      owner: ORG,
      repo,
      ref,
      per_page: 100,
    });
    runs.forEach((c) => checks.add(c.name));
    statuses.forEach((c) => checks.add(c.context));
  }
  return [...checks].sort();
}

export function codeOwnerEntries(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));
}

export async function prepare(gh, config, inputs, actor) {
  const name = repositoryName(inputs.repository);
  ensure(
    ["Inspect repository", "Enroll or update", "Pause management"].includes(
      inputs.operation,
    ),
    "Choose a supported operation",
  );
  await owner(gh, actor);
  const info = await publicRepository(gh, name);
  const value = structuredClone(config.repositories[name] || {});
  const deployment = structuredClone(config.deployment);
  let observed = [];
  const pending = [];
  let affected = [name];
  if (inputs.operation === "Pause management") {
    if (config.repositories[name]) {
      const team = access(name, value).maintainers;
      affected = Object.entries(config.repositories)
        .filter(([n, c]) => access(n, c).maintainers === team)
        .map(([n]) => n);
    }
    deployment.restrictedRepos.exclude = [
      ...new Set([...config.excluded, ...affected]),
    ].sort();
  } else {
    const sha = await head(gh, name, info.default_branch);
    const existing =
      (
        await optional(() =>
          gh.rest.repos.getBranchProtection({
            owner: ORG,
            repo: name,
            branch: info.default_branch,
          }),
        )
      )?.data || {};
    const rules = await gh.paginate(
      "GET /repos/{owner}/{repo}/rules/branches/{branch}",
      { owner: ORG, repo: name, branch: info.default_branch },
    );
    observed = await observedChecks(gh, name, sha);
    const owners = await textFile(gh, name, ".github/CODEOWNERS", sha);
    const entries = codeOwnerEntries(owners);
    const catchall = entries.filter((entry) => entry[0] === "*").at(-1);
    const candidates = (catchall?.slice(1) || [])
      .filter(
        (owner) =>
          owner !== `@${ORG}/${TSC}` &&
          (name === REPO || owner !== `@${ORG}/${BOOTSTRAP}`),
      )
      .map(
        (owner) =>
          owner.match(/^@agentnameservice\/([a-z\d]+(?:-[a-z\d]+)*)$/)?.[1],
      );
    const mapping = config.repositories[name]
      ? access(name, value)
      : {
          maintainers:
            (candidates.length === 1 && candidates[0]) ||
            { ".github": "tsc-owners", governance: "tsc" }[name] ||
            `${name.replace(/[^a-z\d]+/g, "-")}-maintainers`,
        };
    if (!mapping.reviewers && ![".github", "governance"].includes(name))
      mapping.reviewers =
        mapping.maintainers.replace(/-maintainers$/, "") + "-reviewers";
    const bootstrapChoice = inputs.bootstrap_access || "Keep current";
    ensure(
      ["Keep current", "Enable", "Remove"].includes(bootstrapChoice),
      "Choose a supported bootstrap access option",
    );
    mapping.bootstrap =
      name !== REPO &&
      (bootstrapChoice === "Enable" ||
        (bootstrapChoice === "Keep current" &&
          (config.repositories[name] ? mapping.bootstrap : true)));
    const includeTsc =
      name !== REPO ||
      value.teams?.some((t) => t.name === TSC) ||
      catchall?.includes(`@${ORG}/${TSC}`);
    const previous =
      value.rulesets
        ?.find((r) => r.name === CHECKS)
        ?.rules?.find((r) => r.type === "required_status_checks")?.parameters
        ?.required_status_checks || [];
    const required = new Set([
      ...previous.map((c) => c.context),
      ...(existing.required_status_checks?.contexts || []),
      ...(existing.required_status_checks?.checks || []).map((c) => c.context),
    ]);
    for (const rule of rules) {
      if (rule.type === "required_status_checks")
        rule.parameters.required_status_checks.forEach((c) =>
          required.add(c.context),
        );
    }
    const selected = inputs.required_checks?.trim()
      ? new Set(
          inputs.required_checks
            .split(/[;\n]/)
            .map((c) => c.trim())
            .filter(Boolean),
        )
      : required;
    selected.add("DCO");
    value.teams = [
      ...new Set(
        [
          mapping.maintainers,
          mapping.reviewers,
          ...(includeTsc ? [TSC] : []),
          ...(mapping.bootstrap ? [BOOTSTRAP] : []),
        ].filter(Boolean),
      ),
    ].map((team) => ({ name: team, permission: "push" }));
    const common = {
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    };
    value.rulesets = [
      ...(value.rulesets || []).filter(
        (r) => ![CHECKS, MERGE].includes(r.name),
      ),
      {
        name: CHECKS,
        ...common,
        bypass_actors: [],
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              strict_required_status_checks_policy: true,
              required_status_checks: [...selected]
                .filter((c) => c !== "DCO")
                .sort()
                .map((context) => ({ context })),
            },
          },
        ],
      },
      {
        name: MERGE,
        ...common,
        // Bootstrap access is explicit native YAML and never bypasses DCO/CI.
        bypass_actors: [
          mapping.maintainers,
          ...(mapping.bootstrap ? [BOOTSTRAP] : []),
        ].map((team) => ({
          actor_type: "Team",
          name: team,
          bypass_mode: "pull_request",
        })),
        rules: [{ type: "update" }],
      },
    ];
    const requiredOwners = codeOwners(name, value).map(
      (team) => `@${ORG}/${team}`,
    );
    if (
      JSON.stringify([...(catchall?.slice(1) || [])].sort()) !==
      JSON.stringify([...requiredOwners].sort())
    )
      pending.push(`Merge CODEOWNERS with * ${requiredOwners.join(" ")}.`);
    for (const team of [
      includeTsc ? TSC : null,
      mapping.bootstrap ? BOOTSTRAP : null,
    ].filter(Boolean))
      if (entries.some((entry) => !entry.slice(1).includes(`@${ORG}/${team}`)))
        pending.push(
          `Include @${ORG}/${team} on every CODEOWNERS rule, including path-specific overrides.`,
        );
    try {
      await roster(gh, name, { ...config.repositories, [name]: value });
      if (includeTsc && name !== "governance")
        await roster(gh, "governance", config.repositories);
      if (mapping.bootstrap) await roster(gh, REPO, config.repositories);
    } catch (error) {
      pending.push(error.message);
    }
    if (selected.size < 2)
      pending.push(
        "Select the actual CI checks from the observed list; requirements are not guessed.",
      );
    if ([...selected].some((c) => !observed.includes(c)))
      pending.push(
        "Run the selected checks on a representative PR before enrolling.",
      );
    deployment.restrictedRepos.exclude = [...config.excluded].filter(
      (n) => n !== name,
    );
  }
  const result = {
    name,
    value,
    deployment,
    observed,
    pending,
    affected,
    operation: inputs.operation,
  };
  result.report = `# ${name}\n\n${inputs.operation}.\n\n`;
  if (observed.length)
    result.report +=
      "Observed checks:\n" +
      observed.map((c) => "- `" + c.replace(/[\r\n`]/g, " ") + "`").join("\n") +
      "\n";
  if (pending.length)
    result.report +=
      "\nSetup needed:\n" + pending.map((p) => "- " + p).join("\n") + "\n";
  if (affected.length > 1)
    result.report +=
      "\nShared-team repositories affected: " + affected.join(", ") + ".\n";
  if (inputs.operation !== "Inspect repository") {
    ensure(!pending.length, result.report);
    result.signoff = signoff(inputs);
    const issue = String(inputs.issue || "")
      .trim()
      .replace(/^#/, "");
    ensure(
      /^[1-9]\d*$/.test(issue),
      "Supply the tracking issue number in .github",
    );
    const { data } = await gh.rest.issues.get({
      owner: ORG,
      repo: REPO,
      issue_number: Number(issue),
    });
    ensure(!data.pull_request, "Link an issue, not a pull request");
    result.issue = issue;
  }
  return result;
}

async function output(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const delimiter = "ANS_" + createHash("sha256").update(value).digest("hex");
  await fs.appendFile(
    process.env.GITHUB_OUTPUT,
    `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
  );
}

async function main() {
  trustedWorkflow();
  ensure(
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch",
    "Use the management form",
  );
  const event = JSON.parse(
    await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  const config = await configuration();
  const result = await prepare(
    github(),
    config,
    event.inputs,
    process.env.REQUESTER,
  );
  console.log(result.report);
  if (process.env.GITHUB_STEP_SUMMARY)
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, result.report);
  const updateRepo =
    result.operation !== "Pause management" &&
    JSON.stringify(config.repositories[result.name]) !==
      JSON.stringify(result.value);
  const changed =
    result.operation !== "Inspect repository" &&
    (updateRepo ||
      JSON.stringify(config.deployment) !== JSON.stringify(result.deployment));
  await output("changed", String(changed));
  if (!changed) return;
  if (updateRepo)
    await writeYaml(
      path.join(ROOT, "safe-settings/repos", result.name + ".yml"),
      result.value,
    );
  if (JSON.stringify(config.deployment) !== JSON.stringify(result.deployment))
    await writeYaml(
      path.join(ROOT, "safe-settings/deployment-settings.yml"),
      result.deployment,
    );
  const title = `chore: configure ${result.name}`;
  await output("title", title);
  await output("branch", "codex/manage-" + result.name.replaceAll(".", "-"));
  await output("author", result.signoff);
  await output(
    "commit_message",
    title + "\n\nSigned-off-by: " + result.signoff,
  );
  await fs.mkdir(path.join(ROOT, "reports"), { recursive: true });
  await fs.writeFile(
    path.join(ROOT, "reports/request.md"),
    `## Related issue\n\nFixes #${result.issue}\n\n## Summary\n\n${result.report}\nThe declared teams follow the reviewed repository rosters, including removals. Review this configuration change before merging.\n\n## Testing\n\nNative configuration validation runs in CI.\n\n## AI assistance\n\nNo AI is used by this deterministic workflow.\n`,
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
