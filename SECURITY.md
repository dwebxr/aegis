# Security policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Use GitHub's private vulnerability reporting:
**<https://github.com/dwebxr/aegis/security/advisories/new>**

## Response targets

| Severity | Acknowledgement | Fix shipped |
| --- | --- | --- |
| Critical / High | within 72 hours | within 14 days |
| Moderate | within 7 days | within 30 days |
| Low | within 14 days | rolled into next release |

We aim for coordinated disclosure: once a fix ships in production, you receive credit in the GitHub Security Advisory unless you prefer to remain anonymous.

## In scope

- The Aegis production deployment at `https://aegis-ai.xyz` (and aliases `aegis.dwebxr.xyz`, `www.aegis-ai.xyz`).
- Server-side code under `app/api/**`, `lib/api/**`, `lib/d2a/**`, `lib/nostr/**`, `lib/scoring/**`, `lib/translation/**`, `lib/feed/**`.
- The Motoko canister at `rluf3-eiaaa-aaaam-qgjuq-cai`.
- The published `@aegis/d2a-client` npm package (any version).
- The D2A v1.0 protocol specification (logical attacks against the wire format).

## Out of scope

- **Denial-of-service** via repeatedly hitting any unauthenticated endpoint. Rate limiting and per-principal caps are the documented defense.
- **Social engineering** of operator accounts.
- **Vulnerabilities in third-party services** we depend on (Vercel, Anthropic, Internet Computer, Nostr relays). Report those upstream.
- **Outdated browser** behavior on browsers older than the targeted set in `package.json` `engines`.
- **Self-XSS** that requires the victim to paste hostile JavaScript into devtools.
- **Missing security headers** that do not enable a concrete attack on Aegis (e.g. `Permissions-Policy` flags for features Aegis does not use).
- **CVEs in dev-only dependencies** that do not ship in the production bundle. Run `npm audit --production` to confirm.
- **Moderate-or-lower transitive CVEs in `dompurify` via `@scalar/api-reference-react`** — documented as accepted in [`PRE_DEPLOY.md`](./PRE_DEPLOY.md#known-accepted-limitations) because the attack vector (user-injected HTML on `/api-docs`) is not reachable.

## Safe harbor

We will not pursue legal action against researchers who:

1. Make a good-faith effort to avoid privacy violations, destruction of data, or service interruption during research.
2. Report the vulnerability promptly via the channel above.
3. Do not exploit the vulnerability beyond what is minimally needed to demonstrate the issue.
4. Give us a reasonable window to fix before public disclosure.

## What helps a report move fast

- A clear reproduction (curl command, browser steps, or proof-of-concept payload).
- The affected commit SHA or deploy URL where the issue reproduces.
- The expected vs. observed behavior.
- Your assessment of severity and impact, with reasoning.

Reports without reproduction steps may take longer to triage.
