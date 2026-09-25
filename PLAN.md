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

The `research/` folder is not in this repository yet. Cloud sessions can only see what is committed, so the digests, specs and rate table need to be added (redacted where needed) before a session can follow §13's "read `research/*.md` first".

The raw specs win whenever a digest disagrees with them. Claims about pricing come from the web app's code, not from billing records, until Phase 0 reconciles them (§3.6).

---

## 1. Why this extension exists

VS Code's built-in Custom Endpoint (BYOK) route performs poorly against Ask Sage and shows nothing about budget or cost. The likely causes (`caching-and-endpoint-flavors.md`):

1. **Caching.** Copilot does not send cache hints to third-party endpoints. With Claude configured as chat-completions, Copilot sends a proprietary `copilot_cache_control` field that Ask Sage ignores, so every agent tool round re-bills the full context.
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
| **Cache discount billed by Ask Sage** | **yes** [V: web app's own caption] | **yes** [V] | not on the list, **LIVE-TEST** (T3) | not on the list; no Gemini cache rates exist | **no** [V] |
| Cache trigger | explicit `cache_control`, up to 4 breakpoints, optional 1-hour TTL (T1, T15) | automatic prefix caching, plus `prompt_cache_key`, optional extended retention (T17) | automatic, plus key and retention (T17) | implicit only (region failover makes the cache cold) | none |
| Cache usage reported | `cache_read_input_tokens`, `cache_creation_input_tokens` | `prompt_tokens_details.cached_tokens` (needs `stream_options.include_usage`) | `input_tokens_details.cached_tokens` | `cachedContentTokenCount` | undefined |
| System prompt fully caller-controlled | yes (`system` blocks); injection T5 | yes; T5 | yes (`instructions`); T5 | yes (`systemInstruction`); T5 | **no**: persona, Custom Intro Prompt and default dataset RAG are injected unless overridden |
| Tool calling with results sent back | native `tool_use`/`tool_result` | native | native | native | **no tool-result channel** (lossy) |
| Reasoning state across tool rounds | signed thinking blocks, **required** when thinking is on (§5) | **lost** between rounds | encrypted reasoning items (`store:false` + `include`), T7 | thought signatures, **required** on function calls for Gemini 3 (§5, T18) | n/a |
| Pre-flight token count | `count_tokens` | – | – | – | `/tokenizer` |
| Ask Sage extras (datasets, personas, live search, plugins) | – | – | – | – | **yes** |

### 2.1 Cache pricing
Rates are "model tokens per 1 Ask Sage token", so bigger is cheaper.
- A cache read costs **0.1×** the prompt price, a 5-minute write **1.25×**, a 1-hour write **2×**. This applies to all Claude models and to GPT-5.4, 5.5, 5.6 and 6.
- A few model variants carry non-standard read multipliers (0.025× and 0.25× appear in the table). The table is authoritative, not these defaults.
- **Models with no cache rate:** GPT-4.1, GPT-5, 5.1 and 5.2, the o-series, all Gemini, and several partner-hosted models. Assume full price on every re-sent token (**LIVE-TEST**).
- Whether the GPT rows carry a **write** rate, and how it is applied when OpenAI reports no writes, is **LIVE-TEST** (T3). If writes are billed but unreported, GPT estimates run low.

The model picker must show cache capability, because it changes which models are sensible for agent mode.

For scale: a 100k-token context over 20 agent rounds on Opus 4.8 costs about **715k Ask Sage tokens uncached versus about 130k cached**, roughly a 5.5× difference (inferred from the rate table).

### 2.2 Default flavor per model family
Overridable per model in settings.

| Family | Default | Fallback |
|---|---|---|
| Claude (all hosts) | **M**, always | none: CC gives no reliable Claude caching |
| GPT-5.4 / 5.5 / 5.6 / 6 | **R** (`store:false`, encrypted reasoning, full history) **if T3 shows R is cache-discounted**; otherwise **CC** | CC. Note that CC drops reasoning between tool rounds, which hurts agentic quality. |
| GPT-4.1, 5, 5.1, 5.2, o-series | R for reasoning models, CC for 4.1 | no cache discount either way, so choose by output quality |
| Gemini | CC (Ask Sage's own choice), only if T18 shows thought signatures survive the CC shim | G |
| Everything else (partner-hosted, Grok, DeepSeek, Mistral, Llama) | CC | – |
| Datasets, personas or live search wanted | **N**, as a separate opt-in "Ask Sage (datasets)" model variant in Ask mode only | – |

The picker can list the same model under several flavors (e.g. "GPT-5.5 (Responses)"), controlled by a setting, for side-by-side comparison of behavior and cost.

### 2.3 Tenant is a dimension
Tenants can route the same model name to different upstream hosts and regions. Hosts lag each other on features: caching parameters, the 1-hour TTL, extended retention, newer models and reasoning round-trips. Therefore:
- The catalog, rate table, default-flavor table and Phase 0 fixtures are all keyed by tenant.
- Findings from the test tenant are **provisional** for any other tenant until the Phase 0c subset is re-run there (§9).
- The ledger records tenant on every request.

---

## 3. Cost, budget and usage design

### 3.1 Token conversion rates
- **Where they come from.** They are hardcoded in the chat web app's JavaScript (`chat.<tenant>/assets/index-*.js`). No API endpoint serves them. `get-models` and `/v1/models` return only IDs.
- **Which rows are shown.** The web app filters them in the browser by the deployment's default model list plus the user's `force_models`.
- **Formula** (per request, with every rate in model tokens per Ask Sage token, applied to *normalized* counts from §3.2):
  `AS = uncachedIn/prompt + cacheRead/cacheRead + write5m/cacheWrite5Min + write1h/cacheWrite1Hr + visibleOutput/completion + thinking/thinking`
- **Long context.** Above `longContextThreshold` (272k for GPT-5.4 and 5.6, 200k for some Claude models), the long-context rates apply. For Claude, the threshold is tested against **total input including cache reads and writes**, and the premium applies to the **whole request**. No long-context cache rate exists, so the formula prices cached tokens in a long-context request at the long-context prompt rate (pessimistic) until reconciliation says otherwise. Compacting before the threshold is a cost rule.
- **Ignore the second table.** An older, stale second rate table exists in the web app's code.

**How the extension gets the rates, in priority order:**
1. **A bundled snapshot** per tenant: `rates/<tenant>/<date>.json`, generated from `model-token-conversion.json`, recording the source bundle hash.
2. **A user override file.** `asksage-rates.json` in the extension's global storage, editable through a command. The override wins per model.
3. **Optional: a "Refresh rates from the web app" command.** It downloads the tenant's public web app script and re-extracts the table, then shows a diff for approval before anything is applied. Fragile by nature (scraping); on parser failure it reports and keeps the current table. Off by default.
4. **Unknown model.** Use a pessimistic default (the Flagship-tier average) and flag the model as "unpriced" in the picker.

Also ask Ask Sage support for an official rates endpoint.

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
- **Pre-flight estimate** = local token estimate × expected cache split for this conversation × rates. `provideTokenCount` stays local and fast; it never calls a remote tokenizer.
- **Warn** at a remaining-budget threshold. **Hard stop** when the estimate exceeds remaining minus a reserve. The stop is a `LanguageModelError` offering: request tokens, switch model, or compact.
- **Cache-health alarm.** Warn when the cache-read share stays under 50% for 2 or more consecutive agent rounds on a cache-capable model, when `resolvedModel` differs from the requested model, or when the tool-set hash changed (informational).
- **Budget mode (experimental).** Advertise a smaller `maxInputTokens` (32k, 64k, 128k or the model maximum). Copilot compacts history at about 80% of the window. This is **not assumed to save money**: compaction is itself a model call, and the rewritten history forces a cold cache turn. A small window means frequent compactions. Phase 3 measures it against normal mode before it is recommended.
- **Output caps.** Always send an explicit maximum output size. Never rely on server defaults.
- **Retries.** Never auto-retry after any output has streamed (it double-bills). Retry once only for auth refresh or transport failure before the first token. Detect errors inside SSE streams as well as in HTTP 200 bodies.
- **Cancellation.** Billing of cancelled streams is **LIVE-TEST** (T9). Until known, the ledger estimates cost from input plus streamed output and marks the record.
- **Burn-rate forecast** in the status bar tooltip, e.g. "at this week's rate you run out on the 19th".

### 3.6 Checking the numbers against real billing
Every request records the estimated cost and, when possible, the measured budget change. The measurement is noisy:
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

**First choice:** emit reasoning as parts VS Code preserves in history (a thinking part or a `LanguageModelDataPart` with a private MIME type) and read it back from the incoming messages. Whether the stable API hands these back to a third-party provider is **LIVE-TEST** (E4).

**Fallback:** a bounded in-memory side cache in `state/`:
- keyed by tool-call ID (and response item ID for R), which appears in the history VS Code sends back
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
  rates/       per-tenant bundled snapshots, override file, optional web-app refresher, cost formula
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

### Phase 0a: environment smoke test (target machine, no API)
A small provider that echoes the prompt (`phase0/smoke-extension/`), side-loaded as a `.vsix` (built with `scripts/pack-vsix.mjs`) or as an unpacked folder on the machine where the extension will actually be used. It costs nothing and is the go/no-go gate.
- **E1:** extension-contributed models appear in the chat model picker under the account's Copilot plan and org policy.
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

### Phase 0c: target-tenant subset
If the tenant used day to day differs from the test tenant: re-run T0, T1–T6, T7, T15–T19 there before any default is relied on. Findings are recorded under that tenant's alias. Test-tenant results never silently apply to another tenant.

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
R (`store:false`, encrypted reasoning; promoted to GPT-5.x default if T3 passes), G, multi-flavor picker entries, workspace policy, the rate override file editor, and the optional web-app rate refresher.

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
| Phase 0 | API probes only | Environment smoke test first (E1–E5); target-tenant subset (0c) |
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
- Which tenant is the day-to-day target, and whether Phase 0c is needed.
- VS Code version and policy on the target machine (answered by Phase 0a).
- Ask Sage's terms for third-party clients.
- Whether the extension is for one user or shared.
- Whether the optional web-app rate refresher is acceptable.

---

## 13. Mission brief for the future Claude Code build

> Build the Ask Sage VS Code language-model provider in `PLAN.md` phase by phase, starting with the Phase 0a smoke-test provider, then the Phase 0b probe script.
>
> Read `research/*.md` first, especially `caching-and-endpoint-flavors.md` and `token-conversion-and-ui-endpoints.md`. The specs in `research/sources/` and the rates in `research/model-token-conversion.json` are the starting data.
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
