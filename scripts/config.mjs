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
export const DCO_APP = 1861;
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
  const actors =
    config.rulesets?.find((r) => r.name === MERGE)?.bypass_actors || [];
  ensure(
    actors.every(
      (a) =>
        a.actor_type === "Team" &&
        a.bypass_mode === "exempt" &&
        teamPattern.test(a.name),
    ),
    `${name}: merge exemptions must use named teams on the update-only gate`,
  );
  const mergers = actors.map((a) => a.name);
  const bootstrap = name !== REPO && mergers.includes(BOOTSTRAP);
  const primary = mergers.filter((team) => name === REPO || team !== BOOTSTRAP);
  ensure(
    primary.length === 1 && new Set(mergers).size === mergers.length,
    `${name}: declare one Maintainer team and optional bootstrap access`,
  );
  ensure(
    name === "governance"
      ? primary[0] === TSC
      : name === REPO
        ? primary[0] === BOOTSTRAP
        : ![TSC, BOOTSTRAP].includes(primary[0]),
    `${name}: use the repository's merge team`,
  );
  return { maintainers: primary[0], bootstrap };
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
  const included = deployment.restrictedRepos?.include;
  ensure(
    Array.isArray(included) && included.every((n) => repositoryName(n) === n),
    "Explicitly include only repositories ready for settings management",
  );
  const peribolos = await readYaml(path.join(root, "peribolos.yml"));
  ensure(
    Object.keys(peribolos.orgs || {}).join() === ORG &&
      Object.keys(peribolos.orgs[ORG]).join() === "teams",
    "Peribolos manages only ANS teams; org settings and Owners stay in GitHub",
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
    included: new Set(included),
    peribolos,
    repositories,
  };
}
