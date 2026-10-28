// SPDX-License-Identifier: Apache-2.0
import { pathToFileURL } from "node:url";
import {
  BASELINE,
  CHECKS,
  MERGE,
  access,
  configuration,
  ensure,
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
    !config.settings.rulesets && config.defaults.ruleset_scope === "repo",
    "Use repository rulesets; organization rulesets need a paid plan",
  );
  ensure(
    config.defaults.suborgrepos.includes("*") &&
      config.defaults.suborgrepos.includes(".*"),
    "Defaults must cover new repositories and .github",
  );
  const base = config.defaults.rulesets.find((r) => r.name === BASELINE);
  ensure(
    active(base) && base.bypass_actors?.length === 0,
    "The shared baseline has no bypass actors",
  );
  const types = base.rules.map((r) => r.type);
  ensure(
    types.includes("deletion") && types.includes("non_fast_forward"),
    "Prevent deletion and force pushes",
  );
  const reviews = base.rules.find((r) => r.type === "pull_request")?.parameters;
  ensure(
    reviews?.required_approving_review_count >= 1 &&
      reviews.dismiss_stale_reviews_on_push &&
      reviews.require_code_owner_review &&
      reviews.required_review_thread_resolution,
    "Keep shared review requirements",
  );
  ensure(
    base.rules
      .find((r) => r.type === "required_status_checks")
      ?.parameters.required_status_checks.some((c) => c.context === "DCO"),
    "Keep DCO in the baseline",
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
    !config.settings.disable_plugins.includes("rulesets") &&
      config.settings.additive_plugins.includes("rulesets"),
    "Manage repository rulesets additively",
  );
  for (const [name, settings] of Object.entries(config.repositories)) {
    const mapping = access(name, settings);
    ensure(
      !settings.rulesets.some((r) => r.name === BASELINE),
      `${name}: change the shared baseline in its own file`,
    );
    const ci = settings.rulesets.find((r) => r.name === CHECKS);
    ensure(
      active(ci) && !ci.bypass_actors.length && ci.rules.length === 1,
      `${name}: CI has no bypass actors`,
    );
    const checks = ci.rules[0].parameters;
    ensure(
      ci.rules[0].type === "required_status_checks" &&
        checks.strict_required_status_checks_policy &&
        checks.required_status_checks.length,
      `${name}: require real CI`,
    );
    ensure(
      checks.required_status_checks.every(
        (c) =>
          typeof c.context === "string" &&
          c.context.trim() &&
          !/[\x00-\x1f]/.test(c.context) &&
          c.context !== "DCO",
      ),
      "List only CI checks additional to DCO",
    );
    const gate = settings.rulesets.find((r) => r.name === MERGE);
    ensure(
      active(gate) &&
        gate.rules.length === 1 &&
        gate.rules[0].type === "update" &&
        !gate.rules[0].parameters?.update_allows_fetch_and_merge &&
        gate.bypass_actors.length === (mapping.bootstrap ? 2 : 1) &&
        gate.bypass_actors.every(
          (a) => a.actor_type === "Team" && a.bypass_mode === "pull_request",
        ),
      `${name}: merge exceptions apply only to the update rule, through PRs`,
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
        `Validated native shared policy and ${Object.keys(config.repositories).length} repository overrides`,
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
