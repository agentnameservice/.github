# ANS organization management

GitHub Actions runs [Peribolos](https://github.com/kubernetes-sigs/prow/tree/main/cmd/peribolos)
for teams and access, and [Safe Settings](https://github.com/github-community-projects/safe-settings)
for repository protections. No server or Kubernetes cluster is required.

## Making changes

| Change | Where |
| --- | --- |
| Teams, members and repository access | [peribolos.yml](peribolos.yml) |
| Enroll, update or pause repository settings | **Actions → Manage repository** |
| Shared protections | [defaults.yml](safe-settings/suborgs/defaults.yml) |
| Organization Owners and invitations | GitHub organization settings |

Open a PR for membership changes in `peribolos.yml`, with the affected project's
approvals required by governance. Its `members` and
`maintainers` are GitHub team roles; both receive the team's repository access.
Keep governance decisions in governance documents and GitHub access in this
configuration. Repository Maintainer pages link here instead of copying rosters.

Repository Reviewer teams use the `-reviewers` suffix and Write access. The
repository form includes them in CODEOWNERS requirements without adding them
to merge allowlists.

The repository form imports existing checks, preserves their App bindings, and
opens a PR for the native YAML changes. Merge queues retain loose checks;
other repositories require an up-to-date branch. Existing merge queues,
signature requirements and unrelated protections remain in place.

**Bootstrap access → Keep current** preserves the existing choice and enables
`tsc-owners` approval/merge access for new enrollments. Select **Remove** only
after the handoff is approved. DCO, CI and review requirements still apply.

## Running the automation

Install the organization-owned App on the repositories listed in `peribolos.yml`.
It needs repository Administration, Contents, Checks, Issues and Pull requests
write access; Commit statuses read access; and organization Members write access.
Webhooks are disabled. Governance can remain private.

| Setting | Location |
| --- | --- |
| `ORG_APP_ID`, `ORG_APP_CLIENT_ID` | Repository Actions secrets |
| `ORG_APP_PRIVATE_KEY` | Secret in the `org-management` environment, restricted to `main` |
| `ORG_MANAGEMENT_ENABLED` | Repository variable; `false` stops management |
| `ORG_AUTO_APPLY` | Repository variable; `true` applies on pushes and the schedule |

Run **Organization management → preview**, review the plan, then use **apply**.
Keep automatic apply off until the first run is verified. Teams and memberships
are reconciled first, protections next, and repository grants last. A failed
protection step stops the grant step.

Peribolos does not manage org Owners, org-wide membership, repository lifecycle,
or direct collaborators. It preserves team names. Team deletion is disabled by
`--maximum-removal-delta=0`; membership and grant changes follow the reviewed YAML.
Manual changes to managed teams are reconciled to that configuration.

Peribolos's [native dump](https://github.com/kubernetes-sigs/prow/blob/main/site/content/en/docs/components/cli-tools/peribolos.md#initial-seed)
can capture existing teams. Review its `orgs.agentnameservice.teams` section and
retain approved pending invitations; raw billing/contact metadata stays outside
this repository. Safe Settings provides a [native repository exporter](https://github.com/github-community-projects/safe-settings#generating-settings-from-existing-configuration).

Only repositories in [the settings scope](safe-settings/deployment-settings.yml)
receive Safe Settings changes. [Repository configs](safe-settings/repos) can be
prepared before enrollment. Pausing settings leaves existing access unchanged.

`homebrew-ans` and `scoop-ans` are excluded from protection management because
GoReleaser publishes their generated package updates directly to `main`.
Their Maintainer team access is still managed through Peribolos.

## Development

```sh
npm ci --ignore-scripts
npm run validate
npm test
python3 -m unittest discover -s tests -v
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [GitHub's App documentation](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).
