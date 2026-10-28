# ANS organization management

This repository contains ANS's organization profile, contribution guidance,
and GitHub configuration. Actions runs Safe Settings and synchronizes teams
from repository rosters.

## Making changes

| Change | Where |
| --- | --- |
| Project Maintainers and Reviewers | The project's `MAINTAINERS.md` |
| TSC members | `governance/TSC.md` |
| Administrators of this repository | [MAINTAINERS.md](MAINTAINERS.md) |
| Enroll, update or pause a repository | **Actions → Manage repository** |
| Shared protections | [defaults.yml](safe-settings/suborgs/defaults.yml) |

Use the form to inspect a repository or open a configuration PR. It reports
missing rosters, CODEOWNERS and CI checks. Review and merge the PR, then run
**Organization management → preview** before **apply**.

**Bootstrap access** keeps `tsc-owners` eligible to approve and merge during
setup. **Keep current** preserves the existing choice and enables it for new
repositories. Select **Remove** only after the access handoff is approved.
DCO, CI and review requirements still apply.

Keep each roster in its own repository, using [MAINTAINERS.md](MAINTAINERS.md)
as the format. The automation reads merged default-branch files. Governance
may remain private if the App can read it; private governance is excluded from
ruleset management on GitHub Free. Organization invitations and Owner roles
are managed directly in GitHub.

## Running the automation

The organization-owned App needs repository Administration, Contents, Checks,
Issues and Pull requests write access; Commit statuses read access; and
organization Members write access. Install it only on repositories it should
manage or read. Webhooks are disabled because Actions runs the jobs.

| Setting | Location |
| --- | --- |
| `ORG_APP_ID`, `ORG_APP_CLIENT_ID` | Repository Actions variables |
| `ORG_APP_PRIVATE_KEY` | Secret in the `org-management` environment, restricted to `main` |
| `ORG_MANAGEMENT_ENABLED` | Repository variable; `false` stops management |
| `ORG_AUTO_APPLY` | Repository variable; `true` applies changes on pushes and the schedule |

Keep automatic apply off until preview and a manual apply have been verified.
An apply prepares teams, applies protections, then grants repository access.
A protection failure stops the access-grant step. Existing unrelated grants
and protections remain.

[Repository configurations](safe-settings/repos) and
[exclusions](safe-settings/deployment-settings.yml) define the managed scope.
For App registration details, use [GitHub's documentation](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).

## Development

```sh
npm ci --ignore-scripts
npm run validate
npm test
python3 -m unittest discover -s tests -v
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Safe Settings documentation](https://github.com/github-community-projects/safe-settings).
