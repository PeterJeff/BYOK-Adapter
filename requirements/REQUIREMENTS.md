# Requirements tracking

Every concrete expectation set by `PLAN.md` and `CLAUDE.md` — a hard constraint, a security rule, a **LIVE-TEST** assumption, or a phase's acceptance criteria — listed against what is actually built and verified today. `PLAN.md` is the design; this file is the audit trail so an assumption doesn't quietly get relied on before it's confirmed, and so "built" doesn't get read as "verified."

Update this file in the same commit that changes status: when a phase's acceptance criteria are met, when a **LIVE-TEST** assumption gets a recorded fixture, or when a constraint's implementation changes.

**Status legend:** ✅ done and verified · 🔶 built but not verified (or partially built) · ⛔ not started · — not applicable yet

---

## 1. Hard constraints (`CLAUDE.md`)

| Constraint | Status | Evidence |
|---|---|---|
| Plain JavaScript, CommonJS, `// @ts-check` + JSDoc, no TypeScript, no build step | ✅ | All of `phase0/`, `scripts/`, `test/` are `.js`/`.mjs` with no `tsconfig.json` or transpile step |
| No npm dependencies, no lockfile, nothing vendored from `asksageclient` | ✅ | No `package.json` `dependencies`/`devDependencies` anywhere in the repo; `phase0/smoke-extension/package.json` declares none |
| Standalone scripts are `.mjs`, run under VS Code's bundled Node (`ELECTRON_RUN_AS_NODE=1`), Node 22, Windows-path safe | 🔶 | `scripts/pack-vsix.mjs`, `scripts/run-tests.mjs`, `phase0/probe/*.mjs` are written to this contract; not yet exercised through an actual VS Code executable (only plain Node in this environment) |
| Manual loading only (`.vsix`, unpacked folder, `--extensionDevelopmentPath`) | ✅ | `scripts/pack-vsix.mjs` builds a zero-dependency `.vsix`; `phase0/smoke-extension/README.md` documents all three load paths |
| Stable VS Code API only; proposed APIs / Copilot internals feature-detected and degrade silently | 🔶 | `phase0/smoke-extension` targets only the stable `LanguageModelChatProvider` API; whether Copilot internals it probes (thinking parts, `usage` data part) actually round-trip is E4, not yet run (see §3) |

## 2. Security rules (`PLAN.md` §6, `CLAUDE.md`)

| Rule | Status | Evidence |
|---|---|---|
| API key lives only in `SecretStorage`, never logged/printed/written to a fixture | ⛔ | No `auth/credentials.js` exists yet (Phase 1). The Phase 0b probe reads the key from `ASKSAGE_API_KEY`/`--key-file` and never prints or writes it (`phase0/probe/api-probe.mjs`), which is the interim equivalent for that script only |
| Host/tenant/endpoint settings `scope: "application"` (or `"machine"`), in `restrictedConfigurations` | ⛔ | No `package.json` `contributes.configuration` exists yet — the real extension (`src/`) hasn't been started |
| No prompt text in the ledger or reports by default | ⛔ | No `ledger/` exists yet |
| Recorded API fixtures redacted (key, tokens, user/org ids, emails, tenant host → alias) before being written | ✅ | `phase0/probe/lib/redact.mjs`, used by both `api-probe.mjs` and `catalog-audit.mjs`; redacted fixtures under `research/live/` for `chat.asksage.com` and `chat.asksage.ai` catalogs |

## 3. LIVE-TEST assumptions (`PLAN.md`)

Per `PLAN.md` line 14 and §13: every assumption marked **LIVE-TEST** must be confirmed by a recorded fixture for the tenant before code depends on it. None of the following may be assumed true in Phase 1+ code until its status below is ✅.

| PLAN.md ref | Assumption | Confirmed by | Status |
|---|---|---|---|
| §2.1 (cache pricing table) | CC (OpenAI-flavor) cache discount is billed by Ask Sage | T3 | ⛔ not run |
| §2.1 | Models with no listed cache rate (GPT-4.1, GPT-5/5.1/5.2, o-series, Gemini, several partner-hosted) are billed full price on every re-sent token | T1–T4 | ⛔ not run |
| §2.1 | Whether GPT rows carry a cache **write** rate, and how it's applied when OpenAI reports no writes | T3 | ⛔ not run |
| §3.3 | Monthly limit comes from `POST /user/validate_token_with_full_user` → `max_tokens` (plus `max_train_tokens`, org-pool settings, `force_models`, `custom_intro_prompt`) via API-key JWT | T0 | ⛔ not run |
| §3.3 | `POST /server/count-monthly-tokens` traffic can be tagged with `{app_name}` | T0 | ⛔ not run |
| §3.5 | Billing behavior of a cancelled stream | T9 | ⛔ not run |
| §5 | The stable VS Code API hands thinking parts / private-MIME `LanguageModelDataPart`s back to a third-party provider in later requests | E4 | 🔶 built (`phase0/smoke-extension`), not yet run on the target machine |
| §8 | Which balance (inference or training) embeddings charge | T20 | ⛔ not run |
| §8 | `/get <text>` or `/get-dataset-results` give results-only dataset search | T21 | ⛔ not run (opt-in; needs `--dataset`) |

## 4. Phase 0 tests

### 0a — environment smoke test (E1–E5)

| Test | Question | Status |
|---|---|---|
| E1 | Extension-contributed models appear in the chat model picker | 🔶 built, not run on target machine |
| E2 | Agent mode uses the model and passes it tools | 🔶 built, not run on target machine |
| E3 | `.vsix` side-loading is permitted | 🔶 built, not run on target machine |
| E4 | Thinking parts / private-MIME data parts round-trip through history | 🔶 built, not run on target machine |
| E5 | Extension host `fetch` reaches the tenant host through local proxy/TLS inspection | 🔶 built, not run on target machine |

**Exit (`research/live/<tenant-alias>/phase0a-report.md`): not yet produced.**

### 0b — API probes (T0–T21)

| Status | Detail |
|---|---|
| 🔶 built, attempted, blocked on credentials | `phase0/probe/api-probe.mjs` implements T0–T21; needs `ASKSAGE_API_KEY` + `ASKSAGE_EMAIL` against a real tenant. Unit-testable pieces covered by `test/probe/api-probe.test.mjs`. A T0+T19 run from a cloud sandbox (`research/live/sandbox-proxy/`) confirmed the sandbox's network proxy does *not* inject a working Ask Sage credential despite environment metadata claiming it does — see `research/live/sandbox-proxy/README.md`. Every LIVE-TEST assumption in §3 above is still ⛔; that run only corroborates the already-known bad-auth envelope shape (PLAN.md §7) |

**Exit (`research/live/FINDINGS.md`): does not exist yet.**

### 0c — target-tenant subset

⛔ Not started. Contingent on the open decision "which tenant is the day-to-day target" (§5 below).

### Catalog audit (public, unauthenticated — separate from T0–T21)

| Tenant | Status | Evidence |
|---|---|---|
| `chat.asksage.com` | ✅ run | `research/live/chat.asksage.com/catalog/` |
| `chat.asksage.ai` | ✅ run | `research/live/chat.asksage.ai/catalog/` |
| Findings write-up | ✅ | `research/model-catalog-findings.md` |

## 5. Phase acceptance criteria (`PLAN.md` §9)

| Phase | Acceptance | Status |
|---|---|---|
| 0a | E1–E5 all pass, or the plan is revised | ⛔ not run |
| 0b | `research/live/FINDINGS.md` with default flavor table, cache policy, normalization rules confirmed/corrected | ⛔ not run |
| 0c | T0, T1–T6, T7, T15–T19 re-run on the day-to-day tenant if it differs from the test tenant | ⛔ not started |
| 1 | Claude (M) and GPT-5.x (CC) stream in Ask mode; every request lands in the ledger with a normalized, estimated cost; spend cap stops a synthetic runaway loop | ⛔ not started (no `src/`) |
| 2 | ≥80% cache reads from round 2 on ≥1 Claude and ≥1 GPT-5.x model in a multi-step agent task; Claude+thinking completes a 5+ round tool loop with no errors; estimate accuracy within ±10% (per-request or batch, per T19) | ⛔ not started |
| 3 | Pre-flight estimate/warnings/hard stop, budget-mode experiment, burn-rate forecast, request-tokens command, cache-health/fallback alarms, reconciliation display | ⛔ not started |
| 4 | R, G, multi-flavor picker, workspace policy, rate override editor, optional web-app rate refresher | ⛔ not started |
| 5 | `#asksageCodebase` and `#asksageDocs` tools (gated on §8's usage-gap check), N as opt-in variant | ⛔ not started |
| 6 | Reports webview, CSV export, `.vsix`, README covering cache-capable models, utility-model cost, budget mode findings, workspace policy | ⛔ not started |

## 6. Open decisions (`PLAN.md` §12)

| Decision | Status |
|---|---|
| Data-handling policy for code sent to the API; default `asksage.workspacePolicy` | ⛔ unresolved |
| Which tenant is the day-to-day target; whether Phase 0c is needed | ⛔ unresolved |
| VS Code version and policy on the target machine | ⛔ unresolved (answered by Phase 0a, not yet run) |
| Ask Sage's terms for third-party clients | ⛔ unresolved |
| Whether the extension is for one user or shared | ⛔ unresolved |
| Whether the optional web-app rate refresher is acceptable | ⛔ unresolved |
