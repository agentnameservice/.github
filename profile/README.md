# Agent Name Service

**A registry and transparency log for discovering and verifying AI agents by name.**

DNS resolves a domain to an address. ANS resolves an *agent name* to a verifiable, versioned
identity — backed by certificates and an append-only transparency log.

[Reference implementation](https://github.com/agentnameservice/ans) ·
[Go SDK](https://github.com/agentnameservice/ans-sdk-go)

---

## Why ANS

As autonomous agents begin calling each other across organizations, two questions have no good
answer today:

- **Who is this agent, really?** Anyone can claim to be `support-agent.acme.com`. There's no
  standard way to prove it.
- **How do I find the right one?** No registry maps a name + capability + version to a
  trustworthy endpoint.

ANS answers both. Every agent gets a versioned, DNS-style name like
`ans://v1.0.0.my-agent.example.com`, an identity certificate issued only after DNS/ACME domain
validation, and a public transparency-log record — so any party can independently verify an
agent's identity, capabilities, and history without trusting a middleman.

## How it works

| Piece | Role |
|-------|------|
| **Registry Authority** | Registers agents, validates domain ownership (DNS + ACME), issues identity & server certificates, and exposes search / resolution. |
| **Transparency Log** | A durable, append-only Merkle-tree log of every agent event, with COSE / SCITT receipts (RFC 9162, RFC 6962) proving an agent's state at a point in time. |
| **Identity certificates** | Private-CA-signed certs enabling mutual TLS and badge-verified agent-to-agent calls. |
| **Offline verifier** | `ans-verify` — cryptographically validates an agent's record and proofs with no live service dependency. |

Think of it as **DNS + Certificate Transparency, built for agents.**
