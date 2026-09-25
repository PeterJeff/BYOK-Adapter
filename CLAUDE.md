# BYOK-Adapter: working rules

A VS Code language-model provider extension that connects Copilot Chat to the Ask Sage API with proper caching and cost awareness. `PLAN.md` is the design and the phase plan; follow it phase by phase and stop at the end of each phase to report against its acceptance criteria.

## Hard constraints (target machine has VS Code and nothing else)

- **Plain JavaScript only.** CommonJS (`require`/`module.exports`) for extension code, `// @ts-check` at the top of every file, types in JSDoc. No TypeScript sources, no transpiling, no bundling, no build step.
- **No npm, no dependencies.** Only Node built-ins and the `vscode` API. Never add a `package.json` dependency, `devDependency` or lockfile, and never vendor third-party code (and never copy from `asksageclient`, which is proprietary).
- **Scripts run on VS Code's bundled Node** (`ELECTRON_RUN_AS_NODE=1 <Code executable> script.mjs`), so they must work on the Node version inside current VS Code (Node 22) and on Windows paths. Standalone scripts are ES modules (`.mjs`).
- **Manual loading.** The extension is side-loaded: a `.vsix` built by `scripts/pack-vsix.mjs`, an unpacked folder, or `--extensionDevelopmentPath`. Nothing may assume the Marketplace.
- **Stable VS Code API only.** Proposed APIs and Copilot internals (`LanguageModelThinkingPart`, `modelOptions._conversationId`, the `usage` data part) are feature-detected and must degrade silently.

## Security rules (PLAN.md §6)

- The API key lives only in SecretStorage and is never logged, printed or written to a fixture.
- Host, tenant and endpoint settings are `"scope": "application"` (or `"machine"`) so a workspace cannot redirect the bearer token.
- No prompt text in the ledger or reports by default.
- Recorded API fixtures are redacted before they are written (key, tokens, user/org ids, emails, tenant host → alias).

## Layout

- `PLAN.md`: the plan (v3 plus the JavaScript-only note).
- `phase0/smoke-extension/`: Phase 0a echo provider for tests E1–E5. Pure logic in `lib/` has no `vscode` import.
- `scripts/pack-vsix.mjs`: zero-dependency `.vsix` packer (`scripts/lib/zip.mjs` is the zip writer).
- `scripts/run-tests.mjs`: runs every `test/**/*.test.{js,mjs}` with `node:test`.
- `test/helpers/vscode-stub.js`: minimal `vscode` module for driving extension code under `node:test`.
- `phase0/probe/catalog-audit.mjs`: public, unauthenticated model-catalog audit for an instance (pure checks in `phase0/probe/lib/catalog.mjs`).
- `phase0/probe/api-probe.mjs`: Phase 0b authenticated probes T0–T21 (tests in `lib/tests.mjs`, redaction in `lib/redact.mjs`). Spends tokens; key from `ASKSAGE_API_KEY` + `ASKSAGE_EMAIL`; always `--dry-run` first. With no key set (or `--no-auth-headers`), it sends no client credential and assumes a gateway in front of `--api` authenticates requests instead.
- `research/`: partly committed (see PLAN.md §0). `model-catalog-findings.md` explains model naming and the per-instance catalog mismatches. Phase 0 recordings go to `research/live/<tenant-alias>/`.
- `requirements/REQUIREMENTS.md`: expectations (hard constraints, security rules, LIVE-TEST assumptions, phase acceptance criteria) vs. what's actually built and verified. Update it in the same commit that changes a status.

## Commands

- Tests: `node scripts/run-tests.mjs [filter]` (on the target machine: `ELECTRON_RUN_AS_NODE=1 <Code> scripts/run-tests.mjs`).
- Package: `node scripts/pack-vsix.mjs <extension folder> [--out file.vsix]`; inspect with `--list file.vsix`.

## Conventions

- Keep pure logic (converters, normalizers, parsers, cost formula, cache placement) free of `vscode` imports so it is unit-testable; inject what it needs.
- Every **LIVE-TEST** assumption in PLAN.md must be confirmed by a recorded fixture for the tenant before code depends on it.
- Type-checking is optional in a dev environment that has `tsc` and `@types/vscode` (for example `tsc --allowJs --checkJs --noEmit --strict`); never make it a requirement.

## Where Phase 0b's paid probes may run

Whether a hosted/cloud Claude Code session (GitLab, a remote container, CI) has a working Ask Sage credential depends entirely on that session's own proxy configuration — don't assume either way; check first, as below. This project's remote container has, at times, had a proxy that injects a real credential for `api.asksage.ai` with no `ASKSAGE_API_KEY`/`ASKSAGE_EMAIL` needed in-process — see `research/live/test-tenant/README.md` for how that was confirmed and two gotchas that cost real debugging time:
1. The proxy may silently authenticate nothing at all (every call gets the same "Token is invalid" a real unauthenticated request would) even though environment metadata claims it injects a credential — verify with a real endpoint (e.g. `validate_token_with_full_user`) before trusting it. `research/live/sandbox-proxy/README.md` documents this dead end.
2. Node's built-in `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node ≥22.21) — `curl` respects the proxy by default and `fetch` doesn't, which looks exactly like a broken credential until you notice the discrepancy. Always run `api-probe.mjs` (and any other script using `fetch` against a real host) from such a session with `NODE_USE_ENV_PROXY=1` set.

Even once auth genuinely works, **don't spend Ask Sage tokens without the user's explicit go-ahead for that spend**, and don't try to run the full paid battery (T1–T9, T11, T15–T18, T20; ~13k tokens) as one autonomous batch — Claude Code's own safety classifier blocks large unsupervised "real-world transaction" runs (including via `run_in_background`), and per its own guidance that block is not something to route around by chunking the same batch into smaller pieces run back-to-back without the user present. A small, individually-approved test (T0, T19) is fine; the full battery needs the user running it directly, or explicitly adjusting their Bash permission settings to allow it.

One more caveat found the hard way: if the proxy substitutes a real credential into *any* value in a recognized auth header (as opposed to routing unauthenticated requests through untouched), T0's "bad auth returns an error envelope" check cannot produce a real result — every flavor gets a real authenticated response instead of an auth rejection. That check needs a path to Ask Sage that isn't behind such a proxy.
