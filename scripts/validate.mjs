// SPDX-License-Identifier: Apache-2.0
import { pathToFileURL } from "node:url";
import {
  ORG,
  BASELINE,
  CHECKS,
  DCO_APP,
  MERGE,
  access,
  configuration,
  ensure,
  loginPattern,
} from "./config.mjs";

function active(rule) {
  return (
    rule?.target === "branch" &&
    rule.enforcement === "active" &&
    JSON.stringify(rule.conditions?.ref_name) ===
      JSON.stringify({ include: ["~DEFAULT_BRANCH"], exclude: [] })
  );
}
export function validate(config) {
  ensure(
    config.defaults.ruleset_scope === "repo" && !config.settings.rulesets,
    "Use repository rulesets on GitHub Free",
  );
  ensure(
    config.defaults.suborgrepos.includes("*") &&
      config.defaults.suborgrepos.includes(".*"),
    "Shared defaults cover enrolled repositories",
  );
  const baseline = config.defaults.rulesets.find((r) => r.name === BASELINE);
  ensure(
    active(baseline) && baseline.bypass_actors?.length === 0,
    "The baseline has no bypass actors",
  );
  const rules = new Map(baseline.rules.map((r) => [r.type, r]));
  const review = rules.get("pull_request")?.parameters;
  ensure(
    rules.has("deletion") &&
      rules.has("non_fast_forward") &&
      review?.required_approving_review_count >= 1 &&
      review.dismiss_stale_reviews_on_push &&
      review.require_code_owner_review &&
      review.required_review_thread_resolution,
    "Keep baseline branch and review protections",
  );
  const baselineChecks = rules.get("required_status_checks")?.parameters;
  ensure(
    baselineChecks?.strict_required_status_checks_policy === false &&
      baselineChecks.required_status_checks.some(
        (c) => c.context === "DCO" && c.integration_id === DCO_APP,
      ),
    "The shared DCO check must require the DCO App",
  );
  for (const plugin of [
    "repository",
    "archive",
    "branches",
    "teams",
    "collaborators",
    "app_installations",
  ])
    ensure(
      config.settings.disable_plugins.includes(plugin),
      `Keep ${plugin} outside Safe Settings ownership`,
    );
  ensure(
    config.settings.additive_plugins.includes("rulesets") &&
      config.settings.additive_plugins.includes("labels"),
    "Preserve unrelated rules and labels",
  );
  const excluded = config.deployment.restrictedRepos.exclude || [];
  ensure(Array.isArray(excluded), "Repository exclusions must be a list");
  // Safe Settings prioritizes include over exclude.
  ensure(
    [...config.included].every((name) => !excluded.includes(name)),
    "Keep excluded repositories outside the settings scope",
  );
  for (const name of config.included)
    ensure(
      config.repositories[name],
      `${name}: included repositories need a configuration`,
    );
  for (const [name, settings] of Object.entries(config.repositories)) {
    access(name, settings);
    ensure(
      !settings.teams && !settings.rulesets.some((r) => r.name === BASELINE),
      `${name}: team grants belong in peribolos.yml and baseline rules in defaults.yml`,
    );
    const ci = settings.rulesets.find((r) => r.name === CHECKS);
    ensure(
      active(ci) &&
        !ci.bypass_actors.length &&
        ci.rules.length === 1 &&
        ci.rules[0].type === "required_status_checks",
      `${name}: CI requirements have no bypass`,
    );
    const checks = ci.rules[0].parameters;
    ensure(
      typeof checks.strict_required_status_checks_policy === "boolean" &&
        checks.required_status_checks.length &&
        checks.required_status_checks.every(
          (c) =>
            typeof c.context === "string" &&
            c.context.trim() &&
            !/[\x00-\x1f]/.test(c.context),
        ),
      `${name}: require named CI checks`,
    );
    ensure(
      checks.required_status_checks.some((c) => c.context === "DCO") &&
        checks.required_status_checks
          .filter((c) => c.context === "DCO")
          .every((c) => c.integration_id === DCO_APP),
      `${name}: DCO must require the DCO App`,
    );
    const gate = settings.rulesets.find((r) => r.name === MERGE);
    ensure(
      active(gate) &&
        gate.rules.length === 1 &&
        gate.rules[0].type === "update" &&
        !gate.rules[0].parameters?.update_allows_fetch_and_merge,
      `${name}: team exceptions apply only to PR merges`,
    );
  }
  const teams = config.peribolos.orgs[ORG].teams;
  ensure(
    teams && Object.keys(teams).length,
    "Declare the teams managed by Peribolos",
  );
  for (const [name, team] of Object.entries(teams)) {
    ensure(
      [team.members || [], team.maintainers || []].every(
        (list) =>
          Array.isArray(list) &&
          list.every(
            (login) => typeof login === "string" && loginPattern.test(login),
          ),
      ),
      `${name}: team membership must be lists of GitHub logins`,
    );
    const members = [...(team.members || []), ...(team.maintainers || [])];
    ensure(
      new Set(members).size === members.length,
      `${name}: duplicate team membership`,
    );
    ensure(
      Object.values(team.repos || {}).every((p) =>
        ["read", "triage", "write", "maintain", "admin"].includes(p),
      ),
      `${name}: use native Peribolos repository permissions`,
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  configuration()
    .then((config) => {
      validate(config);
      console.log(
        `Validated ${Object.keys(config.repositories).length} repository configurations and Peribolos teams`,
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
