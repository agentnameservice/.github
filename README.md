# ANS organization configuration

This repository holds the public organization profile, contribution guidance,
and GitHub administration configuration. GitHub Actions runs Safe Settings
with an organization-owned GitHub App. No server is required.

## What you manage

| Change | Where to make it |
| --- | --- |
| Project Maintainers or Reviewers | A PR to that project's `MAINTAINERS.md` |
| TSC membership | A PR to `governance/TSC.md` |
| Initial administrators, then elected officers | A PR to this repository's `MAINTAINERS.md` |
| Repository enrollment, CI checks or pausing | **Actions → Manage repository** |
| Shared protection policy | A PR to `safe-settings/suborgs/defaults.yml` |
| Invitations, org Owners, security managers and 2FA | GitHub organization settings |

Each roster lives in one place. There are no setup-roster copies to maintain.
The form creates normal PRs containing native Safe Settings YAML. You do not
need to edit a JSON inventory. Go SDK package repositories may reference the
SDK roster with `Roster source: agentnameservice/ans-sdk-go/MAINTAINERS.md`.

## Initial run

The initial configuration manages `.github` only, using `tsc-owners`. Connor
and Keith are its interim members and retain their existing org Owner roles.
This first run does not need a public governance repository or a TSC roster.

Follow [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md) and [GITHUB_APP_SETUP.md](GITHUB_APP_SETUP.md).
Keep `ORG_MANAGEMENT_ENABLED` and `ORG_AUTO_APPLY` false until the reviewed
configuration is merged and the App credentials are ready. Then enable
management with automatic apply still off and run **Organization management →
preview**. Review the plan before running **apply**.

## Everyday use

For a new public repository, prepare its roster, CODEOWNERS and real CI checks,
add it to the App installation, and use **Manage repository → Enroll or update**.
The form reports missing prerequisites and imports existing check requirements.
Supply a tracking issue and your own certified DCO sign-off for the configuration
PR. **Inspect repository** is read-only and needs neither.

**Bootstrap access** defaults to **Keep current**: new project repositories start
with `tsc-owners` as an additional code owner and PR merger. Existing repositories
retain their current choice. After the user approves the final handoff, select
**Remove** and review the configuration PR. The exception applies only to the
merge restriction; DCO, CI and normal review requirements still apply.

CODEOWNERS must include the project Maintainer team, `@agentnameservice/tsc`, and,
during bootstrap, `@agentnameservice/tsc-owners`. Preserve these shared teams on
path-specific ownership rules as well. `.github` initially needs only
`@agentnameservice/tsc-owners`. Adding TSC fallback there is a later reviewed
CODEOWNERS/configuration change.

Roster files use `## Maintainers` and `## Reviewers` sections with a `GitHub`
table column containing plain `@handles`. Reviewers may be empty. The TSC uses
its `## Voting members` table. The App reads approved default-branch revisions;
it never takes membership authority from an unmerged PR.

Governance may remain private. Install the App on it for authenticated roster
reads. Private governance remains excluded from ruleset management on GitHub
Free. Other managed repositories and shared project roster sources must be
public, active ANS repositories. The historical archive stays excluded.

## What synchronization changes

An apply prepares team membership, runs Safe Settings, then grants repository
Write access. A failed protection step prevents the access-grant step. Preview
performs no team or repository-access writes. Both modes report failures.

Safe Settings manages additive repository rulesets and labels. Existing classic
protections and unrelated rulesets remain. Its repository-lifecycle, team and
collaborator plugins are disabled. A small Octokit script reads the rosters,
creates teams, reconciles membership, and grants their declared Write access.
It does not invite people, demote org Owners, delete teams, or remove unrelated
grants. Unexpected elevated, nested or foreign team access needs owner review.
The shared TSC/bootstrap teams may retain Write on other active public ANS repos
and on private governance during the transition.

The baseline requires reviewed PRs, CODEOWNERS review, DCO, resolved conversations,
and blocks branch deletion and force pushes. Separate rulesets require the
repo's actual CI and restrict merges to its Maintainers plus any explicit
bootstrap exception. The TSC alone grants review eligibility, not project
merge authority; governance itself uses the TSC as its merge team.

Once the pilot is accepted, `ORG_AUTO_APPLY=true` applies reviewed configuration
and roster updates on pushes and a six-hour schedule. **Pause management** excludes
a repository and any others sharing its Maintainer team; existing access and
protections remain. Set `ORG_MANAGEMENT_ENABLED=false` to stop all management.

## Development

```sh
npm ci --ignore-scripts
npm run validate
npm test
python3 -m unittest discover -s tests -v
```

Dependencies and Actions are pinned. The native runner is described in the
[Safe Settings Actions guide](https://github.com/github-community-projects/safe-settings/blob/3.0.0/docs/github-action.md).
Follow [CONTRIBUTING.md](CONTRIBUTING.md) for changes.
