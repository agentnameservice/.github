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

Reviewer team slugs use the `-reviewers` suffix and Write access. Peribolos
keys use team display names; the form resolves their GitHub slugs for CODEOWNERS
without renaming teams or adding Reviewers to merge allowlists.

The repository form imports existing checks, preserves their App bindings, and
opens a PR for the native YAML changes. Maintainers merge pull requests directly;
required checks must pass on a branch that is up to date with the default branch.
The form preserves signature requirements and unrelated protections. Repositories
with merge queues must remove them before enrollment because queue pushes cannot
satisfy the Maintainer-only update restriction.

**Bootstrap access → Keep current** preserves the existing choice and enables
`tsc-owners` approval/merge access for new enrollments. Select **Remove** only
after the handoff is approved. DCO, CI and review requirements still apply.
DCO checks require the DCO App (ID `1861`); a workflow job named `DCO` cannot
satisfy that requirement.

Maintainer teams are exempt from the separate update-only gate so they can use
the normal merge button. The baseline and CI rulesets have no exemptions, so
pull requests, approvals, up-to-date checks and DCO remain mandatory. Exemptions
do not create bypass audit entries for the update gate; PR history records the
merging user.

## Running the automation

Install the organization-owned App on the repositories listed in `peribolos.yml`.
It needs repository Administration, Contents, Checks, Issues and Pull requests
write access; Commit statuses read access; and organization Members write access.
Safe Settings creates a final check run when applying changes, so Checks write
is required even with PR comments disabled. Webhooks are disabled. Governance
can remain private.

| Setting | Location |
| --- | --- |
| `ORG_APP_ID`, `ORG_APP_CLIENT_ID` | Repository Actions secrets |
| `ORG_APP_PRIVATE_KEY` | Secret in the `org-management` environment, restricted to `main` |
| `ORG_MANAGEMENT_ENABLED` | Repository variable; `false` stops management |
| `ORG_AUTO_APPLY` | Repository variable; `true` applies on pushes and the schedule |

Before activation, complete the approved legacy-access cutover and verify that
every live team is declared in `peribolos.yml`. The DCO App validates sign-offs;
repositories do not need a workflow to stand in for that check.

Run **Organization management → preview**, review the plan, then use **apply**.
Keep automatic apply off until the first run is verified. Teams and memberships
are reconciled first, protections next, and repository grants last. A failed
protection step stops the grant step.

Peribolos does not manage org Owners, org-wide membership, repository lifecycle,
or direct collaborators. It preserves team names. `--maximum-removal-delta=0`
fails the entire run when any existing team is absent from `peribolos.yml`.
Declare or retire undeclared teams before running preview or apply; membership
and grant changes follow the reviewed YAML.
Manual changes to managed teams are reconciled to that configuration.

Peribolos's [native dump](https://github.com/kubernetes-sigs/prow/blob/main/site/content/en/docs/components/cli-tools/peribolos.md#initial-seed)
can capture existing teams. Review its `orgs.agentnameservice.teams` section and
retain approved pending invitations; raw billing/contact metadata stays outside
this repository. Safe Settings provides a [native repository exporter](https://github.com/github-community-projects/safe-settings#generating-settings-from-existing-configuration).

Only repositories in [the settings scope](safe-settings/deployment-settings.yml)
receive Safe Settings changes. [Repository configs](safe-settings/repos) can be
prepared before enrollment. Pausing settings leaves existing access unchanged.

Publish the shared workflow and governance documents before adopting repository
callers and links. Land each repository's `MAINTAINERS.md`, CODEOWNERS and required
CI support before enrollment. Create the `editorial` and `normative` labels
before enabling the contribution-policy workflow in either specification
repository; the shared defaults maintain those labels after enrollment.

`homebrew-ans` and `scoop-ans` are excluded from protection management because
GoReleaser publishes their generated package updates directly to `main`.
Their Maintainer team access is still managed through Peribolos.

## Shared contribution tooling

| Feature | How repositories receive it |
| --- | --- |
| Shared labels | Safe Settings applies `safe-settings/suborgs/defaults.yml` only to repositories in the settings scope, when organization management runs in apply mode. Labels do not inherit from `.github` on their own. |
| Issue forms | GitHub uses this repository's `.github/ISSUE_TEMPLATE/` as organization defaults for repositories without local issue forms. Local issue-template directories override that fallback; copy any shared forms they need. |
| Contribution and inactivity workflows | Install a caller from `workflow-templates/` in each repository's `.github/workflows/`. Workflows are not inherited or automatically copied. Callers use the centrally maintained workflow on `main`. |
| Specification release form | Copy `repo-templates/specification/ISSUE_TEMPLATE/spec-release.yml` into `ans-spec` or `trust-index-spec`, alongside the other forms that repository needs. |
| GitVote | With the [GitVote App](https://github.com/apps/git-vote) installed, the root `.gitvote.yml` is an organization fallback. A repository's own configuration takes precedence. |

The proposal, specification-tracking, and nomination forms collect the evidence
and decision process for a change. Labels record its status; they do not approve
proposals, grant team access, or enforce release acceptance. Governance-only
forms and quarterly health checks belong in the governance repository.

The contribution check accepts an issue reference or a `No issue needed:`
explanation. `normative`, `issue-required`, and explicitly breaking PRs require
a reference even for Dependabot. Create `issue-required` in repositories using
that override before relying on it; the shared label configuration maintains it
once those repositories are enrolled.

### Inactive pull requests

Create the `awaiting-author` and `stale` labels before installing the inactivity
caller. It starts a 60-day response period when it observes a non-draft PR with
changes requested and no pending review requests. Existing PRs start a fresh
period when the workflow first tracks them. After 60 days it posts a reminder;
after another 30 days without an author response it closes the PR, leaving
related issues open. Authors can reopen a PR when ready to continue.

Pushes, author comments (including review-thread replies and review summaries),
and new change requests restart the full period. A pending review request,
approval, draft conversion, or closure removes both labels. Bot comments do not
restart the clock. Removing `stale` manually
restarts the period. The timer uses the server timestamp of `awaiting-author`,
and a close requires a reminder for the current head commit. General PR update
timestamps and contributor-supplied commit dates do not determine inactivity.

The caller handles trusted base-repository events, including
`pull_request_target`, and runs a daily sweep. The reusable workflow checks out
only `agentnameservice/.github` at `main`; it never checks out or executes the
contributor's branch. Its token is scoped to the calling repository.

### GitVote

Keep the `tsc` team aligned with the eligible voting members before using
`/vote` (majority) or `/vote-two-thirds`. Both profiles count all eligible voters
and remain open for seven days. The thresholds implement majority and two-thirds
for up to nine eligible members, including vacancies. Special voter exclusions
or a different electorate require a matching profile. These defaults do not
start votes automatically or replace proposal review periods and other required
approvals. The GitVote App must have access to the voting repositories and team.

## Development

```sh
npm ci --ignore-scripts
npm run validate
npm test
python3 -m unittest discover -s tests -v
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [GitHub's App documentation](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).
