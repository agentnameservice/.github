# ANS organization setup

This checklist covers the initial installation. Routine changes use repository
roster PRs and the **Manage repository** form. There is no setup roster inventory.

## Initial .github setup

- [x] Create `tsc-owners`, add Connor and Keith, and grant Write on `.github`.
- [x] Record their interim membership in this repository's `MAINTAINERS.md`.
- [x] Apply initial `.github/main` protections: one PR approval, stale-review
      dismissal, resolved conversations, DCO, no deletion or force pushes,
      and PR merges restricted to `tsc-owners`.
- [ ] Review and merge this branch with human-authorized DCO sign-offs.
      Keith's separate contribution-policy PR is not a prerequisite.
- [ ] Confirm the `Validate organization configuration` check passes on the PR
      and GitHub recognizes `.github/CODEOWNERS` with `tsc-owners`.
- [ ] Finish App registration and selected-repository installation using
      [GITHUB_APP_SETUP.md](GITHUB_APP_SETUP.md). Initially select `.github`
      and `governance`; the latter may remain private. Exclude the archive.
- [ ] Set the App identifiers and the `org-management` environment private-key
      secret. Keep the environment restricted to `main` and default workflow
      token read-only. Keep both management switches false until ready.
- [ ] Set `ORG_MANAGEMENT_ENABLED=true`, leaving `ORG_AUTO_APPLY=false`.
      Run **Organization management → preview** and review its plan.
- [ ] Run **apply** for the initial `.github` configuration. This adds the real
      configuration-validation requirement and CODEOWNERS review after their
      files are on main. Verify that Connor and Keith can approve and merge
      compliant PRs and remain org Owners.

The initial `.github` configuration uses only its own approved roster. It does
not read the TSC roster or require governance publication.

## Enroll project repositories

- [ ] Merge the approved TSC voting roster into the default branch of
      `governance`. The App can read it privately; keep private governance
      excluded from Safe Settings ruleset management.
- [ ] Confirm invited roster members have joined the organization. The initial
      teams were created manually; there is no duplicate roster under `.github`.
- [ ] Merge each project's approved `MAINTAINERS.md` and prepare CODEOWNERS for
      its Maintainer team, `tsc`, and `tsc-owners` while bootstrap access is on.
      Keep shared reviewers on path-specific rules. Package repos can point to
      the SDK roster instead of copying its membership.
- [ ] Publish the reusable contribution workflow on `.github/main` before
      adding callers. Keep existing CI and use its actual check names.
- [ ] Prepare merge-group CI triggers for repos using merge queues. Prepare
      package publishers to create PRs before applying PR-only tap restrictions.
- [ ] Add the public pilot repository to the App installation. Use **Manage
      repository → Inspect repository**, then **Enroll or update**. Keep
      **Bootstrap access → Keep current** for the initial enrollment.
- [ ] Review and merge the generated native YAML. Run preview, then apply.
      Team membership is prepared first; repository access is granted only
      after protections succeed.
- [ ] Verify the real approval/merge path: DCO and CI failures block merges;
      both interim administrators can review and merge compliant PRs; TSC-only
      reviewers do not gain project merge authority. Test merge queues and
      release publishing where applicable before extending the rollout.
- [ ] Enroll additional repositories through the same form. Once accepted,
      enable `ORG_AUTO_APPLY=true` for routine synchronization.

Connor and Keith retain their existing Owner roles throughout setup. Bootstrap
exceptions are separate from permanent project Maintainer appointments and do
not bypass DCO or CI. Remove them through the form only after the user approves
the handoff, then review any remaining team grants manually.

## Separate organization work

Public policy guidance remains usable in `.github` while governance is private.
Publish central governance before changing public docs to private-only links.
The public security defaults and DCO App are already configured.

Complete the Security lead/backup and reporting arrangements, notify members
before enabling required 2FA, and resolve final officer/LF ownership handoff
when those decisions are made. Old direct grants, legacy groups and archive
deletion are separate cleanup; do not infer account removals from a roster edit.
