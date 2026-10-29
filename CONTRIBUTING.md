# Contributing to ANS

These guidelines apply across `agentnameservice`. Read the affected repository's
README for its build and test commands. Find reviewers through the
[organization teams](https://github.com/orgs/agentnameservice/teams), or ask in
your pull request.
Repository-specific contribution instructions may add requirements.

## Pull requests

Open a tracking issue and reference it with a closing keyword such as `Fixes
#123`. Use a [Conventional Commits](https://www.conventionalcommits.org/) title.
Explain the change and how you tested it, and complete the PR template. For
changes in `ans-registry` or `trust-index-spec`, use exactly one of the
`editorial` or `normative` labels.

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
