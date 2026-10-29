// SPDX-License-Identifier: Apache-2.0
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
  ensure(
    !config.deployment.restrictedRepos.exclude?.includes(name),
    `${name}: excluded from settings management by deployment-settings.yml`,
  );
  await owner(gh, actor);
  const info = await publicRepository(gh, name);
  const value = structuredClone(config.repositories[name] || {});
  const deployment = structuredClone(config.deployment);
  const peribolos = structuredClone(config.peribolos);
  let observed = [];
  const pending = [];
  if (inputs.operation === "Pause management") {
    deployment.restrictedRepos.include = [...config.included].filter(
      (repo) => repo !== name,
    );
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
    const liveTeams = await gh.paginate(gh.rest.teams.list, {
      org: ORG,
      per_page: 100,
    });
    const reviewers = [];
    for (const [displayName, settings] of Object.entries(
      peribolos.orgs[ORG].teams,
    )) {
      if (settings.repos?.[name] !== "write") continue;
      const team = liveTeams.find((team) => team.name === displayName);
      if (!team)
        pending.push(
          `Apply team ${displayName} from peribolos.yml before enrollment.`,
        );
      else if (team.slug.endsWith("-reviewers")) reviewers.push(team.slug);
    }
    const candidates = (catchall?.slice(1) || [])
      .filter(
        (owner) =>
          owner !== `@${ORG}/${TSC}` &&
          !reviewers.some((team) => owner === `@${ORG}/${team}`) &&
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
    const includeTsc = name !== REPO || catchall?.includes(`@${ORG}/${TSC}`);
    const previous =
      value.rulesets
        ?.find((r) => r.name === CHECKS)
        ?.rules?.find((r) => r.type === "required_status_checks")?.parameters
        ?.required_status_checks || [];
    const required = new Map();
    for (const check of [
      ...previous,
      ...(existing.required_status_checks?.contexts || []).map((context) => ({
        context,
      })),
      ...(existing.required_status_checks?.checks || []).map(
        ({ context, app_id }) => ({
          context,
          ...(app_id > 0 ? { integration_id: app_id } : {}),
        }),
      ),
      ...rules
        .filter((r) => r.type === "required_status_checks")
        .flatMap((r) => r.parameters.required_status_checks),
    ]) {
      const current = required.get(check.context);
      ensure(
        current?.integration_id == null ||
          check.integration_id == null ||
          current.integration_id === check.integration_id,
        `Conflicting App bindings for ${check.context}; resolve its existing requirements first`,
      );
      required.set(
        check.context,
        check.integration_id != null
          ? { ...current, ...check }
          : current || check,
      );
    }
    const selected = inputs.required_checks?.trim()
      ? new Set(
          inputs.required_checks
            .split(/[;\n]/)
            .map((c) => c.trim())
            .filter(Boolean),
        )
      : new Set(required.keys());
    selected.add("DCO");
    const queued = rules.some((rule) => rule.type === "merge_queue");
    if (!queued && !required.has("DCO"))
      required.set("DCO", { context: "DCO", integration_id: 1861 });
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
              strict_required_status_checks_policy: !queued,
              required_status_checks: [...selected]
                .sort()
                .map((context) => required.get(context) || { context }),
            },
          },
        ],
      },
      {
        name: MERGE,
        ...common,
        // Team exemptions cover only the update gate; separate rules enforce PRs and checks.
        bypass_actors: [
          mapping.maintainers,
          ...(mapping.bootstrap ? [BOOTSTRAP] : []),
        ].map((team) => ({
          actor_type: "Team",
          name: team,
          bypass_mode: "exempt",
        })),
        rules: [{ type: "update" }],
      },
    ];
    const ownerTeams = [
      ...new Set([
        mapping.maintainers,
        ...reviewers,
        ...(includeTsc ? [TSC] : []),
        ...(mapping.bootstrap ? [BOOTSTRAP] : []),
      ]),
    ];
    const requiredOwners = ownerTeams.map((team) => `@${ORG}/${team}`);
    for (const slug of [
      ...new Set([
        ...ownerTeams,
        ...(bootstrapChoice === "Remove" && name !== REPO ? [BOOTSTRAP] : []),
      ]),
    ]) {
      const team = liveTeams.find((team) => team.slug === slug);
      const desired = team && peribolos.orgs[ORG].teams[team.name];
      if (!desired) {
        pending.push(
          `Declare team ${slug} in peribolos.yml and apply its team setup first.`,
        );
        continue;
      }
      desired.repos ||= {};
      if (ownerTeams.includes(slug)) desired.repos[name] = "write";
      else delete desired.repos[name];
    }
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
    if (selected.size < 2)
      pending.push(
        "Select the actual CI checks from the observed list; requirements are not guessed.",
      );
    if ([...selected].some((c) => !observed.includes(c)))
      pending.push(
        "Run the selected checks on a representative PR before enrolling.",
      );
    deployment.restrictedRepos.include = [
      ...new Set([...config.included, name]),
    ].sort();
  }
  const result = {
    name,
    value,
    deployment,
    peribolos,
    observed,
    pending,
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
      JSON.stringify(config.deployment) !== JSON.stringify(result.deployment) ||
      JSON.stringify(config.peribolos) !== JSON.stringify(result.peribolos));
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
  if (JSON.stringify(config.peribolos) !== JSON.stringify(result.peribolos))
    await writeYaml(path.join(ROOT, "peribolos.yml"), result.peribolos);
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
    `## Related issue\n\nFixes #${result.issue}\n\n## Summary\n\n${result.report}\nTeam access is declared in peribolos.yml. Review this configuration change before merging.\n\n## Testing\n\nNative configuration validation runs in CI.\n\n## AI assistance\n\nNo AI is used by this deterministic workflow.\n`,
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
