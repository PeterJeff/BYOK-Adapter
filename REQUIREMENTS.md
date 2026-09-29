# Requirements tracking

Every concrete expectation set by `PLAN.md` and `AGENTS.md` (a hard constraint, a security rule, a **LIVE-TEST** assumption, a phase's acceptance criteria), listed against what is built and verified today. `PLAN.md` is the design, and this file is the status: it keeps "built" from being read as "verified".

Keep each cell to one or two sentences, plus a pointer to the evidence or the defect. Update the file in the same commit that changes a status (AGENTS.md §5).

**Legend:** ✅ done and verified · 🔶 built but not verified, or partly built · ❌ verified false · ⛔ not started · — not applicable

**Branch note (2026-09-29).** Phases 2 and 3 are on `claude/phase2-m-and-caching` and are not merged. `main` has Phase 1.

---

## 1. Hard constraints (`AGENTS.md` §2)

| Constraint | Status | Evidence |
|---|---|---|
| Plain JavaScript, CommonJS, `// @ts-check` + JSDoc; no TypeScript, no build step | ✅ | `src/`, `phase0/`, `scripts/` and `test/` are all `.js`/`.mjs`; there is no `tsconfig.json` or transpile step |
| No npm dependencies, no lockfile, nothing vendored from `asksageclient` | ✅ | No `dependencies`/`devDependencies` in any `package.json` |
| Scripts run on VS Code's bundled Node (Node 22+, Windows paths) | ✅ | 2026-09-25, VS Code 1.139.0 (Node 24.20): `run-tests.mjs`, `pack-vsix.mjs` and `api-probe.mjs --dry-run` ran through `Code.exe` with `ELECTRON_RUN_AS_NODE=1` |
| Works with no Copilot or GitHub sign-in | 🔶 | Dev machine, 1.139.1, signed out: the picker, Ask mode and Agent mode work (`research/live/test-tenant/phase0a-report.md`). 1.139.0 asked for a sign-in in a fresh profile; cause unknown (TODO). The declared minimum is still 1.104 (DEFECTS D21) |
| Manual loading only | ✅ | `scripts/pack-vsix.mjs`; every live test so far used a folder install |
| Stable API only; proposed APIs and Copilot internals feature-detected | 🔶 | `src/` feature-detects `LanguageModelThinkingPart`, the System role, `LanguageModelDataPart.json` and `_conversationId`. Not audited file by file |

## 2. Security rules (`PLAN.md` §6, `AGENTS.md` §3)

| Rule | Status | Evidence |
|---|---|---|
| API key only in SecretStorage; never logged, printed or written to a fixture | 🔶 | `src/auth/credentials.js`. In live use since 2026-09-27. A code review finds no path that logs it: the opt-in debug log writes request bodies, not headers |
| Host, tenant and email settings are application-scoped and in `restrictedConfigurations` | 🔶 | `src/package.json`; `src/config/settings.js` reads user settings only; unit-tested. The live workspace-override check is open (TODO) |
| No prompt text in the ledger or reports by default | ✅ | `test/ledger/writer.test.js`. The only exception is the opt-in `asksage.debug.logRequests` |
| Recorded fixtures are redacted before they are written | ✅ | `phase0/probe/lib/redact.mjs`, used by `api-probe.mjs` and `catalog-audit.mjs` |
| The health report never shows the API key, access tokens or prompt text | ⛔ | Designed in PLAN §14; not built |

## 3. LIVE-TEST assumptions (`PLAN.md`)

Code may not depend on an assumption until its status here is ✅ (or ❌, which means the plan was corrected).

| PLAN ref | Assumption | Status and evidence |
|---|---|---|
| §2.1 | Ask Sage bills the CC (OpenAI) cache discount | ✅ For Azure OpenAI on CC and R: read 0.1×. Not for Bedrock-hosted GPT. `research/live/test-tenant/billing/2026-09-25/measurements.json` |
| §2.1 | Models with no listed cache rate are billed in full on every resent token | ❌ False for Azure GPT (4.1-nano and 5.4-nano read at 0.1×). True for Gemini through G and for Bedrock GPT-5.6. Same file |
| §2.1 | GPT cache write rate | ✅ 1.25× on reported `cache_write_tokens` (GPT-5.6 and 6); no charge where none is reported. Same file |
| §2.1 | Claude cache multipliers: read 0.1×, 5m write 1.25×, 1h write 2× | ✅ On Vertex and Bedrock Claude. The exception is Opus 5.5, which reads at 0.05×. Fable 5.1's 0.025× is not measured. FINDINGS "Corrected" |
| §2.1 | Cache TTLs | 🔶 Claude 5m expired after 8 min; 1h held after 28 min (60 min or more not measured). OpenAI hit at 6 min and missed at 20. `measurements.json` |
| §2 | Claude through CC is billed | ❌ Billed 0 (an Ask Sage bug). Never route Claude through CC |
| §2.2 | Which families M serves besides Claude | ⛔ Queued in the `breadth` matrix (FINDINGS "Still open") |
| §3.1 | `get-models` `token_conversion_rate` is the billed rate | ❌ Billed rates come from `/server/tokenizer` `convert_to_asksage`. `research/rate-sources-investigation.md` |
| §3.3 | The monthly limit comes from `validate_token_with_full_user` with an API-key JWT | ✅ `research/live/test-tenant/probe/2026-09-25-1534-b69656/T0/008-*` |
| §3.3 | `count-monthly-tokens` can be tagged with `app_name` | ❌ It makes no difference. `research/live/test-tenant/README.md` |
| §3.5 | Billing of a cancelled stream | ✅ Billed for somewhat more than was streamed, far below the cap. FINDINGS "Corrected" (T9) |
| §3.6 | The prompt log's `total_tokens` is the exact bill | ✅ 117 rows summed exactly to the counter delta. `research/rate-sources-investigation.md` §1 |
| §5 | Reasoning state round-trips on flagship models | ✅ Sonnet 5 (M) and GPT-6 Sol (R). FINDINGS "Confirmed" |
| §5 | Opus 5.5 thinking survives a history edit | ⛔ Untested; FINDINGS "Still open" |
| §5 | VS Code hands thinking parts back to a third-party provider | ✅ Inside a tool loop (6 rounds, 64 KB signatures intact); never between turns; data parts never. `research/live/test-tenant/phase0a-e4-loop.md` |
| §8 | Which balance embeddings are charged to | ✅ The training balance. FINDINGS "Confirmed" (T20) |
| §8 | Results-only dataset search leads | ⛔ T21 not run (opt-in) |

## 4. Phase 0 tests

| Test | Status |
|---|---|
| E1 signed-out picker | ✅ Dev machine (1.139.1). The machine has run the extension; no details come back (PLAN §9) |
| E2 agent mode with tools | ✅ Dev machine: 51–52 tools, and a tool round trip |
| E3 side-loading | ✅ Dev machine, folder install (`phase0a-e4-loop.md`) |
| E4 thinking and data parts in history | ✅ See §3 above |
| E5 network through proxy and TLS | ✅ Dev machine (no proxy). On the machine, the PLAN §14 health report's "Connection to Ask Sage" line, once built |
| T0–T22 (Phase 0b) | ✅ Full default battery 2026-09-26 (`research/live/manual-run/probe/2026-09-26-0402-c5ced6/`, 8,550 tokens): 25 pass, and 2 failures both explained. Follow-ups and the open probes: FINDINGS "Still open". T12: first run only (`research/live/test-tenant/t12/README.md`) |
| Catalog audits | ✅ `research/live/chat.asksage.com/catalog/` and `chat.asksage.ai/catalog/`; write-up in `research/model-catalog-findings.md` |

## 5. Phase acceptance (`PLAN.md` §9)

| Phase | Status |
|---|---|
| 0a | ✅ Dev machine; `research/live/test-tenant/phase0a-report.md` |
| 0b | ✅ `research/live/FINDINGS.md` |
| 0c | — Dropped (no data comes back from the machine) |
| 1: CC/R skeleton, ledger, spend cap | 🔶 All three acceptance checks passed live on 2026-09-27 (FINDINGS "Extension live checks"). The `force_models` intersection and `restrictedConfigurations` are built and unit-tested, but not yet seen live |
| 2: M, caching, pinning, reasoning round-trip, Check Cache Health | 🔶 Built and unit-tested; nothing has run live. Blocked before live acceptance by DEFECTS D1–D3. Acceptance also waits on T12's Claude and nano-on-Responses legs (PLAN §9). Gaps: DEFECTS §B |
| 3: budget guards | 🔶 Partly built, never run live. The pre-flight check uses the session and hourly caps only, not the balance, and warnings go only to the log (D6). The forecast, cache-health alarm and cap bump are built; the budget-mode experiment is not |
| Health report (PLAN §14) | ⛔ H1 (the report) and H2 (the self-test) are not started. H1 is required before the next build goes to the machine |
| 4: G, flavor settings panel, multi-flavor picker, rate-override editor, workspace policy | ⛔ |
| 5: search tools | ⛔ Gated on PLAN §8's usage check |
| 6: reports, CSV, packaging, README | ⛔ |

## 6. Decisions (`PLAN.md` §12)

| Decision | Status |
|---|---|
| Data-handling policy; the default `asksage.workspacePolicy` | ⛔ Open |
| Whether the extension is for one user or shared | ⛔ Open |
| VS Code version and policy on the machine | — Not measurable; the PLAN §14 health report shows what it finds |
| Whether a BYOK policy or MDM setting binds a signed-out machine | 🔶 It did not on the dev machine (E1) |
| The day-to-day tenant; Phase 0c | ✅ Closed 2026-09-25: the test tenant is the reference, and 0c is dropped |
| Which rate set Ask Sage bills | ✅ Closed 2026-09-25: the tokenizer's conversion, calibrated at runtime |
| The web-app rate refresher | ✅ Closed 2026-09-25: dropped |
| Ask Sage's terms for third-party clients | ✅ Closed 2026-09-29: not pursued, because this is not a commercial product (owner's decision) |
