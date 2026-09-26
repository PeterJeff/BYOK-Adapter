# Ask Sage Model Provider for VS Code: research-backed plan (v3)

**v3, 2026-09-25.** Revised after a design review of v2. The main changes:
- Phase 0 now starts with an environment smoke test in VS Code, before any API probing.
- Tenant is a first-class dimension: capabilities, rates and fixtures are recorded per tenant.
- A per-flavor usage normalizer sits between the raw API responses and the cost formula.
- A bounded conversation-state cache replaces the "per-request state only" principle, so reasoning state can round-trip.
- Settings scoping, restricted-workspace model policy and fixture redaction were added.
- Caching gained mixed TTLs, lookback-window handling, tool-set tracking and a Responses-first option for GPT-5.x.
- Budget mode is now an experiment, not a default recommendation, and a crude spend cap moved into Phase 1.

**Repo note (v3.1, 2026-09-25): implementation constraint.** The target machine has VS Code and nothing else: no npm, no package manager, no build tools. The extension is therefore written in **plain JavaScript** (CommonJS, `// @ts-check` with JSDoc types), has no build step, uses only Node built-ins and the `vscode` API, and is loaded manually (unpacked folder, or a `.vsix` produced by the repo's zero-dependency packer run with VS Code's bundled Node). Where this document says `.ts`, read `.js`. See `CLAUDE.md` for the working rules.

**Revision note (v3.2, 2026-09-25): two premises corrected.**
- **No Copilot sign-in, ever.** The target machine (and the dev machine) will never be signed in to GitHub Copilot. Per VS Code's documentation, since 1.122 extension-provided and BYOK models work in chat, agent mode and MCP with no GitHub account and no Copilot plan (inline completions and anything embeddings-based still need GitHub). This project exists to use that route. Phase 0a therefore tests the **signed-out** state on VS Code 1.122 or later; v3's "under the account's Copilot plan and org policy" was wrong for this user.
- **Rates come from the API at runtime, not from a hand-maintained table** (§3.1). One measured billing point disagrees with the API's multipliers, so §3.1 also requires calibration against measured billing.

**Revision note (v3.3, 2026-09-25): rates, caching and reconciliation measured.** 117 requests on the test tenant (`research/rate-sources-investigation.md`) settled the §3.1 rate question and most of §2.1:
- The billed rates are what `POST /server/tokenizer` with `convert_to_asksage` returns (free, every model). `get-models`' `token_conversion_rate` is not billed (1.3× off on 66 of 105 models, more on the rest). The web app's table matches the bill on 99 of 105 models. Still an API, not a table: the no-hand-maintained-table decision stands (§3.1).
- `POST /user/get-user-logs` gives the exact bill per request, so reconciliation no longer depends on noisy counters (§3.6).
- Cache discounts are per host, not per family, and R is discounted (§2, §2.1). Claude through CC is currently billed 0, an Ask Sage bug the extension must not rely on.

This document is the input for a later build mission in Claude Code. Nothing has been tested against the live Ask Sage API with credentials. Items marked **LIVE-TEST** must be confirmed in Phase 0 before code depends on them. Test IDs (T0–T21, E1–E5) are defined in §9.

## 0. Research index (`research/`)

Some research artifacts are kept outside version control. Paths are relative to a local `research/` folder.

| File | What it is |
|---|---|
| `sources/server-api-spec.json`, `sources/user-api-spec.json` | Exact copies of the published OpenAPI specs (76 and 194 paths) |
| `server-api-digest.md`, `user-api-digest.md` | Endpoint-by-endpoint digests with adapter findings and open questions |
| `asksage-ecosystem-research.md` | Docs beyond the specs: token semantics, tenants and hosts, compatible gateways, the Continue.dev reference |
| `vscode-lm-provider-research.md` | VS Code provider API: stable and proposed typings, the sample, policy, packaging without npm, reference providers |
| `caching-and-endpoint-flavors.md` | Capability matrix per flavor × model family, how caching is billed, Copilot's prompt layout and cache-breakpoint code, hypotheses for why BYOK performed badly |
| `token-conversion-and-ui-endpoints.md` | Where the web UI's "Token Conversion" table comes from, the units, and web UI endpoints missing from the specs |
| `model-token-conversion.json` / `.csv` | The conversion table: prompt, completion, thinking, cache and long-context rates, tier, and per-model data-handling flags |
| `datasets-and-semantic-search.md` | Ask Sage datasets as a vector store, the embeddings endpoint, VS Code tool APIs, and ranked design options |
| `ui-bundles/` | Extracted tables and public API responses from the chat web app (raw bundles excluded) |
| `sources/caching/` | Snapshots of the docs, release notes and Copilot source files the caching analysis cites |
| `rate-sources-investigation.md` (committed) | Measured billing on the test tenant: which rates are billed, cache rules per host, TTLs, the prompt log, pre-flight counting |

Most of the `research/` folder is not in this repository yet. Cloud sessions can only see what is committed, so the digests, specs and rate table need to be added (redacted where needed) before a session can follow §13's "read `research/*.md` first". Committed so far: `model-catalog-findings.md` (model naming, per-instance catalogs, CUI mismatches), dated doc and spec snapshots under `sources/asksage-docs/`, and catalog audits under `live/<instance>/catalog/`.

The raw specs win whenever a digest disagrees with them. Pricing claims are now backed by measured bills on the test tenant: `research/rate-sources-investigation.md` (2026-09-25), data in `live/test-tenant/billing/`.

---

## 1. Why this extension exists

VS Code's built-in Custom Endpoint (BYOK) route performs poorly against Ask Sage and shows nothing about budget or cost. The likely causes (`caching-and-endpoint-flavors.md`):

1. **Caching.** Copilot does not send cache hints to third-party endpoints. With Claude configured as chat-completions, Copilot sends a proprietary `copilot_cache_control` field that Ask Sage ignores (confirmed 2026-09-25: no cache write). So every agent tool round re-sends the full context uncached. (Claude through CC is currently billed 0 by an Ask Sage bug, which hides that cost until it is fixed; `research/rate-sources-investigation.md` §4.)
2. **Thinking.** Ask Sage's documented Claude config never switches on extended thinking.
3. **Output caps.** Output limits are low (as little as 5–8k on some models) or left to unknown server defaults.
4. **Stateful Responses API.** The Responses API path chains `previous_response_id` without storing responses.
5. **Silent errors.** Errors come back as HTTP 200 with the error in the body.
6. **No cost view.** There is no rate awareness, so no cost display.

The extension's job:
- **Caching done right.** Explicit cache breakpoints, the right endpoint per model, and cache use that can be checked.
- **Cost awareness.** Per-model rates, a live budget, pre-flight guards, and a per-request usage ledger feeding reports.
- **Endpoint choice per model**, with sensible defaults (§2).
- **Ask Sage-specific handling:** errors, per-tenant model catalogs, and native features such as datasets.

---

## 2. Endpoint flavors: capability matrix and defaults

| Code | Flavor | Endpoint |
|---|---|---|
| **M** | Anthropic Messages | `/server/anthropic/v1/messages` |
| **CC** | OpenAI Chat Completions | `/server/openai/v1/chat/completions` |
| **R** | OpenAI Responses | `/server/openai/v1/responses` |
| **G** | Gemini | `/server/google/v1beta/models/{m}:streamGenerateContent` |
| **N** | Native | `/server/query_stream` |

| | M | CC | R | G | N |
|---|---|---|---|---|---|
| **Cache discount billed by Ask Sage** (measured 2026-09-25) | **yes**: read 0.1×, write 1.25× (5m) / 2× (1h), on Vertex and Bedrock Claude | OpenAI on Azure: **yes**, read 0.1×, write 1.25× where `cache_write_tokens` is reported; Bedrock GPT: **no**; Claude: **billed 0 today (bug)** and uncached without `cache_control` parts | **yes**, same as CC | **no**: the implicit cache hits but is billed in full | **no** |
| Cache trigger | explicit `cache_control`, up to 4 breakpoints, optional 1-hour TTL (T1, T15) | automatic prefix caching, plus `prompt_cache_key`, optional extended retention (T17) | automatic, plus key and retention (T17) | implicit only (region failover makes the cache cold) | none |
| Cache usage reported | `cache_read_input_tokens`, `cache_creation_input_tokens` | `prompt_tokens_details.cached_tokens` (needs `stream_options.include_usage`) | `input_tokens_details.cached_tokens` | `cachedContentTokenCount` | undefined |
| System prompt fully caller-controlled | yes (`system` blocks); injection T5 | yes; T5 | yes (`instructions`); T5 | yes (`systemInstruction`); T5 | **no**: persona, Custom Intro Prompt and default dataset RAG are injected unless overridden |
| Tool calling with results sent back | native `tool_use`/`tool_result` | native | native | native | **no tool-result channel** (lossy) |
| Reasoning state across tool rounds | signed thinking blocks, **required** when thinking is on (§5) | **lost** between rounds | encrypted reasoning items (`store:false` + `include`), T7 | thought signatures, **required** on function calls for Gemini 3 (§5, T18) | n/a |
| Pre-flight token count (free) | `count_tokens`: exact on Vertex; +28% on Bedrock, so count with the Vertex twin | `/server/tokenizer` (one generic tokenizer, within ~3% for GPT) | same | same (within ~3% for Gemini) | `/server/tokenizer` |
| Ask Sage extras (datasets, personas, live search, plugins) | – | – | – | – | **yes** |

### 2.1 Cache pricing
Cache prices are **multiples of the same model's prompt price**, so they do not depend on the absolute rate scale (§3.1). Measured on the test tenant, 2026-09-25 (`research/rate-sources-investigation.md` §3); provisional for other tenants until Phase 0c.
- **Rule per host, from the response's own usage fields** (constants in code, not a per-model table):
  - Claude through M (Vertex `google-claude-*`, Bedrock `aws-bedrock-claude-*`): read **0.1×**, 5-minute write **1.25×**, 1-hour write **2×**. Measured on Haiku 4.5, Sonnet 4.5 and Sonnet 4.6. The web app's table gives lower read multipliers for Fable 5.1 (0.025×) and Opus 5.5 (0.05×), not yet measured.
  - OpenAI on Azure through CC or R: read **0.1×** on every GPT tested, including GPT-4.1-nano and GPT-5.4-nano, which the web app's table lists with no cache rate; write **1.25×** only where the response reports `cache_write_tokens` (GPT-5.6/6), with no write charge otherwise.
  - No discount: Gemini through G (the implicit cache hits, `cachedContentTokenCount` is reported, the bill is full), Bedrock-hosted GPT-5.6, N.
  - Claude through CC: every request logged and billed 0 (an Ask Sage billing bug, §3.1). Never route Claude through CC.
- **Minimum length.** OpenAI caches from 1,024 tokens; Haiku 4.5 needs 4,096 (T1 prefixes are sized for that).
- **TTL.** Claude's 5-minute entry expired after 8 minutes idle; `ttl: "1h"` works with no beta header and held after 28 minutes idle. OpenAI entries survived 6 minutes but not 20, and `prompt_cache_retention: "24h"` is accepted but did not extend that. Nothing else (no conversation id, no beta header) is needed to keep a line alive: the same prefix within the TTL.
- **Checks at runtime:** the prompt log's exact per-request bill (§3.6) and the Check Cache Health command (§4.3) flag a wrong constant; they do not silently replace it.
- **Measured scale:** a 6-round Claude tool loop billed 4,061 uncached and 1,497 with the §4.1 breakpoints; from round 2 a cached round cost a quarter to a fifth of an uncached one, and the gap widens with every round.

The model picker must show cache capability, because it changes which models are sensible for agent mode.

For scale: a 100k-token context over 20 agent rounds on Opus 4.8 costs about **715k Ask Sage tokens uncached versus about 130k cached**, roughly a 5.5× difference (computed from the web app's rate table and Claude's cache multipliers, which are now measured, §2.1; the ratio holds whatever the absolute scale).

### 2.2 Default flavor per model family
Overridable per model in settings.

| Family | Default | Fallback |
|---|---|---|
| Claude (all hosts) | **M**, always | none: CC gives no reliable Claude caching |
| GPT-5.4 / 5.5 / 5.6 / 6 | **R** (`store:false`, encrypted reasoning, full history): R is cache-discounted (measured), and hit the cache more reliably than CC for GPT-5.6 Luna | CC. Note that CC drops reasoning between tool rounds, which hurts agentic quality. |
| GPT-4.1, 5, 5.1, 5.2, o-series | R for reasoning models, CC for 4.1 | cache reads are discounted on both (measured on 4.1-nano and 5.4-nano) |
| Bedrock-hosted GPT (`aws-bedrock-gpt-*`) | CC | no caching at all (measured): prefer the Azure-hosted model for agent work |
| Gemini | CC (Ask Sage's own choice), only if T18 shows thought signatures survive the CC shim | G. No cache discount on either path (measured on G), so it is expensive for long agent loops |
| Everything else (partner-hosted, Grok, DeepSeek, Mistral, Llama) | CC | – |
| Datasets, personas or live search wanted | **N**, as a separate opt-in "Ask Sage (datasets)" model variant in Ask mode only | – |

The picker can list the same model under several flavors (e.g. "GPT-5.5 (Responses)"), controlled by a setting, for side-by-side comparison of behavior and cost.

### 2.3 Tenant is a dimension
Tenants can route the same model name to different upstream hosts and regions. Hosts lag each other on features: caching parameters, the 1-hour TTL, extended retention, newer models and reasoning round-trips. Therefore:
- The catalog, rate table, default-flavor table and Phase 0 fixtures are all keyed by tenant.
- The picker is never built from `get-models` alone. The public catalogs are not filtered per instance: the FedRAMP instance lists `cui_capable: false` models (`research/model-catalog-findings.md`). Intersect with the organization's `force_models`, hide `cui_capable: false` models on government-like instances by default, and treat undocumented suffixes (`-ts`, `-sec`) as unknown data handling. Always send exact `get-models` IDs, never bare public IDs or aliases, which the server resolves per environment. `phase0/probe/catalog-audit.mjs` audits an instance.
- The test tenant is the **development reference**. No measurements come back from other tenants (§9), so anything tenant-specific the extension depends on (rates, cache behavior, feature support) is detected or calibrated at runtime on each tenant and degrades safely when it differs.
- The ledger records tenant on every request.

---

## 3. Cost, budget and usage design

### 3.1 Token conversion rates
- **Source (decision 2026-09-25: no hand-maintained rate table; source corrected by measurement the same day).** `POST /server/tokenizer` with `convert_to_asksage: true` converts a content's token count, plus an optional `completion_estimate`, into Ask Sage tokens at the model's **billed** rates. It is free, covers every model id (including the 10 with no `get-models` rate), and reproduced all 101 non-zero bills measured across 18 models and all five flavors (`research/rate-sources-investigation.md` §2). Per model: prompt rate = difference between a large and a tiny content's converted value ÷ the token difference; completion rate = difference with `completion_estimate: 1000000` ÷ 10⁶ (`phase0/probe/rate-sources.mjs` does this). The extension reads it per tenant, lazily per model, refreshes daily, and keeps the last good copy with a timestamp in global storage.
- **`get-models`' `token_conversion_rate` is not the bill.** The bill is 1.30× it on 66 of 105 models and 0.65× to 3.6× on the rest. It is a fallback only when the tokenizer is unreachable: multiplied by 1.3 and flagged "rate unverified". `get-models` still supplies the catalog, `limits` and `cui_capable`.
- **The web app's table** (hardcoded in `chat.<tenant>/assets/index-*.js`; unit: model tokens per Ask Sage token) matches the bill on 99 of 105 models. It is off on six (`google-claude-sonnet-5` 1.5×; GPT-5.6 Gov and Bedrock GPT-5.6, 1.25× to 2.5×). It is not embedded or scraped.
- **Unit.** Everything is kept as a multiplier: `Ask Sage tokens = model tokens × rate`.
- **Which rows are shown.** Intersect with the deployment's model list and the user's `force_models` (§2.3).
- **Formula** (per request, on *normalized* counts from §3.2, where `p` and `c` are the tokenizer's rates and the cache multipliers come from §2.1's host rule):
  `AS = uncachedIn×p + cacheRead×p×readMult + write5m×p×write5mMult + write1h×p×write1hMult + visibleOutput×c + thinking×c + ~3`
  The measured bill exceeds this by +1.3 to +5.3 per request (median +2.9; integer rounding). Gemini thinking tokens through G were **not** billed; OpenAI reasoning tokens are inside the completion count and billed.
- **Calibration becomes a check.** The ledger's measured/estimated ratio per model and flavor (§3.6), now from the exact prompt-log bill, should sit at 1.0. A drift flags a changed rate, a changed cache rule or server-side injection. It is not a correction factor to be learned over a week.
- **Long context.** Above `longContextThreshold` (272k for GPT-5.4, 5.6 and 6; 200k for some Claude models), the long-context rates apply. For Claude the threshold is tested against **total input including cache reads and writes**, and the premium applies to the **whole request**. Not measured yet (T13); the tokenizer's conversion may or may not reflect it. Price conservatively at the table's long-context ratio until measured. Compacting before the threshold is a cost rule.
- **Unknown or flat-rate models.** The tokenizer's conversion has a large constant for flat-rate models (`aws-bedrock-titan`, `llma3`); image and video models are priced per request; show them as "per request" in the picker.

Also report to Ask Sage support: the CC-Claude zero-billing bug, and ask whether the tokenizer's conversion is the supported way to read billed rates.

### 3.2 Usage normalization (new)
The APIs count tokens differently. A pure `normalize/` module converts every flavor's usage into one shape before the formula runs. Each rule gets unit tests against recorded fixtures.

| Flavor | Input | Cache | Output and thinking |
|---|---|---|---|
| M | `input_tokens` **excludes** cache reads and writes | `cache_read_input_tokens`; `cache_creation_input_tokens` (split by TTL where reported) | `output_tokens` **includes** thinking; no separate thinking count |
| CC | `prompt_tokens` **includes** `cached_tokens`: uncached = prompt − cached | `cached_tokens`; writes not reported | `completion_tokens` **includes** `reasoning_tokens`: visible = completion − reasoning |
| R | `input_tokens` **includes** `cached_tokens` | as CC | `output_tokens` **includes** `reasoning_tokens` |
| G | `promptTokenCount` **includes** `cachedContentTokenCount` | `cachedContentTokenCount` | `candidatesTokenCount` excludes `thoughtsTokenCount` (separate) |
| N | best-effort from response fields or `/tokenizer` | none | best-effort |

**Claude thinking.** Claude reports no separate thinking count. If the rate table gives Claude a thinking rate different from its completion rate, the extension cannot compute it from usage. Default: price all Claude output at the completion rate, record `thinkingUnknown: true`, and let reconciliation (§3.6) measure the error.

### 3.3 Budget signals (verified endpoints)

| Need | Endpoint |
|---|---|
| Monthly **limit** | `POST /user/validate_token_with_full_user` → `max_tokens` (and `max_train_tokens`, org-pool settings, `force_models`, `custom_intro_prompt`). Web app endpoint missing from the spec. **LIVE-TEST** with an API-key JWT (T0). |
| **Remaining** | `POST /server/count-monthly-tokens-left-with-org` (accounts for user and org limits) |
| **Used** | `POST /server/count-monthly-tokens` (optionally with `{app_name}`: **LIVE-TEST** whether the extension's traffic can be tagged) |
| Training tokens used | `/server/count-monthly-teach-tokens` |
| **Reset** | Not returned by any API. The docs say 00:00 UTC on the 1st. The UI shows it converted to local time, and guards treat the last hours before reset specially (don't block on a budget that is about to refill). |
| Request more | `POST /user/request-tokens`, `/user/get-my-token-requests` |

Refresh on activation, after each completed turn (debounced), and periodically while chat is active. Never cache the limit across a month.

### 3.4 Usage ledger (logging from day one)
Every request appends one line to a JSONL file in `globalStorageUri`. **One file per month per extension-host process** (`YYYY-MM.<pid>-<random>.jsonl`), because concurrent appends from several windows are not reliably atomic on Windows. Readers merge the files.

Each record holds:
- `ts`, `conversationId`, turn and round index. `conversationId` comes from `modelOptions._conversationId` (internal, feature-detected); otherwise a hash of first user message + first-request timestamp + tool-set hash, to avoid collisions between chats that open with the same text.
- `tenant`, `model`, `resolvedModel` (the response's `model`), `flavor`
- `requestInitiator` where available (proposed API, best-effort)
- `toolSetHash` and `thinkingConfigHash`, so cold turns can be attributed to tool churn or config changes (§4)
- normalized token counts: `inputUncached`, `cacheRead`, `cacheWrite5m`, `cacheWrite1h`, `visibleOutput`, `thinking`, `thinkingUnknown`, `imageInputs`
- `estAsCost`, `measuredDelta` (§3.6), `rateTableVersion`
- `latencyMs`, `ttftMs`, `status`, `errorClass`, `cancelled`, `partialOutputTokens`, `toolCallCount`, `retried`

No prompt text by default; a debug setting can add hashed prefixes.

Usage is also reported to Copilot through a `LanguageModelDataPart` with MIME type `"usage"` in OpenAI `APIUsage` shape. This is an internal Copilot convention that could change on any release, so it is feature-detected and failure is silent.

### 3.5 Guards and spend controls
- **Session spend cap (Phase 1).** A simple per-conversation and per-hour cap in Ask Sage tokens, with a hard stop. It exists before the full guards so that Phase 2 agent testing cannot run away.
- **Pre-flight estimate** = local token estimate × expected cache split for this conversation × rates. `provideTokenCount` stays local and fast; it never calls a remote tokenizer. Near a guard threshold, the guard may make one free remote count: `count_tokens` for Claude (exact on Vertex; count Bedrock ids with their Vertex twin, since Bedrock's count is +28%), `/server/tokenizer` otherwise (within ~3% for GPT and Gemini; −16% on Opus 5.5's denser tokenizer). The local estimator starts at the web app's conservative 3.7 characters per token and learns a per-model ratio from the true counts in each response.
- **Warn** at a remaining-budget threshold. **Hard stop** when the estimate exceeds remaining minus a reserve. The stop is a `LanguageModelError` offering: request tokens, switch model, or compact.
- **Cache-health alarm.** Warn when the cache-read share stays under 50% for 2 or more consecutive agent rounds on a cache-capable model, when `resolvedModel` differs from the requested model, or when the tool-set hash changed (informational).
- **Budget mode (experimental).** Advertise a smaller `maxInputTokens` (32k, 64k, 128k or the model maximum). Copilot compacts history at about 80% of the window. This is **not assumed to save money**: compaction is itself a model call, and the rewritten history forces a cold cache turn. A small window means frequent compactions. Phase 3 measures it against normal mode before it is recommended.
- **Output caps.** Always send an explicit maximum output size. Never rely on server defaults.
- **Retries.** Never auto-retry after any output has streamed (it double-bills). Retry once only for auth refresh or transport failure before the first token. Detect errors inside SSE streams as well as in HTTP 200 bodies.
- **Cancellation.** Billing of cancelled streams is **LIVE-TEST** (T9). Until known, the ledger estimates cost from input plus streamed output and marks the record.
- **Burn-rate forecast** in the status bar tooltip, e.g. "at this week's rate you run out on the 19th".

### 3.6 Checking the numbers against real billing
**Primary: the prompt log.** `POST /user/get-user-logs` returns one row per request (`model`, `prompt_tokens`, `completion_tokens`, `total_tokens`; paging `{limit ≤ 100, before_id}`), and `total_tokens` is the exact bill: the rows summed to the used-tokens counter to the token over 117 requests (`research/rate-sources-investigation.md` §1). The ledger matches its own requests to rows by model, time and token counts and records `measured = total_tokens`. Rows also contain the **prompt and response text and the client IP**; the extension keeps only the numeric fields and never persists a row. The logged `model` is the billed model, which can differ from the requested one (`claude-haiku-4-5-com` was billed as `google-claude-45-haiku`).

**Fallback: the budget counters**, when the log is unavailable. That measurement is noisy:
- counters may update with a lag (T19), so the delta is read by a delayed poll after the response, not immediately
- org-pool counters include other users
- the same user's web UI activity lands in the same counters
- several windows can have requests in flight

Rules: record `measuredDelta` only when no other request from this machine was in flight during the measurement window; prefer a per-user counter over the org pool; compute a **median** ratio of measured to estimated per model and flavor over a rolling window, discarding outliers. A drifting ratio flags:
- a stale rate table
- a cache that is reported but not discounted
- server-side prompt injection (a larger bill than the tokens sent)
- mispriced thinking (§3.2)

If the counters cannot resolve single requests (T19), reconciliation falls back to **batch mode**: an idle-period test harness that runs N identical requests back-to-back and compares the total delta.

### 3.7 Reports (a later phase)
A webview (or exported CSV plus a markdown summary), all from the ledger:
- spend by day, model, flavor, tenant and initiator
- cache hit rate per model and conversation, with cold turns attributed (tool churn, config change, TTL expiry, failover)
- the most expensive conversations and agent loops
- estimated versus measured spend
- the month-end forecast
- "what if" comparisons: this month's traffic re-priced on other models

---

## 4. Prompt caching implementation

### 4.1 M (Claude)
- **Breakpoints.** Place 4 breakpoints the way Copilot's own `messagesApi.ts` does:
  1. the last tool definition
  2. the last system block
  3. the last cacheable block of the most recent message
  4. the last cacheable block of the second-most-recent message

  Never place a breakpoint on thinking blocks; put it on the `tool_result` block.
- **Mixed TTLs.** Human pauses between user turns often exceed 5 minutes. When T15 confirms support, breakpoints 1–2 (the stable tools+system prefix) use the 1-hour TTL and breakpoints 3–4 use 5 minutes. Longer TTLs must come before shorter ones. Test with and without the `extended-cache-ttl-2025-04-11` beta header, since hosts may differ. A setting chooses 5m-only, mixed, or 1h-only; the ledger's TTL-expiry attribution shows which pays off.
- **Minimum length.** Each model has a minimum cacheable prefix (roughly 1–4k tokens). Breakpoints below it silently don't cache. The placer skips them, and the health check reports them.
- **Lookback window.** A cache lookup only checks about 20 content blocks back from a breakpoint. A round with many parallel tool results can place the new breakpoint more than 20 blocks past the last cached one and miss. When a single message would exceed the window, the placer spends breakpoint 4 on an intermediate block instead. T16 verifies this.
- **Thinking config is pinned per conversation.** Turning thinking on or off, or changing its budget or effort, invalidates the message cache. The provider keeps the first request's thinking config for the life of the conversation unless the user explicitly changes it (logged via `thinkingConfigHash`).

### 4.2 CC and R
- Send `prompt_cache_key = hash(conversationId + model)`.
- Test extended retention (`prompt_cache_retention`, T17) on supporting models; if accepted and billed normally, enable it.
- For R: `store:false`, `include: ["reasoning.encrypted_content"]`, the full history each time, and never `previous_response_id`.
- Unknown parameters may be rejected or silently stripped by the proxy; T17 records which.

### 4.3 All flavors
- **Deterministic prefix.** Sort tools by name, serialize JSON with a stable key order, keep system text byte-stable. Copilot already puts volatile content (date, editor and terminal state) in the current user message, after history.
- **Tool-set churn.** Copilot's virtual-tool grouping and MCP server toggles change the tool list mid-conversation, and any tool change invalidates the whole cache. Expect one cold turn per change; the ledger's `toolSetHash` makes these visible.
- **Host failover.** Upstream region or host failover makes the cache cold even when `resolvedModel` is unchanged. The cache-health alarm is the detector.
- **Verification is part of the product.** A "Check Cache Health" command sends the same long prefix twice, then a control request, plus a many-parallel-tool-results case, and reports cache fields and budget delta against the formula as PASS/FAIL per model and flavor. The same logic is Phase 0 tests T1–T4 and T16.
- **Server-side injection check (T5).** Compare `count_tokens` with the tokens actually billed, run an "echo your instructions" probe, and toggle a marker Custom Intro Prompt. Anything injected at the start of the prompt destroys caching. The user object's `custom_intro_prompt` field lets the extension warn when one is set.

---

## 5. Conversation state (new)

v2's "per-request state only" principle is relaxed, because reasoning models need state carried across tool rounds:
- **Claude (M):** with thinking on, the signed thinking block from the last assistant turn must be sent back with its `tool_use` during a tool loop, or the API errors.
- **Gemini 3 (G, and possibly CC):** thought signatures are required on function calls.
- **OpenAI R:** encrypted reasoning items must be sent back for reasoning to persist.

**First choice:** emit reasoning as a part VS Code preserves in history and read it back from the incoming messages: a thinking part with the signature in its id or metadata (a `LanguageModelDataPart` with a private MIME type turned out not to come back; see E4 below).

**E4 results (2026-09-25, dev machine, VS Code 1.139.1, dev host; `research/live/test-tenant/phase0a-report.md`).** Between turns, a plain reply's thinking part is **not** handed back (0 of 5) and neither is a private-MIME data part (0 of 5): only the text is. **Inside a tool loop the thinking part does come back, with its id and metadata intact** (the reply that carried thinking + text + data part + tool call was seen again on the request carrying the tool result: thinking, id and metadata yes, data part no). One sample, one tool round, a small metadata object, from the development host. That is the case that matters: Claude needs its signed thinking block back only during the tool loop, and Gemini thought signatures and OpenAI encrypted reasoning items are needed in the same place. So the first choice is now viable: carry the signature in the thinking part's metadata (feature-detected `LanguageModelThinkingPart`, which exported at runtime with no proposal check, confirmed on a folder-installed copy), and never rely on a data part. **Multi-round follow-up (2026-09-25, folder install, `research/live/test-tenant/phase0a-e4-loop.md`):** a three-round tool loop with signatures of 1 KB, 8 KB and 64 KB in the thinking metadata. Every round's thinking part came back with its id and metadata, and every signature came back byte-for-byte; the data part again never did. A six-round loop then passed the same way (four 64 KB signatures in one history), covering Phase 2's 5+ round target on the VS Code side.

**Fallback (needed if the thinking part is absent on the target, drops the metadata or size-limits it): a bounded in-memory side cache in `state/`:**
- keyed by tool-call ID (and response item ID for R), which appears in the history VS Code sends back (E2 confirmed the provider's own call id returns on the tool result)
- LRU-bounded by entry count and bytes, entries expire after 2 hours
- memory only, never written to disk, cleared when the extension host exits
- on a miss (e.g. after a window reload): M re-sends the tool loop without thinking for that round and logs `reasoningStateLost`; G falls back per T18 findings; R continues without reasoning items

Everything else stays per-request.

---

## 6. Security and data handling (new)

- **Settings scope.** Tenant, host, custom endpoint and rate-refresh settings are `scope: "application"` (or `"machine"`) and listed in `restrictedConfigurations`. A workspace's `.vscode/settings.json` must never be able to redirect requests, and the bearer token, to another host.
- **Credentials.** The API key lives only in SecretStorage and is never logged. The short-lived access token is refreshed on expiry or on a `Token is invalid` response, with one retry, and only before any output has streamed.
- **Restricted workspaces.** The rate table carries per-model data-handling flags. A per-workspace policy setting (`asksage.workspacePolicy`) names which flags a model must have to be offered in that workspace. The picker hides non-matching models, and the embeddings tool refuses a non-matching embedding model. Unset means no restriction.
- **Derived data.** The local embeddings index (§8) inherits the policy of the workspace it was built from and is stored per workspace. A "Purge index" command deletes it.
- **Fixtures.** Phase 0 recordings are redacted before they are saved: key, access token, user and org identifiers, email addresses, and tenant hostnames (replaced by a tenant alias).
- **Untrusted content.** Results from `#asksageDocs` and dataset queries are returned as tool output, never merged into the system prompt.

---

## 7. Architecture

```
src/
  extension.js
  config/      tenants.js (tenant alias → host, plus custom host), settings.js (scoped per §6)
  auth/        credentials.js (SecretStorage), accessToken.js (JWT for x-access-tokens, refresh), userInfo.js
  catalog/     per-tenant bundled tables + /v1/models + force_models filter + per-model flavor overrides + capabilities (tool limit, image input)
  rates/       live rates from get-models (per tenant, last-good copy in global storage), per-family cache rules, cost formula, per-model calibration factor
  normalize/   per-flavor usage normalization (§3.2)
  transport/   anthropicMessages.js, openaiChat.js, openaiResponses.js, gemini.js, nativeQuery.js, sse.js, sepStream.js
  convert/     messages per flavor, tools (schema sanitizing, deterministic ordering), reasoning round-trip
  state/       bounded reasoning side cache (§5)
  cache/       breakpoint placement (M) incl. TTLs, minimums and lookback, prompt_cache_key, health check
  budget/      budget service, spend cap, guards, forecast
  ledger/      per-process JSONL writer, merge reader, reconciliation, report queries
  policy/      workspace policy (§6)
  tools/       (Phase 5) asksageCodebaseSearch, asksageDatasetSearch via vscode.lm.registerTool
  ui/          status bar, notices, reports webview
  errors.js, log.js
```

Principles:
- plain JavaScript, CommonJS, `// @ts-check` + JSDoc; no build step, no npm, Node built-ins only
- zero runtime dependencies
- stable API, with proposed fields and Copilot internals feature-detected and degrading silently
- per-request state, except the bounded reasoning cache in `state/`
- the key in SecretStorage only
- every response body and every SSE event is checked for `{status, response}` errors. Verified: **every flavor** returns HTTP 200 with `{"response":"Token is invalid [1]","status":400}` on bad auth.
- each model declares `capabilities.toolCalling` as its numeric tool limit where one exists (e.g. 128 for OpenAI models), and `imageInput` where supported; image inputs are priced in the ledger

---

## 8. Semantic search

Copilot's `#codebase` semantic search cannot be pointed at a third-party backend. The relevant APIs are proposed only. What does work is exposing our own tools to agent mode through the stable Language Model Tools API.

**Gate before building.** Agent mode already has text search, file search and usages, and for C++ the language server's workspace symbols are free. Before Phase 5, a week of ledger data records how often the agent searches and how often it searches repeatedly for the same thing. Build `#asksageCodebase` only if that shows a real gap.

- **`#asksageCodebase`.** A local vector index built with `/server/openai/v1/embeddings`, stored on disk per workspace and searched with cosine similarity in plain JS.
  - Rough cost for a 50k-line C++ repo: about 0.6M model tokens to build (times the embedding rate), then about 10–40k a day to re-embed changes. The index is about 12 MB, and a search takes under 10 ms.
  - Only text chunks go to the embeddings endpoint, subject to the workspace policy (§6).
  - Which balance embeddings charge (inference or training) is **LIVE-TEST** (T20).
- **`#asksageDocs`.** Query an existing Ask Sage dataset. No documented endpoint returns search results on their own, so this runs `/query` with `dataset`, a cheap model and a minimal reply, and parses the `references` string (about 2–7k inference tokens per search). Two leads for results-only search, the `/get <text>` chat command and `/get-dataset-results`, are **LIVE-TEST** (T21).
- **Datasets economics.** Training tokens are charged once, at ingestion, from their own monthly balance. Retrieval costs inference tokens, because the retrieved chunks enter the prompt. There is no update operation: a changed file must be deleted and re-uploaded, which charges the full file again. Datasets suit stable docs, not a fast-changing codebase.

---

## 9. Phases

**Where things are verified (revised 2026-09-25).** The dev machine and the public test tenant (`api.asksage.ai`) are the reference environment: every phase is built and accepted there. The target environment is close enough that it is not measured separately. It receives beta builds (alpha at worst), and **no data comes back from it**: feedback is at most a written description of a failure, with environment details left out. Two consequences:
- Each build must be diagnosable on the machine it runs on: clear error messages, feature detection that reports what it found, and a local diagnostics report (like the smoke extension's) that the person there can read and describe in their own words.
- Tenant differences are handled at runtime (§2.3): calibrate what can be calibrated and degrade safely instead of relying on a measured per-tenant table.

### Phase 0a: environment smoke test (dev machine, no API)
A small provider that echoes the prompt (`phase0/smoke-extension/`), side-loaded as an unpacked folder or a `.vsix` (built with `scripts/pack-vsix.mjs`). It costs nothing and is the go/no-go gate. It can also be installed on the target as a first beta: whether it works there is the useful signal, not its numbers.
- **E1:** extension-contributed models appear in the chat model picker **with no GitHub or Copilot sign-in** (the state on the target machine), on VS Code 1.122 or later. Also record whether a Copilot Business/Enterprise "Bring Your Own Language Model Key" policy or MDM setting applies to a signed-out machine (unverified in the research).
- **E2:** agent mode will use an extension-contributed model and pass it tools.
- **E3:** `.vsix` side-loading is permitted (`extensions.allowed` and related policy).
- **E4:** thinking parts and private-MIME `LanguageModelDataPart`s emitted by the provider come back in the history of later requests (§5).
- **E5:** the extension host's `fetch` reaches the tenant host through the local proxy and TLS inspection, if any.

**Exit:** all five pass, or the plan is revised.

### Phase 0b: API probes (test tenant)
A plain `.mjs` probe script with no dependencies (`phase0/probe/`), runnable through VS Code's bundled Node (`ELECTRON_RUN_AS_NODE=1`), using a test key, synthetic prompts only, and cheap models. It records redacted raw responses (§6) to `research/live/<tenant>/`, together with the budget before and after each test (polled with a delay, per T19).

| Test | What it checks |
|---|---|
| T0 | auth and the budget endpoints, including `validate_token_with_full_user` with an API key |
| T1–T4 | caching and billing per flavor (M, CC, R, G) |
| T5 | server-side prompt injection |
| T6 | GPT-5-class models on Chat Completions |
| T7 | reasoning round-trips (signed thinking, encrypted reasoning) |
| T8 | output caps and explicit max-output handling |
| T9 | streaming and cancellation metering |
| T10 | errors (including mid-stream) and model fallback |
| T11 | tool-limit and schema acceptance per model |
| T12 | reproduce a BYOK session as a baseline |
| T13 | long-context threshold behavior with cached input |
| T14 | usage normalization: raw usage fields per flavor captured for §3.2 fixtures |
| T15 | 1-hour and mixed TTLs, with and without the beta header |
| T16 | cache hit when a round adds more than 20 blocks (parallel tool results) |
| T17 | `prompt_cache_key` and `prompt_cache_retention` accepted, stripped or rejected |
| T18 | Gemini thought signatures through G and through the CC shim |
| T19 | budget counter lag and granularity (single-request resolvability) |
| T20 | embeddings endpoint availability and which balance it charges |
| T21 | dataset results-only search leads |

Estimated cost: about 200–350k Ask Sage tokens. **Exit:** `research/live/FINDINGS.md`, with the default flavor table, cache policy and normalization rules confirmed or corrected for the test tenant.

### Phase 0c: target-tenant subset (dropped)
Dropped 2026-09-25: no measurements come back from the target environment. Test-tenant findings are the development reference; per-tenant differences are handled by runtime calibration and safe degradation (§2.3), and checked by beta use on the target.

### Phase 1: skeleton with M and CC, ledger and spend cap
Tenant and key setup with scoped settings; the catalog from bundled tables and rates; M and CC transports with streaming; the error normalizer (bodies and SSE events); the usage normalizer; the ledger and the `usage` DataPart; the session spend cap; a status bar showing remaining budget and the last request's cost.

**Accept:** Claude through M and GPT-5.x through CC stream in Ask mode; every request lands in the ledger with a normalized, estimated cost; the spend cap stops a synthetic runaway loop.

### Phase 2: tools, agent mode, caching and reasoning state
Tool conversion; cache breakpoints (M) with TTL, minimum and lookback handling; `prompt_cache_key` (CC); thinking pinning; reasoning round-trip with the `state/` fallback; the Check Cache Health command.

**Accept:**
- a multi-step agent task shows cache reads of 80% or more from round 2 on at least one Claude and one GPT-5.x model
- Claude with thinking on completes a 5+ round tool loop without errors
- estimate accuracy: measured delta within ±10% of the estimate per request if T19 shows single requests are resolvable; otherwise within ±10% in batch mode (§3.6)

### Phase 3: budget guards
Pre-flight estimate, warnings and hard stop, the budget-mode experiment (measured against normal mode before it is recommended), burn-rate forecast, request-tokens command, cache-health and fallback alarms, and the reconciliation display.

### Phase 4: remaining flavors and overrides
R (`store:false`, encrypted reasoning; promoted to GPT-5.x default if T3 passes), G, multi-flavor picker entries and workspace policy.

### Phase 5: search tools
Subject to the §8 gate: `#asksageCodebase` (local embeddings index, purge command) and `#asksageDocs` (dataset query); N as an opt-in "Ask Sage (datasets)" model variant.

### Phase 6: reports and packaging
The reports webview and CSV export; the `.vsix`; a README covering cache-capable models, utility-model cost, budget mode findings and workspace policy.

---

## 10. Testing and build
- `node:test` unit tests (no npm) against the recorded Phase 0 fixtures, run with `scripts/run-tests.mjs` so they work under VS Code's bundled Node (`ELECTRON_RUN_AS_NODE=1`) as well as a plain `node`.
- Pure logic kept free of `vscode` imports: converters, usage normalizer, parsers, cost formula, breakpoint placement, reasoning cache, reconciliation.
- No build: plain `// @ts-check` JavaScript (CommonJS) loaded directly by VS Code. The `.vsix` is produced by `scripts/pack-vsix.mjs`, a zero-dependency packer run with VS Code's bundled Node; loading the unpacked folder also works.
- No code copied from `asksageclient`, which is proprietary.
- Ask Sage ships almost daily, so rates, flavors and fixtures are re-checked before each release. Copilot internals (`_conversationId`, the `usage` DataPart, virtual tools) are re-checked against each VS Code release.

---

## 11. Revision notes

| Area | v2 | v3 |
|---|---|---|
| Phase 0 | API probes only | Environment smoke test first (E1–E5), run **signed out of Copilot** on VS Code ≥1.122 (v3.2); target-tenant subset (0c) |
| Rates | bundled table (v2), then bundled snapshot + override + refresher (v3) | live from `get-models` with calibration (v3.2), then live from the tokenizer's billed conversion, per-host cache rules, prompt-log reconciliation (v3.3) |
| Tenant | implicit | first-class dimension for catalog, rates, defaults, fixtures and ledger |
| Cost formula | raw counts | per-flavor normalization; Claude thinking handling; whole-request long-context rule |
| State | per-request only | bounded reasoning side cache with a history-parts first choice |
| GPT-5.x default | CC | R if cache-discounted, else CC |
| Caching | 4 breakpoints, 5m TTL | mixed TTLs, minimum length, 20-block lookback, thinking pinning, tool-set tracking, extended retention |
| Budget mode | recommended | experiment, measured first |
| Guards | Phase 3 | crude spend cap in Phase 1; retry and cancellation rules |
| Reconciliation | single-request delta | delayed poll, in-flight exclusion, median ratio, batch fallback |
| Ledger | one file per month | per-process files; tool-set and thinking-config hashes; collision-resistant conversation ID |
| Security | key in SecretStorage | scoped settings, token refresh, workspace policy, derived-data purge, fixture redaction |
| Semantic search | build in Phase 5 | gated on measured need |

---

## 12. Open decisions
- Data-handling policy for code sent to the API, and the default `asksage.workspacePolicy`.
- ~~Which tenant is the day-to-day target, and whether Phase 0c is needed~~: the test tenant is the development reference; Phase 0c is dropped because no data comes back from the target (§9).
- VS Code version and policy on the target machine: not measured; found out by beta use there. The extension must work on the oldest VS Code it declares and say clearly when something it needs is missing.
- Ask Sage's terms for third-party clients.
- Whether the extension is for one user or shared.
- ~~Which rate set Ask Sage bills~~: settled by measurement on the test tenant (§3.1): the tokenizer's conversion; neither `get-models` nor, on six models, the web app's table. Calibrate per tenant at runtime (§2.3) and ask Ask Sage support whether the tokenizer's conversion is the supported source. (The web-app rate refresher question is closed: dropped.)
- Whether a Copilot Business/Enterprise "Bring Your Own Language Model Key" policy or MDM setting binds a machine that is not signed in: not binding on the dev machine (E1); elsewhere found out by beta use.

---

## 13. Mission brief for the future Claude Code build

> Build the Ask Sage VS Code language-model provider in `PLAN.md` phase by phase, starting with the Phase 0a smoke-test provider, then the Phase 0b probe script.
>
> Read `research/*.md` first, especially `caching-and-endpoint-flavors.md` and `token-conversion-and-ui-endpoints.md`. The specs in `research/sources/` are the starting data. Rates come from the API at runtime, not from a table (§3.1); `model-token-conversion.json` is a 2026-09-22 snapshot of the web app's table, useful only as a cross-check.
>
> Constraints:
> - plain JavaScript (CommonJS, `// @ts-check` + JSDoc), no build step, no npm; only Node built-ins and the `vscode` API
> - zero runtime dependencies
> - stable VS Code API only (proposed fields and Copilot internals feature-detected)
> - the key only in SecretStorage, never logged; endpoint settings application- or machine-scoped
> - no prompt text in the ledger by default
> - fixtures redacted per §6 before they are written
> - no code copied from `asksageclient`
> - every **LIVE-TEST** assumption verified with recorded fixtures, per tenant, before code depends on it
> - `node:test` unit tests, with the usage normalizer and cost formula fully covered
>
> Caching, cost accuracy and reasoning-state correctness are acceptance criteria, not polish. Stop at the end of each phase and report against its acceptance criteria.
