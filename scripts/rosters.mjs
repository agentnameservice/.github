// SPDX-License-Identifier: Apache-2.0
import { access, ensure, loginPattern } from "./config.mjs";
import {
  textFile,
  publicRepository,
  rosterRepository,
  head,
} from "./github.mjs";

export function parseRoster(text, tsc = false) {
  ensure(
    text && !text.includes("<!--"),
    "Roster is missing or contains hidden comments",
  );
  const headings = tsc ? ["Voting members"] : ["Maintainers", "Reviewers"];
  const sections = {};
  let section;
  let column;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#")) {
      section =
        headings.includes(line.slice(3).trim()) && line.startsWith("## ")
          ? line.slice(3).trim()
          : null;
      column = undefined;
      if (section) {
        ensure(!sections[section], "Duplicate roster section");
        sections[section] = [];
      }
    } else if (section && line.trim().startsWith("|")) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (column === undefined) {
        ensure(
          cells.filter((c) => c === "GitHub").length === 1,
          "Roster needs a GitHub column",
        );
        column = cells.indexOf("GitHub");
      } else if (!cells.every((c) => /^:?-+:?$/.test(c))) {
        const value = cells[column];
        ensure(
          value?.startsWith("@") && loginPattern.test(value.slice(1)),
          "Use plain @handles in the GitHub column",
        );
        const login = value.slice(1).toLowerCase();
        ensure(!sections[section].includes(login), "Duplicate roster identity");
        sections[section].push(login);
      }
    }
  }
  ensure(
    headings.every((h) => sections[h]),
    "Missing roster section",
  );
  const result = {
    maintainers: sections[headings[0]].sort(),
    reviewers: tsc ? [] : sections.Reviewers.sort(),
  };
  ensure(
    result.maintainers.length &&
      !result.reviewers.some((u) => result.maintainers.includes(u)),
    "Maintainers must be nonempty and separate from Reviewers",
  );
  return result;
}

export async function roster(gh, name, repositories) {
  const info = await rosterRepository(gh, name);
  const sha = await head(gh, name, info.default_branch);
  const text = await textFile(
    gh,
    name,
    name === "governance" ? "TSC.md" : "MAINTAINERS.md",
    sha,
  );
  ensure(
    text && !text.includes("<!--"),
    `${name}: merge its approved roster into the default branch first`,
  );
  const pointers = [
    ...text.matchAll(
      /^Roster source: agentnameservice\/([a-z\d_.-]+)\/MAINTAINERS\.md\s*$/gm,
    ),
  ];
  ensure(
    (text.match(/Roster source:/g) || []).length === pointers.length &&
      pointers.length <= 1,
    "Malformed roster reference",
  );
  if (!pointers.length) return parseRoster(text, name === "governance");
  ensure(
    name !== "governance",
    "The TSC roster must come from governance/TSC.md",
  );
  const source = pointers[0][1];
  ensure(
    source !== name &&
      repositories[source] &&
      !text.includes("## Maintainers") &&
      !text.includes("## Reviewers"),
    "Use one declared shared roster without duplicate tables",
  );
  const destinationTeams = access(name, repositories[name]);
  const sourceTeams = access(source, repositories[source]);
  ensure(
    destinationTeams.maintainers === sourceTeams.maintainers &&
      destinationTeams.reviewers === sourceTeams.reviewers,
    "Shared rosters must use the same teams",
  );
  const sourceInfo = await publicRepository(gh, source);
  const sourceHead = await head(gh, source, sourceInfo.default_branch);
  const sourceText = await textFile(gh, source, "MAINTAINERS.md", sourceHead);
  ensure(
    sourceText && !sourceText.includes("Roster source:"),
    "Chained roster references are not supported",
  );
  return parseRoster(sourceText);
}
