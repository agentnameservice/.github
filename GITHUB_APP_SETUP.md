# GitHub App setup

The `agentnameservice` organization owns this App. GitHub Actions runs the
management jobs; there is no webhook server to deploy. Registration and
installation can be completed while `governance` remains private. Installing
the App does not enable synchronization.

## Register

1. Open https://github.com/organizations/agentnameservice/settings/apps/new
   while signed in as an organization Owner.
2. Set the name to `ANS Org Management` (or a unique variation if unavailable).
   Set the homepage to `https://github.com/agentnameservice/.github`.
   Suggested description: `Manage ANS repository rules and teams from reviewed configuration.`
3. Leave Callback URL and Setup URL blank. Leave **Request user authorization
   (OAuth) during installation** and **Enable Device Flow** unchecked. No
   client secret is needed for this installation-token workflow.
4. Under **Webhook**, uncheck **Active**. No webhook URL, secret or event
   subscriptions are needed.
5. Set the permissions below. This is the permission set for the prepared
   configuration and workflows; do not import every permission from the full
   upstream Safe Settings manifest, which supports additional features.

| Scope | Permission | Access |
| --- | --- | --- |
| Repository | Administration | Read and write |
| Repository | Contents | Read and write |
| Repository | Checks | Read and write |
| Repository | Issues | Read and write |
| Repository | Pull requests | Read and write |
| Repository | Commit statuses | Read-only |
| Repository | Metadata | Read-only (automatic) |
| Organization | Members | Read and write |

Leave other permissions at No access. Administration manages repository
rulesets and team grants; Members manages teams and memberships; Contents and
Pull requests support configuration PRs; Issues supports labels; Checks and
Commit statuses support check inspection and Safe Settings validation.

6. For installation availability, choose **Only on this account**, then
   **Create GitHub App**.
7. On its General page, record the **App ID** and **Client ID**. These are
   identifiers, not secrets.

## Install

8. Open **Install App**, choose `agentnameservice`, and select **Only select
   repositories**. Initially select `.github` and `governance`. Add the first
   public test repository when its configuration is ready. Leave
   `governance-archieve` unselected. Click **Install**.
9. In `.github` → **Settings → Secrets and variables → Actions → Variables**, set
   `ORG_APP_ID` to the App ID and `ORG_APP_CLIENT_ID` to the Client ID.
   Keep the existing `ORG_MANAGEMENT_ENABLED=false` and `ORG_AUTO_APPLY=false`.

## Key and activation

10. After the `.github` workflow/configuration review and main-branch
    protections are complete, return to the App's General page and choose
    **Generate a private key**. Store the downloaded PEM in the approved secret
    store. Do not put the key in a commit, issue, PR, or chat.
11. In `.github` → **Settings → Environments → org-management**, create the
    environment secret `ORG_APP_PRIVATE_KEY` with the complete PEM contents,
    including its BEGIN/END lines. The existing environment is restricted to
    branch `main`. Do not use a repository-level secret for this key.
12. Once the configuration is reviewed and merged,
    test with `ORG_MANAGEMENT_ENABLED=true` and `ORG_AUTO_APPLY=false`.
    Run **Organization management → Run workflow → preview**. Check the proposed
    changes and both interim administrators' approval/merge access before any
    apply. Enable automatic apply only after the pilot passes.

## Keeping governance private

GitHub Apps can read an installed private repository with Contents read
permission. GitHub Free does not provide ruleset enforcement for that private
repository, but this does not prevent App registration or private roster reads.

The roster reader allows authenticated reads of private `governance/TSC.md`
and the synchronizer permits the TSC's existing Write grant there. It reads the
approved default-branch SHA, never an unmerged PR. Other private repositories,
foreign repositories, forks and the historical archive are not roster sources.
Keep private governance excluded from Safe Settings ruleset management.

The initial `.github` configuration uses `tsc-owners` and its local roster only,
so the first preview/apply does not depend on TSC roster publication.

Keep the manually created teams in place until their approved default-branch
rosters are ready for synchronization. Public contribution/security/conduct pointers must continue
to resolve publicly; do not replace public policy text with links to private
governance documents. The App and private roster setup can proceed separately.

## References

- [Register a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Install your own App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)
- [About rulesets and plan availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
