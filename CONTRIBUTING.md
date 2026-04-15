# Contributing to Aegis

Aegis is a content-quality filter that learns your taste, curates a zero-noise briefing, publishes signals to Nostr, and exchanges content with other agents over an encrypted [D2A protocol](docs/D2A_PROTOCOL.md). This guide is for both first-time contributors and feature-shippers.

## Quick start

```bash
git clone https://github.com/dwebxr/aegis.git
cd aegis
npm install
npm run dev          # http://localhost:3000
```

The development build talks to the **production Internet Computer canister** (`rluf3-eiaaa-aaaam-qgjuq-cai`) by default, so you do not need a local `dfx` install for most work. If you are changing Motoko code under `canisters/` you will need [dfx 0.30.2+](https://internetcomputer.org/docs/current/developer-docs/setup/install/) and a local replica.

A single environment variable is required for AI scoring; without it, Aegis falls back to on-device or heuristic scoring.

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env.local
```

The full env-var list (including optional Sentry DSN, Vercel KV for shared rate-limiting, push notification keys, and x402 payment receivers) lives in `.env.example`.

## Running tests

```bash
npm test                 # jest — 405 suites, ~7,200 unit/integration tests
npm run test:watch       # jest in watch mode
npm run test:e2e         # playwright — only run against a running dev server
npm run lint             # next lint
npx tsc --noEmit         # type check
```

A full pre-PR check is `npm run lint && npx tsc --noEmit && npm test`. Add `npm run test:e2e` if you touched UI.

## Project layout

| Directory | What lives here |
| --- | --- |
| `app/` | Next.js 15 App Router pages and API routes |
| `app/api/*/route.ts` | 19 server routes (analyze, briefing, fetch, translate, push, x402) |
| `components/` | React UI — `tabs/`, `settings/`, `audio/`, `agent/`, `ui/` (shadcn shells), `icons/`, `layout/` |
| `contexts/` | React contexts; `ContentContext` is the orchestrator with sub-modules in `contexts/content/` |
| `lib/` | Pure logic — `briefing/`, `filtering/`, `scoring/`, `agent/` (D2A), `nostr/`, `ingestion/`, `preferences/`, `d2a/`, `ic/`, `translation/`, `audio/` |
| `canisters/aegis_backend/main.mo` | Motoko persistent actor — the only on-chain code |
| `__tests__/` | Jest test files mirroring the source tree |
| `e2e/` | Playwright tests |
| `docs/` | Public-facing specs (`D2A_PROTOCOL.md`) |

The scoring cascade (Ollama → MediaPipe → WebLLM → Claude BYOK → IC LLM → Heuristic) lives in `contexts/content/scoring.ts`. The translation cascade (similar shape, different backends) lives in `lib/translation/engine.ts`. Both are intentionally fault-tolerant by design — the cascade IS the feature, not defensive programming.

## Commit messages

Aegis uses informal Conventional Commits — readable by humans, lightly enforced by reviewers, **not** policed by a `commitlint` hook.

```
<type>[(<scope>)]: <imperative summary, ≤72 chars>

Optional body, wrapped at ~80 cols. Explain the *why*, not the *what* —
the diff already shows the *what*.

Co-Authored-By: <name> <email>
```

Common type values:

| Type | Meaning |
| --- | --- |
| `feat` | A user-visible new feature |
| `fix` | A bug fix |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `perf` | A change that improves performance |
| `chore` | Tooling, deps, scaffolding, mass cleanups |
| `docs` | Documentation only |
| `test` | Adding or repairing tests |
| `merge` | Multi-branch integration (used for parallel-agent worktree merges) |

Common scopes seen in the log: `(readme)`, `(tooling)`, `(types)`, `(deps)`, `(d2a)`, `(audio)`, `(quality)`, `(plans)`, `(ui)`, `(ingestion)`, `(cleanup)`. Pick one when it sharpens the message.

Bad: `Update file`. Good: `fix(audio): kill runSession loop on pause via labeled continue`.

## Pull request process

1. **Branch from `main`** with a short kebab-case branch name. Long-running feature branches are discouraged.
2. **Open the PR against `main`**.
3. **Required checks** — these will run on the PR and must pass before merge:
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run lint`
   - `npm run test:e2e` if you changed anything user-visible
4. **PR body** — short summary plus a Test Plan checklist (what you manually verified). For UI changes, include a screenshot.
5. **Review** — a maintainer will read it. Small clarifying comments are welcome; major direction changes get a discussion comment first.
6. **Merge** — squash-merge by default. Maintainers may request a rebase if the PR has logical sub-commits worth preserving.
7. **No `--no-verify`** — if a hook fails, fix the underlying issue rather than skipping the hook.

## Style notes

- **Don't write defensive `try/catch`** unless you are at a real trust boundary (network, file I/O, JSON.parse on external data, IC canister call). Internal-only code should let exceptions propagate so Sentry sees them.
- **Don't write echo comments.** `// Increment counter` above `counter++` is noise. Comment only when the *why* would surprise a future reader.
- **Don't add `any` to make the build pass.** Find the right type, or use `unknown` at trust boundaries with explicit narrowing.
- **Don't introduce abstractions for hypothetical futures.** Three similar lines is not duplication; four is borderline; five with complex logic warrants a helper.
- **Prefer editing existing files** over creating new ones. New top-level directories need explicit justification.

## Architecture deep-dives

- [`docs/D2A_PROTOCOL.md`](docs/D2A_PROTOCOL.md) — wire-format spec for the agent-to-agent protocol.
- [`README.md`](README.md) — top-level overview and the running changelog of major changes.
- [`PRE_DEPLOY.md`](PRE_DEPLOY.md) — pre-deploy checklist and known accepted limitations.
- [`ROLLBACK.md`](ROLLBACK.md) — Vercel + IC canister rollback procedures.

## Where to find help

- **GitHub Discussions** — open-ended questions, design proposals: <https://github.com/dwebxr/aegis/discussions>
- **GitHub Issues** — bugs, tracked work: <https://github.com/dwebxr/aegis/issues>
- **Discord** — synchronous chat, casual questions: <https://discord.gg/85JVzJaatT>
- **Good first issues** — the maintainers tag tickets `good first issue` when scope and acceptance criteria are tight enough that a new contributor can finish in one sitting. Filter: <https://github.com/dwebxr/aegis/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22>. The current curated catalog lives at [`.github/good-first-issues.md`](.github/good-first-issues.md).

## Reporting a security issue

Please **do not** open a public GitHub issue for a security vulnerability.

Instead, use GitHub's private vulnerability reporting: <https://github.com/dwebxr/aegis/security/advisories/new>. Maintainers will acknowledge within 72 hours and aim to ship a fix within 14 days for high-severity issues. We follow a coordinated-disclosure approach: once the fix is shipped, we credit you in the advisory unless you prefer to remain anonymous.

Out-of-scope (please do not report): denial-of-service via repeatedly hitting any unauthenticated endpoint, social engineering of operator accounts, vulnerabilities in third-party services we depend on (report those upstream).

## Code of Conduct

Aegis follows the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be kind, assume good faith, prefer charitable interpretations of others' words, and let the maintainers handle escalations.

---

Thanks for being here. The fastest way to learn the codebase is to fix one thing — pick a `good first issue` and ask a question if anything is unclear.
