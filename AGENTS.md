# AGENTS.md: how to work on BYOK-Adapter

The working rules for anyone changing this repository: a person, Claude Code, Copilot, Codex, Aider, Kilo Code, Continue or any other agent.

**How tools find this file.**
- Claude Code loads it through `CLAUDE.md`, which imports it.
- VS Code's Copilot reads it from the workspace root; `.github/copilot-instructions.md` also points here.
- For other tools, add this file to the tool's rules or context: for example `aider --read AGENTS.md`, or a Continue or Kilo Code rule that includes it.

**Rules here win over habits.** Section 4 says where every kind of information is written. Section 5 says when to update it.

## 1. The project in brief

A VS Code language-model provider extension that connects Copilot Chat to Ask Sage's API endpoints. It adds working prompt caching, a choice of endpoint per model, and visibility of cost and budget. `PLAN.md` is the design and the phase plan: follow it phase by phase, and stop at the end of each phase to report against its acceptance criteria.

**Terms used throughout.**
- **The machine**: the computer the extension is built for.
  - It has VS Code and nothing else: no npm and no build tools.
  - It is never signed in to Copilot.
  - Nothing physical comes back from it: no files, logs or copied text. What comes back is the owner's spoken account of what they saw, so the extension must explain itself in plain language there (PLAN §14).
- **The dev machine**: where the extension is built and tested.
- **The test tenant**: the public `api.asksage.ai`. It and the dev machine are the reference environment, and every phase is accepted there.
- **The owner**: the repository owner. They approve any spending and decide what is published.
- **Flavor**: which endpoint a model is called through: M (Anthropic Messages), CC (Chat Completions), R (Responses), G (Gemini) or N (native). See PLAN §2.

## 2. Hard constraints

- **Plain JavaScript only.** CommonJS (`require`/`module.exports`) for extension code, `// @ts-check` at the top of every file, and types in JSDoc. No TypeScript sources, no transpiling, no bundling, no build step.
- **No npm and no dependencies.** Only Node built-ins and the `vscode` API.
  - Never add a `package.json` dependency, `devDependency` or lockfile.
  - Never vendor third-party code, and never copy from `asksageclient`, which is proprietary.
- **Scripts run on VS Code's bundled Node** (`ELECTRON_RUN_AS_NODE=1 <Code executable> script.mjs`). They must work on Node 22 or newer (VS Code 1.139 bundles Node 24.20) and with Windows paths. Standalone scripts are ES modules (`.mjs`).
- **Manual loading.** The extension is side-loaded: a `.vsix` built by `scripts/pack-vsix.mjs`, an unpacked folder, or `--extensionDevelopmentPath`. Nothing may assume the Marketplace.
- **No Copilot sign-in, ever.** Neither the machine nor the dev machine is ever signed in to GitHub Copilot. The extension relies on VS Code 1.122 or later letting extension-provided models work with no GitHub account or Copilot plan. Never design or test around a signed-in account, and never require one.
- **Stable VS Code API only.** Proposed APIs and Copilot internals (`LanguageModelThinkingPart`, `modelOptions._conversationId`, the `usage` data part) are feature-detected and must degrade silently.

## 3. Security, spending and the public repo

- **API key.** It lives only in SecretStorage, and is never logged, printed or written to a fixture.
- **Scoped settings.** Host, tenant and endpoint settings are `"scope": "application"` (or `"machine"`), so a workspace cannot redirect the bearer token.
- **No prompt text** in the ledger, the health report or anything else by default. The opt-in `asksage.debug.logRequests` is the only exception.
- **Recorded fixtures are redacted before they are written**: the key, tokens, user and org ids, emails, and the tenant host (replaced by an alias).
- **Never spend Ask Sage tokens without the owner's explicit go-ahead** for that spend. Dry-run first, and use the cheapest model that answers the question.
- **This repository is public.**
  - Don't write the owner's personal or working context into anything tracked, into commit messages or into PR text. That means who they work for or with, where, on what, over which networks, and with which accounts.
  - Use neutral words: "the machine", "a private instance", "the owner".
  - Vendor names, model ids and API field names appear only where they are technically needed. Don't add commentary about who uses the extension, or under which rules.
  - Commit with a GitHub noreply address, never a personal one.
- **Results from a private instance never go in this repo.** Run the probes with `--alias private-<name>` (output lands in `research/live/private-*/`) or `--out private/<...>`; both are gitignored. See `research/handoff/private-instance-billing-run.md`.
- **Private context.** If `private/CONTEXT.md` exists, read it. It is a gitignored file that holds background which cannot be public. Never copy anything from it into a tracked file.

## 4. Where things are written

### 4.1 One home per fact

Each kind of information has exactly one home. Everywhere else, point to that home instead of restating the fact.

| Kind of information | Its home | Never put it in |
|---|---|---|
| Design: what the extension does, why, and in which phase | `PLAN.md` | Status or "built on <date>" |
| Status: built, verified or not, per expectation | `REQUIREMENTS.md` | Narrative or history |
| Defects: known bugs and project-level problems, with evidence | `DEFECTS.md` | Fixed items: delete them |
| Open work, in priority order | `TODO.md` | Detail: one line and a pointer |
| Measured evidence, and the queue of probes to run | `research/live/FINDINGS.md`, with fixture paths | Design decisions |
| Phase status in one line each | `README.md` | Anything longer |
| How to load, configure and troubleshoot the extension | `src/README.md` | Status |
| Working rules for people and agents | `AGENTS.md` (this file) | Project facts |
| Rules specific to Claude Code (cloud sessions, its classifier) | `CLAUDE.md` | Anything that applies to every tool |
| History | git, and PLAN §11 for design versions | Running text in the other files |

### 4.2 Directory of documents and references

| Path | What it is |
|---|---|
| `README.md` | Entry point: what the project is, and the phase status |
| `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` | Working rules (this file), and the files that load it |
| `PLAN.md` | The design and phase plan. Its research index is §0, the test ids are §9, and the on-machine health report is §14 |
| `REQUIREMENTS.md`, `DEFECTS.md`, `TODO.md` | Status, defects, open work |
| `src/README.md` | The extension's user guide, including known interactions with VS Code and Copilot |
| `phase0/smoke-extension/README.md` | The zero-cost echo provider for the environment checks (E1–E5) |
| `phase0/probe/README.md` | The API probe scripts: `api-probe`, `catalog-audit`, `rate-sources`, `billing-probe` and `prompt-log`. What each one spends, and how to dry-run it |
| `research/live/FINDINGS.md` | All measured evidence, and the "Still open" probe queue |
| `research/live/<tenant>/…` | Recorded fixtures and per-run notes. `test-tenant/README.md` covers how the test tenant is reached, `test-tenant/t12/README.md` the built-in Custom Endpoint baseline, and `test-tenant/phase0a-*.md` the environment checks |
| `research/rate-sources-investigation.md` | How Ask Sage bills: rates, cache rules and the prompt log (117 measured requests) |
| `research/model-catalog-findings.md` | Model naming, and how the catalogs differ between instances |
| `research/sources/asksage-docs/<date>/` | Dated snapshots of the vendor's docs and OpenAPI specs. The specs win whenever a digest disagrees |
| `research/reports/` | Reports for readers outside the project: the public caching and billing report, and a template |
| `research/handoff/` | Briefs written for other agent sessions. Check each against the current repo before trusting it |
| `private/` (gitignored) | Private context (`CONTEXT.md`) and private-instance results. Never committed |

**External references**, read at the source and snapshotted under `research/sources/` when a decision depends on them:
- Ask Sage's documentation (`docs.asksage.ai`, including `llms-full.txt`) and its OpenAPI specs
- VS Code's Language Model Chat Provider API and Copilot BYOK documentation
- Anthropic's Messages API reference
- OpenAI's Chat Completions and Responses references

## 5. Keeping the documents in sync

### 5.1 When something happens, update these, in the same commit

| Event | Update |
|---|---|
| A measurement or probe result | FINDINGS (with the fixture path). REQUIREMENTS §3 if it confirms or refutes a LIVE-TEST. PLAN if it changes the design. TODO: remove or adjust the item |
| Code completes a designed item | REQUIREMENTS (the status). README if a phase changes state. TODO: delete the item |
| A bug is found | A DEFECTS entry: id, severity, how it was established, where, what, effect, and a fix direction. A TODO line if it is prioritized |
| A bug is fixed | Delete its DEFECTS entry and say so in the commit message. Update REQUIREMENTS if a status changes |
| A design decision | PLAN, plus a PLAN §11 line if it is significant. REQUIREMENTS §6 when an open decision is closed |
| A file is added, moved or renamed | §4.2 of this file. Grep the repository for the old path |
| A new kind of information with no home | Pick a home in §4.1 first, then write it |

### 5.2 Writing rules

- **Short.** A table cell is one or two sentences plus a pointer. A TODO item is one line. If a note grows past a few lines, its detail belongs in FINDINGS (evidence) or DEFECTS (a problem).
- **Present tense only for what is true now.** When a fact changes, grep for its other mentions and fix them. Date the evidence, not the design.
- **Check a "correction" against the evidence before writing it.** A statement that contradicts FINDINGS or a Phase 0 report needs a fixture of its own, not an inference from typings, stubs or code comments (DEFECTS D11 is what happens otherwise).
- **Handoffs cite a commit.** A summary from another session is a pointer, not the state. The repository at its newest commit wins.

### 5.3 Audits

Drift between the documents, and between the documents and the code, is expected: sessions start cold and read only part of the repository. Audits catch it.

**When.** At the end of each phase, before a build goes to the machine, and whenever a session finds two documents contradicting each other.

**Checklist.**
1. Paths and links resolve, and no document points at a moved or deleted file.
2. PLAN has no status in it. Each REQUIREMENTS row matches the code and the evidence.
3. Every DEFECTS entry still holds in the code, and every fixed one is deleted.
4. TODO's order is still right, and done items are gone. README's phase lines match REQUIREMENTS §5.
5. Unmerged branches: `git fetch`, then `git log origin/main..origin/<branch>` for each branch.
6. A wording pass over everything changed since the last audit, against §3's public-repo rule.

**Output.** One commit titled "Doc audit: …". Systemic problems become DEFECTS P-entries.

## 6. Working on the project

- **Priority.** Follow `TODO.md`'s order rather than re-deriving it. That includes its model-family order for testing and features (ChatGPT, Gemini, Grok, other third-party models, Claude last). FINDINGS "Still open" orders the probe queue within it.
- **Start from the newest branch, not only `main`.** Work often sits on an unmerged branch for a while: `git fetch` and compare before trusting `main`. Merge finished work promptly so `main` stays current.
- **LIVE-TEST.** Every assumption marked **LIVE-TEST** in PLAN must be confirmed by a recorded fixture before code depends on it.
- **Pure logic stays free of `vscode` imports:** converters, normalizers, parsers, the cost formula, cache placement. Inject what it needs, so it can be unit-tested.
- **Test against recorded responses** in `research/live/` wherever one exists (PLAN §10). A fake written by the same session that wrote the code only tests that session's assumptions (DEFECTS P3).
- **User-visible errors and health-report lines are plain language.** They name the feature the way PLAN §14.2 does, and give the likely cause and what to try. They never show the API key or tokens.
- **Type-checking is optional** in a dev environment that has `tsc` and `@types/vscode` (for example `tsc --allowJs --checkJs --noEmit --strict`). Never make it a requirement.

## 7. Commands

- Tests: `node scripts/run-tests.mjs [filter]`. With no Node installed, use VS Code's: `ELECTRON_RUN_AS_NODE=1 <Code executable> scripts/run-tests.mjs`.
- Package: `node scripts/pack-vsix.mjs <extension folder> [--out file.vsix]`. Inspect the result with `--list file.vsix`. The extension folder is `src`.
- Probes: see `phase0/probe/README.md`. Always `--dry-run` first. Probes that spend tokens need the owner's go-ahead (§3).
