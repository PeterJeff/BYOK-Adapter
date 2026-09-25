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
- `phase0/probe/api-probe.mjs`: Phase 0b authenticated probes T0–T21 (tests in `lib/tests.mjs`, redaction in `lib/redact.mjs`). Spends tokens; key from `ASKSAGE_API_KEY` + `ASKSAGE_EMAIL`; always `--dry-run` first.
- `research/`: partly committed (see PLAN.md §0). `model-catalog-findings.md` explains model naming and the per-instance catalog mismatches. Phase 0 recordings go to `research/live/<tenant-alias>/`.

## Commands

- Tests: `node scripts/run-tests.mjs [filter]` (on the target machine: `ELECTRON_RUN_AS_NODE=1 <Code> scripts/run-tests.mjs`).
- Package: `node scripts/pack-vsix.mjs <extension folder> [--out file.vsix]`; inspect with `--list file.vsix`.

## Conventions

- Keep pure logic (converters, normalizers, parsers, cost formula, cache placement) free of `vscode` imports so it is unit-testable; inject what it needs.
- Every **LIVE-TEST** assumption in PLAN.md must be confirmed by a recorded fixture for the tenant before code depends on it.
- Type-checking is optional in a dev environment that has `tsc` and `@types/vscode` (for example `tsc --allowJs --checkJs --noEmit --strict`); never make it a requirement.
