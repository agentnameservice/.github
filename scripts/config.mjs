// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const ORG = "agentnameservice";
export const REPO = ".github";
export const BASELINE = "ANS baseline";
export const CHECKS = "ANS repository checks";
export const MERGE = "ANS Maintainer merges";
export const TSC = "tsc";
export const BOOTSTRAP = "tsc-owners";
export const loginPattern = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
export const teamPattern = /^[a-z\d]+(?:-[a-z\d]+)*$/;
export function ensure(value, message) {
  if (!value) throw new Error(message);
}
export function repositoryName(value) {
  const name = String(value || "")
    .trim()
    .toLowerCase();
  ensure(
    name === ".github" || /^[a-z\d][a-z\d_.-]*$/.test(name),
    "Use a repository name within agentnameservice",
  );
  ensure(name !== "governance-archieve", "The historical archive is excluded");
  return name;
}
export async function readYaml(file) {
  return yaml.load(await fs.readFile(file, "utf8"));
}
export async function writeYaml(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, yaml.dump(value, { lineWidth: 100, noRefs: true }));
}
export function access(name, config) {
  repositoryName(name);
  const gate = config.rulesets?.find((r) => r.name === MERGE);
  const mergers = gate?.bypass_actors
    ?.filter((a) => a.actor_type === "Team")
    .map((a) => a.name);
  const teams = config.teams || [];
  const bootstrap = name !== REPO && mergers?.includes(BOOTSTRAP);
  const maintainers = mergers?.filter(
    (team) => name === REPO || team !== BOOTSTRAP,
  );
  ensure(
    maintainers?.length === 1 &&
      new Set(mergers).size === mergers.length &&
      teams.length >= 1 &&
      teams.length <= 4,
    `${name}: declare one merge team, optional bootstrap access, and at most one Reviewer team`,
  );
  ensure(
    teams.every((t) => teamPattern.test(t.name) && t.permission === "push"),
    `${name}: roster teams need Write permission`,
  );
  ensure(
    new Set(teams.map((t) => t.name)).size === teams.length &&
      teams.some((t) => t.name === maintainers[0]) &&
      (name === REPO || teams.some((t) => t.name === TSC)) &&
      (!bootstrap || teams.some((t) => t.name === BOOTSTRAP)),
    `${name}: ambiguous team mapping`,
  );
  ensure(
    name === "governance"
      ? maintainers[0] === TSC
      : name === ".github"
        ? maintainers[0] === BOOTSTRAP
        : ![TSC, BOOTSTRAP].includes(maintainers[0]),
    `${name}: TSC review access does not confer project merge authority`,
  );
  const reviewers = teams.filter(
    (t) =>
      t.name !== maintainers[0] &&
      t.name !== TSC &&
      !(bootstrap && t.name === BOOTSTRAP),
  );
  ensure(reviewers.length <= 1, `${name}: declare at most one Reviewer team`);
  ensure(
    !reviewers.some((t) => t.name === "tsc-owners") &&
      (![".github", "governance"].includes(name) || !reviewers.length),
    `${name}: keep officer and TSC membership in their governance rosters`,
  );
  return {
    maintainers: maintainers[0],
    reviewers: reviewers[0]?.name,
    bootstrap: Boolean(bootstrap),
  };
}
export function codeOwners(name, settings) {
  const mapping = access(name, settings);
  return [
    ...new Set([
      mapping.maintainers,
      ...(settings.teams.some((t) => t.name === TSC) ? [TSC] : []),
      ...(mapping.bootstrap ? [BOOTSTRAP] : []),
    ]),
  ];
}
export async function configuration(root = ROOT) {
  const settings = await readYaml(
    path.join(root, "safe-settings/settings.yml"),
  );
  const defaults = await readYaml(
    path.join(root, "safe-settings/suborgs/defaults.yml"),
  );
  const deployment = await readYaml(
    path.join(root, "safe-settings/deployment-settings.yml"),
  );
  const excluded = deployment.restrictedRepos?.exclude;
  ensure(
    Array.isArray(excluded) && excluded.includes("governance-archieve"),
    "Keep the archive excluded",
  );
  ensure(
    excluded.every((n) => n === "governance-archieve" || repositoryName(n)),
    "Use explicit exclusions",
  );
  const directory = path.join(root, "safe-settings/repos");
  const repositories = Object.create(null);
  for (const file of (await fs.readdir(directory))
    .filter((f) => f.endsWith(".yml"))
    .sort()) {
    const name = repositoryName(file.slice(0, -4));
    ensure(file === name + ".yml", "Use canonical lowercase filenames");
    repositories[name] = await readYaml(path.join(directory, file));
    access(name, repositories[name]);
  }
  return {
    settings,
    defaults,
    deployment,
    excluded: new Set(excluded),
    repositories,
  };
}
