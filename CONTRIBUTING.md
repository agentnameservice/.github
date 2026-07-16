# Contributing

These are the organization-wide contribution guidelines for
[agentnameservice](https://github.com/agentnameservice) repositories.
A repository may extend them with project-specific guidance in its own
`CONTRIBUTING.md`; where one exists, it takes precedence.

## Pull Requests

- Open an issue first and reference it from your pull request with a closing
  keyword (e.g. `Fixes #123`) — issues are where triage and prioritization
  happen.
- PR titles follow [Conventional Commits](https://www.conventionalcommits.org);
  release notes are generated from them.

## Developer Certificate of Origin

This organization follows the Linux Foundation contribution model. Every
commit must carry a `Signed-off-by:` trailer certifying the
[Developer Certificate of Origin](https://developercertificate.org) — your
assertion that you have the right to submit the change under the project's
license. Sign off each commit with:

```
git commit -s
```

Missing sign-offs on an existing branch can be fixed with
`git rebase --signoff origin/main` followed by a force-push. The `DCO`
status check enforces this on every pull request; PRs opened by bots
(Dependabot, release-please) are exempt, and merge commits are skipped.

## AI-Assisted Contributions

AI-assisted contributions are welcome **with disclosure**, following the
[Linux kernel convention](https://docs.kernel.org/process/coding-assistants.html):

- Disclose the tooling in the pull request's **AI assistance** section,
  naming the tool and model, e.g. `Assisted-by: Claude Code (claude-fable-5)`.
- AI tools must never add `Signed-off-by:` lines. DCO certification belongs
  to the human submitter, who remains fully responsible for the correctness
  and licensing of the contribution.
