# Contributing to ANS

These guidelines apply across `agentnameservice`. Read the affected repository's
README for its build and test commands. Find reviewers through the
[organization teams](https://github.com/orgs/agentnameservice/teams), or ask in
your pull request.
Repository-specific contribution instructions may add requirements.

## Pull requests

Use a [Conventional Commits](https://www.conventionalcommits.org/) title.
Explain the problem, change, and verification in the PR template. In `ans-spec`
and `trust-index-spec`, apply exactly one of `editorial` or `normative`.

A separate issue or proposal is required for normative specification changes,
breaking changes or deprecations, work requiring coordination across PRs or
repositories, and new capabilities needing agreement on scope or ongoing
support. Existing governance and proposal approval requirements still apply.

Self-contained changes may go directly to a PR: contained bug fixes, editorial
corrections, tests, behavior-preserving refactoring, routine maintenance, and
straightforward additions such as CLI convenience options or internal helpers.
The change's impact and coordination needs determine whether an issue is needed,
not its size or title prefix.

Link existing issues when relevant. Use `Refs #123` for ongoing work and `Fixes
#123` or `Closes #123` only when the PR completes the issue. If no issue is needed,
write `No issue needed:` followed by a brief reason in the PR description.
Maintainers confirm the classification during review and may apply
`issue-required` to require a reference.

Routine Dependabot updates need neither an issue nor an explanation. Normative,
explicitly breaking, and `issue-required` PRs still require a reference,
including Dependabot PRs. Review, DCO, CI, and private security reporting
requirements continue to apply.

## Developer Certificate of Origin

Sign off every contribution commit with `git commit --signoff`, certifying the
[Developer Certificate of Origin](https://developercertificate.org/). The DCO
certification belongs to the human contributor, who is responsible for the
contribution's rights, licensing and correctness. The organization DCO App
checks pull requests.

## AI-assisted contributions

AI-assisted contributions are welcome with disclosure. Name the tool and model
in the PR's **AI assistance** section, for example `Assisted-by: Tool (model)`.
Review and test generated changes. AI assistance does not replace human DCO
certification or responsibility for the contribution.

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities privately
as described in [SECURITY.md](SECURITY.md).
