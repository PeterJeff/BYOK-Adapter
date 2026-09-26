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
| Standalone scripts are `.mjs`, run under VS Code's bundled Node (`ELECTRON_RUN_AS_NODE=1`), Node 22+, Windows-path safe | ✅ | 2026-09-25, Windows 11, VS Code 1.139.0 (bundled Node 24.20.0, Electron 43.6.0): `scripts/run-tests.mjs` (64/64 pass), `scripts/pack-vsix.mjs` (8-entry `.vsix` for the smoke extension, `--list` OK) and `phase0/probe/api-probe.mjs --dry-run` all ran through `Code.exe` with `ELECTRON_RUN_AS_NODE=1`. Live (network) probe runs under that Node are not yet done. Note: VS Code's Node is 24, not the "Node 22" the docs assumed; the contract is "22 or newer" |
| No dependence on a Copilot / GitHub sign-in (target machine is never signed in) | 🔶 | Stated in `CLAUDE.md` and `PLAN.md` v3.2. Observed on the dev machine (VS Code 1.139.1, throwaway profile, signed out): the smoke provider's models were selectable in chat and Agent mode ran a tool round trip (`research/live/test-tenant/phase0a-report.md`). Caveat: on 1.139.0 in the same profile the chat asked for a sign-in and no model was selectable; it worked after updating to 1.139.1, cause unestablished. Not yet shown on the target machine |
| Manual loading only (`.vsix`, unpacked folder, `--extensionDevelopmentPath`) | ✅ | `scripts/pack-vsix.mjs` builds a zero-dependency `.vsix`; `phase0/smoke-extension/README.md` documents all three load paths |
| Stable VS Code API only; proposed APIs / Copilot internals feature-detected and degrade silently | 🔶 | `phase0/smoke-extension` targets only the stable `LanguageModelChatProvider` API; E4 (see §3): thinking parts exist for an installed extension and round-trip in a tool loop; the `usage` data part never appeared in history |

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
| §2.1 (cache pricing table) | CC (OpenAI-flavor) cache discount is billed by Ask Sage | T3 | ✅ confirmed (test tenant, 2026-09-25, ad-hoc runs outside `api-probe.mjs`): OpenAI on Azure via CC **and R**, read 0.1× on GPT-4.1-nano, 5.4-nano, 5.6-luna(-gov), 6-luna. Not on Bedrock-hosted GPT-5.6. `research/live/test-tenant/billing/2026-09-25/measurements.json`; `research/rate-sources-investigation.md` §3 |
| §2.1 | Models with no listed cache rate (GPT-4.1, GPT-5/5.1/5.2, o-series, Gemini, several partner-hosted) are billed full price on every re-sent token | T1–T4 | ✅ **corrected**: false for Azure GPT (GPT-4.1-nano and 5.4-nano reads billed 0.1×); true for Gemini via G (implicit cache hits, billed in full) and Bedrock GPT-5.6 (no caching). `research/live/test-tenant/billing/2026-09-25/measurements.json` |
| §2.1 | Whether GPT rows carry a cache **write** rate, and how it's applied when OpenAI reports no writes | T3 | ✅ 1.25× on tokens reported as `cache_write_tokens` (GPT-5.6/6 on CC and R: a 34k write billed 615 against 490 uncached); no write charge where none is reported (4.1, 5.4). `research/live/test-tenant/billing/2026-09-25/measurements.json` |
| §3.3 | Monthly limit comes from `POST /user/validate_token_with_full_user` → `max_tokens` (plus `max_train_tokens`, org-pool settings, `force_models`, `custom_intro_prompt`) via API-key JWT | T0 | ✅ confirmed — `research/live/test-tenant/probe/2026-09-25-1534-b69656/T0/008-validate-token-with-full-user.json`: `max_tokens: 200000` |
| §3.3 | `POST /server/count-monthly-tokens` traffic can be tagged with `{app_name}` | T0 | ✅ confirmed **negative** — tagged and untagged calls returned the identical count (411); `app_name` doesn't filter/attribute usage. See `research/live/test-tenant/README.md` |
| §3.1 | `get-models` `token_conversion_rate` is the multiplier Ask Sage bills (`AS = model tokens × rate`) | T1–T4, T19 on several models across families | ✅ confirmed **negative** (2026-09-25): the bill is 1.30× it on 66 of 105 models and 0.65–3.6× on the rest. **Billed rates = `/server/tokenizer` `convert_to_asksage`** (free, every model): 101 non-zero bills over 18 models and all five flavors fit within +1.3..+5.3 tokens. The web app's table matches on 99 of 105. `research/live/test-tenant/billing/2026-09-25/measurements.json`; `research/live/chat.asksage.ai/rates/2026-09-25/summary.md`. PLAN §3.1 rewritten |
| §2.1 | Cache multipliers (Claude: read 0.1×, 5-min write 1.25×, 1-hour write 2× of the model's own prompt price) are what Ask Sage bills | T1, T15 (ratio to the same model's prompt price, so the §3.1 scale question cancels) | ✅ confirmed on Vertex and Bedrock Claude (Haiku 4.5, Sonnet 4.5, 4.6): a 34.7k write billed 3,105 (1.2505×), its read 253 (0.10×); 1h write 2×, no beta header needed. Fable 5.1 / Opus 5.5 lower read multipliers (table: 0.025× / 0.05×) not measured. `research/live/test-tenant/billing/2026-09-25/measurements.json` |
| §3.6 (new) | `POST /user/get-user-logs` `total_tokens` is the exact per-request bill | measurement | ✅ 117 rows summed exactly to the used-counter delta (810 → 36,823). Rows include prompt/response text and IP: keep numbers only. Paging `{limit ≤ 100, before_id}` |
| §2.1 (new) | Cache TTLs: Claude 5m / 1h; OpenAI retention | T15 | 🔶 Claude 5m expired after 8 min idle; 1h held after 28 min (≥60 min not measured); OpenAI hits at 6 min, misses at 20 min; `prompt_cache_retention: "24h"` accepted but no effect. `research/live/test-tenant/billing/2026-09-25/measurements.json` |
| §2 (new) | Claude through CC is billed | measurement | ❌ **billed 0** on 9 requests of every shape (Ask Sage bug): report to support; never route Claude through CC |
| §3.5 | Billing behavior of a cancelled stream | T9 | ⛔ not run |
| §5 | The stable VS Code API hands thinking parts / private-MIME `LanguageModelDataPart`s back to a third-party provider in later requests | E4 | 🔶 **thinking part round-trips inside a tool loop; data part never; thinking dropped between turns.** Dev machine, VS Code 1.139.1, development host: plain replies thinking 0/5, data 0/5; tool-loop reply (thinking + text + data part + tool call) came back with thinking, id and metadata intact, no data part. Then a 3-round loop from a folder install (`smoke:loop`, `research/live/test-tenant/phase0a-e4-loop.md`): all 3 thinking parts back with id and metadata, signatures of 1, 8 and 64 KB returned unchanged, data part never. Not yet: 5+ rounds, the target machine. Design effect: PLAN §5, signature rides in the thinking part's metadata, side cache is the fallback |
| §8 | Which balance (inference or training) embeddings charge | T20 | ⛔ not run |
| §8 | `/get <text>` or `/get-dataset-results` give results-only dataset search | T21 | ⛔ not run (opt-in; needs `--dataset`) |

## 4. Phase 0 tests

### 0a — environment smoke test (E1–E5)

| Test | Question | Status |
|---|---|---|
| E1 | Extension-contributed models appear in the chat model picker **signed out** (no GitHub/Copilot; VS Code ≥1.122). Also: does any org policy/MDM bind a signed-out machine | ✅ on the dev machine, 2026-09-25 (VS Code 1.139.1, signed out); ⛔ target machine. Caveat: on 1.139.0 the chat asked for a sign-in and no model was selectable; fixed by updating, cause unestablished. Docs corrected: they previously assumed a signed-in Copilot plan |
| E2 | Agent mode uses the model and passes it tools | ✅ on the dev machine (51–52 tools; a provider-emitted tool call ran and its result came back); ⛔ target machine |
| E3 | Side-loading is permitted (a local install: folder via "Developer: Install Extension from Location...", or a `.vsix`) | 🔶 **dev machine: PASS** (folder install, 2026-09-25, `research/live/test-tenant/phase0a-e4-loop.md`), but its `extensions.allowed` is `*`, so it does not show the target's policy. The earlier dev-host PASS did not count (it skips install policy). Target machine still to run |
| E4 | Thinking parts / private-MIME data parts round-trip through history | 🔶 tool loop: thinking yes (id, metadata intact; 3 rounds, up to 64 KB), data part no; between turns neither (see §3) |
| E5 | Extension host `fetch` reaches the tenant host through local proxy/TLS inspection | ✅ on the dev machine (no proxy, HTTP 200 via `fetch` and `https`); ⛔ target machine, the one that matters |

**Exit (`research/live/<tenant-alias>/phase0a-report.md`): `research/live/test-tenant/phase0a-report.md` covers the dev machine only; the target-machine run is not done.**

### 0b — API probes (T0–T21)

| Status | Detail |
|---|---|
| 🔶 T0, T19 confirmed for real; T1–T9, T11, T15–T18, T20 still ⛔ as `api-probe.mjs` runs. The billing and caching questions behind T1–T4, T15 and T17 were answered on 2026-09-25 by ad-hoc measurement (117 requests, `research/rate-sources-investigation.md`); reasoning round-trips (T7), caps (T8), cancellation (T9), tools (T11), Gemini signatures (T18) and embeddings (T20) were not covered | `phase0/probe/api-probe.mjs` implements T0–T21. This session's `api.asksage.ai` proxy credential now genuinely authenticates (it didn't at first — see `research/live/sandbox-proxy/README.md` for the earlier dead end) once two fixes landed: the proxy was reconfigured to inject via `x-access-tokens`, and `api-probe.mjs` must be run with `NODE_USE_ENV_PROXY=1` (Node's `fetch` ignores `HTTPS_PROXY` otherwise on Node ≥22.21). A real T0+T19 run against the actual test tenant (`research/live/test-tenant/`) confirmed two §3.3 LIVE-TEST rows in §3 above. One caveat found along the way: this proxy substitutes a real credential into *any* auth-header value, including T0's deliberately-bad one, so T0's "bad auth returns an error envelope" check can't produce a meaningful result from this environment — see `research/live/test-tenant/README.md`. |

**Running the full paid battery (T1–T9, T11, T15–T18, T20, ~13k Ask Sage tokens) from this session was blocked by Claude Code's own safety classifier** ("Real-World Transactions") when attempted as one large `--yes` batch, including in the background. This is independent of credentials or budget — small, individually-approved runs (T0, T19) went through fine. Per the classifier's own guidance, this isn't something to route around (including by chunking it into smaller pieces run back-to-back without the human present); it needs either a human running it directly with visibility into each step, or the user adjusting their Bash permission settings to allow it. Whoever finishes this should also re-run `T0`'s bad-auth check from a path that isn't behind this session's proxy, since it can't produce a real result here.

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
| 0a | E1–E5 all pass, or the plan is revised | 🔶 dev machine: E1, E2, E3 (folder install), E5 pass; E4 passes in a tool loop (thinking metadata, 3 rounds, up to 64 KB; plan §5: signature in thinking metadata, side cache as fallback), data parts never come back. Still to run: 5+ rounds and the target machine |
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
| Whether the optional web-app rate refresher is acceptable | ✅ closed 2026-09-25: dropped. Rates come from the API at runtime, with calibration (PLAN §3.1) |
| Which rate set Ask Sage bills (API multipliers vs the web app's table) | ✅ resolved on the test tenant 2026-09-25: the tokenizer's conversion (= the table on 99 of 105 models); not `get-models`. Re-check per tenant in Phase 0c; ask support whether it is the supported source |
| Does a Copilot Business/Enterprise BYOK policy or MDM bind a machine that is not signed in | ⛔ unresolved (answered by E1) |
