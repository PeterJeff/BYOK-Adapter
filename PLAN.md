# Ask Sage Model Provider for VS Code: design and phase plan (v3.5)

This file is the **design**: what the extension does, why, and in which phase. It holds no build status. Other facts live elsewhere:
- Status against each expectation: `REQUIREMENTS.md`.
- Known defects: `DEFECTS.md`.
- Open work and its priority order: `TODO.md`.
- Measured evidence: `research/live/FINDINGS.md`.
- The revision history is §11.

**Implementation constraint.** The machine has VS Code and nothing else: no npm, no package manager, no build tools.
- The extension is written in **plain JavaScript**: CommonJS, `// @ts-check` with JSDoc types.
- It has no build step and uses only Node built-ins and the `vscode` API.
- It is loaded manually: an unpacked folder, or a `.vsix` built by the repo's zero-dependency packer run on VS Code's bundled Node.
- Where this document says `.ts`, read `.js`. `AGENTS.md` has the working rules.

**Premises.**
- **No Copilot sign-in, ever.** Neither the machine nor the dev machine is ever signed in to GitHub Copilot. Per VS Code's documentation, since 1.122 extension-provided and BYOK models work in chat, agent mode and MCP with no GitHub account and no Copilot plan. Inline completions and anything embeddings-based still need GitHub. This project exists to use that route.
- **Rates come from the API at runtime,** never from a hand-maintained table (§3.1).

Items marked **LIVE-TEST** must be confirmed by a recorded fixture for the tenant before code depends on them. `REQUIREMENTS.md` §3 tracks which are. Test IDs (T0–T22, E1–E5) are defined in §9.

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
2. **Thinking.** Ask Sage's documented Claude config never switched on extended thinking. (Its VS Code page does now, with `"thinking": true` and a reasoning-effort list, checked 2026-09-27; `research/live/FINDINGS.md`, "Checked against the docs".)
3. **Output caps.** Output limits are low (as little as 5–8k on some models) or left to unknown server defaults.
4. **Stateful Responses API.** The Responses API path chains `previous_response_id` without storing responses. (Ask Sage's VS Code page works around this with `"zeroDataRetentionEnabled": true`, checked 2026-09-27.)
5. **Silent errors.** Errors come back as HTTP 200 with the error in the body.
6. **No cost view.** There is no rate awareness, so no cost display.

Reasons 2 and 4 are now fixed by configuration in Ask Sage's own guide, so the extension has to earn its place on caching, cost awareness and error handling. T12 measures the built-in route configured exactly as that guide says. Its results decide how much of reason 1 still holds for each model family, so T12 gates Phase 2's acceptance (§9). Its Claude-on-Messages leg matters most: Copilot's own `messagesApi.ts` places cache breakpoints, so the built-in route may already cache Claude.

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
  - Claude through M (Vertex `google-claude-*`, Bedrock `aws-bedrock-claude-*`): read **0.1×**, 5-minute write **1.25×**, 1-hour write **2×**. Measured on Haiku 4.5, Sonnet 4.5 and Sonnet 4.6. **Except Opus 5.5, which reads at 0.05× (measured 2026-09-26), as the web app's table says; the table's 0.025× for Fable 5.1 is not yet measured.** So the read multiplier is per model, not a host constant.
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
Overridable per model, through a **flavor settings panel** (Phase 4), not a raw `settings.json` key:
- **What it shows.** A table of every catalog model, the flavor the dynamic choice gives it (the table below, `classifyFlavor` in `src/catalog/index.js`), and the resolved endpoint.
- **Dynamic is the default and stays preferred.** A manual pin set in the panel always wins, over both the static table and any future learned layer. One undecided example of a learned layer is a CC↔R retry on "unsupported" errors (TODO).
- **Pins are stored per model and per tenant** (§2.3). They are read before `classifyFlavor` assigns the flavor, so the transport dispatch does not change.
- **The motivating case.** A model whose R traffic caches nothing must be pinnable to CC without a code change. T12 found this on GPT-6 Astra (`research/live/test-tenant/t12/README.md`).
- The panel shares a settings surface with the rate-override editor, and it is also where the "same model under several flavors" picker option (below the table) is controlled.

| Family | Default | Fallback |
|---|---|---|
| Claude (all hosts) | **M**, always | none: CC gives no reliable Claude caching |
| GPT-5.4 / 5.5 / 5.6 / 6 | **R** (`store:false`, encrypted reasoning, full history): R is cache-discounted (measured), and hit the cache more reliably than CC for GPT-5.6 Luna | CC, with no reasoning between tool rounds. On GPT-6 Sol CC rejects tools unless `reasoning_effort: "none"` (measured), so CC means no reasoning at all there. |
| GPT-4.1, 5, 5.1, 5.2, o-series | R for reasoning models, CC for 4.1 | cache reads are discounted on both (measured on 4.1-nano and 5.4-nano) |
| Bedrock-hosted GPT (`aws-bedrock-gpt-*`) | CC | no caching at all (measured): prefer the Azure-hosted model for agent work |
| Gemini | **G**, with the placeholder `thoughtSignature` added to history function calls: Ask Sage strips real signatures, and Gemini 3 rejects a tool loop without one (T18, T22, `research/live/FINDINGS.md`). The model then does not see its earlier reasoning. Measured on non-streaming `generateContent` only; the streaming endpoint is still open. | none: CC rejects every Gemini id tried, although Ask Sage's VS Code page lists Gemini under Chat Completions. The live `/server/openai/v1/models` list decides per tenant. No cache discount through G (measured), so it is expensive for long loops |
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
| M | `input_tokens` **excludes** cache reads and writes | `cache_read_input_tokens`; `cache_creation_input_tokens` (split by TTL where reported) | `output_tokens` **includes** thinking; Vertex also reports `output_tokens_details.thinking_tokens` (below) |
| CC | `prompt_tokens` **includes** `cached_tokens`: uncached = prompt − cached | `cached_tokens`; writes not reported | `completion_tokens` **includes** `reasoning_tokens`: visible = completion − reasoning |
| R | `input_tokens` **includes** `cached_tokens` | as CC | `output_tokens` **includes** `reasoning_tokens` |
| G | `promptTokenCount` **includes** `cachedContentTokenCount` | `cachedContentTokenCount` | `candidatesTokenCount` excludes `thoughtsTokenCount` (separate) |
| N | best-effort from response fields or `/tokenizer` | none | best-effort |

**Claude thinking.** Vertex Claude reports `output_tokens_details.thinking_tokens` inside `output_tokens` (T7, `research/live/FINDINGS.md`); use it when present. Other hosts may report no separate thinking count. If the rate table gives Claude a thinking rate different from its completion rate, the extension cannot compute it from usage. Default: price all Claude output at the completion rate, record `thinkingUnknown: true`, and let reconciliation (§3.6) measure the error.

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

**`prefixHash`.** `toolSetHash` and `thinkingConfigHash` (above) let a reader attribute a cold turn to tool churn or to a thinking-config change. `prefixHash` does the same for a change in the prefix's *content*.
- **What it hashes.** The deterministic cacheable prefix: every system message, the first user message, and the full, sorted tool definitions (not just their names).
- **What it catches.** A mutated system prompt, server-side injection (§4.3's T5 check), or Copilot rewriting its instructions. These can be told apart from tool or thinking-config churn passively, without opt-in logging.
- Check Cache Health's passive mode (§4.3) uses it.

Usage is also reported to Copilot through a `LanguageModelDataPart` with MIME type `"usage"` in OpenAI `APIUsage` shape. This is an internal Copilot convention that could change on any release, so it is feature-detected and failure is silent.

### 3.5 Guards and spend controls
- **Session spend cap (Phase 1).** A simple per-conversation and per-hour cap in Ask Sage tokens, with a hard stop. It exists before the full guards so that Phase 2 agent testing cannot run away.
- **Pre-flight estimate** = local token estimate × the expected cache split for this conversation × rates.
  - **The local estimate.** Every message part (text, tool calls, tool results, thinking) plus the tool definitions, counted in characters at the same 3.7 characters per token that `provideTokenCount` uses.
  - **The expected cache split.** This conversation's own cache-read share so far. It is 0 (full price) until the conversation has completed a turn, which errs on the conservative side.
  - **Input only, deliberately.** The only output figure available before a response streams is the catalog's `limits.max_output`, and it is unreliable on most models (FINDINGS, "Extension live checks"). Pricing output from it would make the estimate wildly pessimistic. The spend cap counts the actual output cost once a response completes.
  - **Stays local.** `provideTokenCount` stays local and fast and never calls a remote tokenizer.
  - **Optional refinements.** The pre-flight may make one free remote count (`count_tokens` or `/server/tokenizer`) near a guard threshold, and may learn a per-model characters-per-token ratio from real responses.
- **Guards.** A request is checked against three limits:
  - the account's **remaining monthly balance** (§3.3), minus a reserve
  - the per-conversation **session cap**
  - the per-hour **hourly cap**

  Warn when the projected spend passes a fraction of any of them (`asksage.budget.warnFraction`, default 0.8; for the balance, when the request would leave less than the rest of that fraction, 20%, of the monthly limit). A cap the user has not set defaults to 10% (session) and 25% (hourly) of the monthly limit, never above the declared 50,000 and 200,000. In the last 6 hours before the monthly reset the balance stop only warns, and a stop on the balance is confirmed with a fresh read first. Stop when the estimate would cross one. **Warnings must reach the user in the chat UI** (in the response, or as a notification), not only in the output channel.

  The stop is a `LanguageModelError` that names the concrete options:
  - raise the cap setting
  - raise this conversation's cap once (an in-memory override)
  - ask the organization for more tokens (`/user/request-tokens`, §3.3)
  - switch model
  - start a new conversation

  "Compact" is not offered: nothing here can trigger Copilot's own history compaction on command.
- **Cache-health alarm.** Warn in the UI in two cases:
  - The cache-read share stays under 50% for 2 or more consecutive agent rounds on a cache-capable model.
  - The served model is not the requested one. Compare family and version with `sameModel` (`phase0/probe/lib/matrix.mjs`), not raw strings, because aliases differ per flavor (FINDINGS "New rules"). Flag this from the first turn on: real substitution happens and is billed at the substitute's rate (FINDINGS "Corrected", §3.5 served model). A change mid-conversation also means a host failover, which leaves the cache cold.

  A tool-set change is logged for information only. It is an expected, one-time cold turn.
- **Budget mode (experimental).** Advertise a smaller `maxInputTokens` (32k, 64k, 128k or the model maximum), since Copilot compacts history at about 80% of the window.
  - This is **not assumed to save money**. Compaction is itself a model call, the rewritten history forces a cold cache turn, and a small window means frequent compactions.
  - Needs live measurement against normal mode before it is recommended.
- **Output caps.** Always send an explicit maximum output size. Never rely on server defaults.
- **Retries.** Never auto-retry after any output has streamed (it double-bills). Retry once only for auth refresh or transport failure before the first token. Detect errors inside SSE streams as well as in HTTP 200 bodies.
- **Cancellation (T9, measured).** A cancelled stream is billed for somewhat more output than had arrived (the model runs on briefly upstream), far less than the cap. The ledger estimates from input plus streamed output, marks the record, and takes the exact bill from the prompt log (§3.6).
- **Burn-rate forecast** in the status bar tooltip, for example "at this week's rate (120 AS/day) you run out around the 19th". It projects the last 7 days of ledger spend against the remaining balance. Nothing is shown when there is no spend in the window or no known balance.

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
- cache hit rate per model and conversation, with cold turns attributed (tool churn, config change, TTL expiry, failover, prefix/injection change) — the persistent, multi-conversation view of what Check Cache Health's passive analysis mode (§4.3) computes on demand for one model/range
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

- **The System role.** The stable typings of `LanguageModelChatMessageRole` list only User and Assistant, and System is a proposed member.
  - At runtime Copilot's requests *do* carry a system-role message. Phase 0a saw one in the development host and again in an installed copy: about 24k characters, one per request (`research/live/test-tenant/phase0a-report.md`).
  - So the converters feature-detect `roleEnum.System` and map it to each flavor's system slot: M's `system` blocks, CC's `system` message, and R's `system` input item.
  - If a VS Code build ever sends no System role, the system text arrives as a user message. Caching still works, but breakpoint 2 goes unused.
- **Mixed TTLs.** Human pauses between user turns often exceed 5 minutes. When T15 confirms support, breakpoints 1–2 (the stable tools+system prefix) use the 1-hour TTL and breakpoints 3–4 use 5 minutes. Longer TTLs must come before shorter ones. Test with and without the `extended-cache-ttl-2025-04-11` beta header, since hosts may differ. A setting chooses 5m-only, mixed, or 1h-only; the ledger's TTL-expiry attribution shows which pays off.
- **Minimum length.** Each model has a minimum cacheable prefix (roughly 1–4k tokens). Breakpoints below it silently don't cache. The placer skips them, and the health check reports them.
- **Lookback window.** Anthropic documents that a cache lookup only checks about 20 content blocks back from a breakpoint, but T16 read the whole cached prefix from 50 blocks past it (Vertex Haiku 4.5, `research/live/FINDINGS.md`). The rule below is optional: cheap insurance, not a correctness requirement. A round with many parallel tool results can place the new breakpoint more than 20 blocks past the last cached one, and might miss. When a single message would exceed the window, the placer may spend breakpoint 4 on an intermediate block instead. T16 found that the window did not bite on Vertex Haiku 4.5 or Opus 5.5.
- **Thinking parameter per model.** Haiku 4.5 and the 4.5 generation take `thinking: {type: "enabled", budget_tokens}`. Claude 4.6 and newer take `{type: "adaptive"}` with `output_config: {effort}`; Opus 4.7 and newer, Sonnet 5 and Fable reject `budget_tokens` (measured on Sonnet 5). Opus 5.5 and Fable always think, and Opus 5.5 defaults to effort `medium`. The converter picks the shape from a per-model table and falls back on the documented error. It also sends `display: "summarized"` when thinking is shown in the UI (the default is empty thinking text on the newer models). It drops `temperature`/`top_p`/`top_k` on the models that reject them, and it turns VS Code's "required" tool mode into `auto` plus an instruction on Opus 5.5 and Fable 5.1, which reject forced tool choice. The source is Anthropic's API reference (`research/live/FINDINGS.md`, "Checked against the docs"); only the Sonnet 5 rejection is measured through Ask Sage so far.
- **Thinking follows the user's choice.** Copilot passes `modelOptions._enableThinking` (an internal option seen in Phase 0a, so feature-detected). When it is present, it decides whether thinking is on, on the models where thinking can be switched off.
- **Thinking config is pinned per conversation.** Turning thinking on or off, or changing its budget or effort, invalidates the message cache. The provider keeps the first request's thinking config for the life of the conversation unless the user explicitly changes it (logged via `thinkingConfigHash`).
- **Reasoning blobs are resent unchanged, once, and only to their origin.** A thinking block goes back exactly as received, including an empty text. It goes back once per assistant turn, however many tool calls that turn made. It goes back only to the flavor and model that produced it (§5).

### 4.2 CC and R
- Send `prompt_cache_key = hash(conversationId + model)`.
- Test extended retention (`prompt_cache_retention`, T17) on supporting models; if accepted and billed normally, enable it.
- For R: `store:false`, `include: ["reasoning.encrypted_content"]`, the full history each time, and never `previous_response_id`.
- Unknown parameters may be rejected or silently stripped by the proxy; T17 records which.

### 4.3 All flavors
- **Deterministic prefix.** Sort tools by name, serialize JSON with a stable key order, keep system text byte-stable. Copilot already puts volatile content (date, editor and terminal state) in the current user message, after history.
- **Tool-set churn.** Copilot's virtual-tool grouping and MCP server toggles change the tool list mid-conversation, and any tool change invalidates the whole cache. Expect one cold turn per change; the ledger's `toolSetHash` makes these visible. The tool list is pinned per conversation (`asksage.cache.pinToolList`): tools Copilot adds are sent from then on, and tools it removes stay in the list, so a change costs one cold turn and then the list is stable again. A tool must never be withheld from the model.
- **Host failover.** Upstream region or host failover makes the cache cold even when `resolvedModel` is unchanged. The cache-health alarm is the detector.
- **Verification is part of the product.** "Check Cache Health" has two modes:
  1. **Active probe.** Sends the same long prefix twice, then a control request, then a case with many parallel tool results. It reports the cache fields and the budget delta against the formula as PASS/FAIL per model and flavor, and it reports a case it did not run as "not run", never as PASS.
     - The parallel case needs a real conversation's tool list, not a fabricated one.
     - The same logic is Phase 0 tests T1–T4 and T16.
     - It spends real tokens, so it asks first and never runs automatically.
  2. **Passive analysis.** It spends nothing, so it needs no confirmation. It reconciles recent ledger records against Ask Sage's prompt log (§3.6), and checks each record's `estAsCost` against the actual bill.
     - **Matching.** Records are paired with log rows by the *billed* model and the nearest timestamp.
     - **Attribution.** Each cold turn is compared with the previous record in the same conversation and given a cause, in this priority order:
       - tool-set churn (`toolSetHash`)
       - a thinking or reasoning config change (`thinkingConfigHash`)
       - a host failover (`resolvedModel` changed)
       - a changed or injected prefix (`prefixHash`). This is the passive, ordinary-traffic form of the T5 injection check below.
       - TTL expiry (the elapsed time against `asksage.cache.ttlMode`)
     - A conversation's first turn is always cold and is not attributed.
     - This is Phase 3's reconciliation display and the cold-turn half of Phase 6's report (§3.7). Both build on it rather than duplicating it.
     - **Optional.** When `asksage.debug.logRequests` is on, diff the logged request bodies to show the bytes behind a `prefixHash` mismatch.
- **Server-side injection check (T5).** Compare `count_tokens` with the tokens actually billed, run an "echo your instructions" probe, and toggle a marker Custom Intro Prompt. Anything injected at the start of the prompt destroys caching. The user object's `custom_intro_prompt` field lets the extension warn when one is set. (This is the active, one-time version of the passive `prefixHash` check above.)

---

## 5. Conversation state (new)

v2's "per-request state only" principle is relaxed, because reasoning models need state carried across tool rounds:
- **Claude (M):** with thinking on, the signed thinking block from the last assistant turn is sent back with its `tool_use` during a tool loop. Measured through Ask Sage on Haiku 4.5 (T7) and Sonnet 5 (T22): the block round-trips and a tampered signature is rejected, but a round 2 *without* the block is accepted (the model reasons again). So a lost block costs reasoning and tokens, not the request. **Opus 5.5 and Fable 5.1 bind each block to the conversation prefix before it** ("preserved thinking"). Editing that prefix (a changed system prompt, a summarized or trimmed history) returns a 400 on accounts that enforce the check. The M converter handles that 400 by stripping every thinking block and retrying once, logging `reasoningStateLost`. Whether Ask Sage's upstream enforces it is still open (FINDINGS "Still open").
- **Gemini 3 (G, and possibly CC):** thought signatures are required on function calls.
- **OpenAI R:** encrypted reasoning items must be sent back for reasoning to persist. Measured on GPT-6 Sol (T22): `store:false` + `include: ["reasoning.encrypted_content"]` returns the item, and round 2 accepts it. Without it, round 2 still works and the model reasons again.

**First choice:** emit reasoning as a part VS Code preserves in history and read it back from the incoming messages: a thinking part with the signature in its id or metadata (a `LanguageModelDataPart` with a private MIME type turned out not to come back; see E4 below).

**Why the first choice works (E4).**
- **Between turns**, VS Code hands back only the text. Neither the thinking part nor a data part comes back.
- **Inside a tool loop**, the thinking part does come back, with its id and metadata intact. Six rounds passed, with signatures of up to 64 KB returned byte for byte.
- **The data part never comes back.** So the blob rides in the metadata of a feature-detected `LanguageModelThinkingPart`, which works in an installed copy too, and never in a data part.
- That is the case that matters: Claude's signed thinking, Gemini's thought signatures and OpenAI's encrypted reasoning are all needed only inside the tool loop.
- Evidence: `research/live/test-tenant/phase0a-report.md` and `phase0a-e4-loop.md`.

**Tag the blob with its origin.** Store the flavor and the model that produced it next to it, and resend it only to the same flavor and model. A chat can switch models mid-conversation, and one flavor's blob is meaningless, or rejected, on another.

**Fallback (needed if the thinking part is absent on the machine, drops the metadata or size-limits it): a bounded in-memory side cache in `state/`:**
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
  rates/       billed rates from the tokenizer (per tenant, last-good copy in global storage), cache rules per host and model, cost formula, learned output caps
  normalize/   per-flavor usage normalization (§3.2)
  transport/   anthropicMessages.js, openaiChat.js, openaiResponses.js, gemini.js, nativeQuery.js, sse.js, sepStream.js
  convert/     messages per flavor, tools (schema sanitizing, deterministic ordering), reasoning round-trip
  state/       bounded reasoning side cache (§5)
  cache/       breakpoint placement (M) incl. TTLs, minimums and lookback, prompt_cache_key, health check
  budget/      budget service, spend cap, guards, forecast
  ledger/      per-process JSONL writer, merge reader, reconciliation, report queries
  policy/      workspace policy (§6)
  tools/       (Phase 5) asksageCodebaseSearch, asksageDatasetSearch via vscode.lm.registerTool
  ui/          status bar, notices, Check Cache Health, reports webview
  diagnostics/ on-machine health report and self-test (§14)
  debug/       opt-in request/response log (the only place prompt text may be written)
  errors.js, log.js
```

Principles:
- plain JavaScript, CommonJS, `// @ts-check` + JSDoc; no build step, no npm, Node built-ins only
- zero runtime dependencies
- stable API, with proposed fields and Copilot internals feature-detected and degrading silently
- per-request state, except the bounded reasoning cache in `state/`
- the key in SecretStorage only
- every response body and every SSE event is checked for `{status, response}` errors. Verified: **every flavor** returns HTTP 200 with `{"response":"Token is invalid [1]","status":400}` on bad auth.
- each model declares `capabilities.toolCalling` as its numeric tool limit where one exists (e.g. 128 for OpenAI models; T11), `false` where the model is known to reject tool lists, and `imageInput` where supported; image inputs are priced in the ledger
- every error the user can see says in plain words what failed, the likely cause and what to try, naming the feature as the health report does (§14.3); it is raised as the `LanguageModelError` kind that fits it (not `Blocked` for everything)
- a network wait is an idle timeout reset by each chunk, never a total timeout across a whole stream; a timeout surfaces as an error, never as a silently truncated success

---

## 8. Semantic search

Copilot's `#codebase` semantic search cannot be pointed at a third-party backend. The relevant APIs are proposed only. What does work is exposing our own tools to agent mode through the stable Language Model Tools API.

**Gate before building.** Agent mode already has text search, file search and usages, and for C++ the language server's workspace symbols are free. Before Phase 5, a week of ledger data records how often the agent searches and how often it searches repeatedly for the same thing. Build `#asksageCodebase` only if that shows a real gap.

- **`#asksageCodebase`.** A local vector index built with `/server/openai/v1/embeddings`, stored on disk per workspace and searched with cosine similarity in plain JS.
  - Rough cost for a 50k-line C++ repo: about 0.6M model tokens to build (times the embedding rate), then about 10–40k a day to re-embed changes. The index is about 12 MB, and a search takes under 10 ms.
  - Only text chunks go to the embeddings endpoint, subject to the workspace policy (§6).
  - Embeddings charge the **training** balance, not inference (T20: `text-embedding-3-small`, not in the catalog, 1,536 dimensions).
- **`#asksageDocs`.** Query an existing Ask Sage dataset. No documented endpoint returns search results on their own, so this runs `/query` with `dataset`, a cheap model and a minimal reply, and parses the `references` string (about 2–7k inference tokens per search). Two leads for results-only search, the `/get <text>` chat command and `/get-dataset-results`, are **LIVE-TEST** (T21).
- **Datasets economics.** Training tokens are charged once, at ingestion, from their own monthly balance. Retrieval costs inference tokens, because the retrieved chunks enter the prompt. There is no update operation: a changed file must be deleted and re-uploaded, which charges the full file again. Datasets suit stable docs, not a fast-changing codebase.

---

## 9. Phases

**Where things are verified.** The dev machine and the public test tenant (`api.asksage.ai`) are the reference environment, and every phase is built and accepted there. The machine is close enough that it is not measured separately.
- It receives beta builds (alpha at worst), and **no data comes back from it**: no files, logs or copied text. The extension has been run there.
- Feedback is the owner's spoken account of what they saw.

Two consequences:
- **Each build must explain itself on the machine it runs on** (§14). A health report in plain language says which features work and which don't, so the owner can look at it and say what's wrong. Plain-language error messages and feature detection that reports what it found feed that report.
- **Tenant differences are handled at runtime** (§2.3): calibrate what can be calibrated, and degrade safely instead of relying on a measured per-tenant table.

### Phase 0a: environment smoke test (dev machine, no API)
A small provider that echoes the prompt (`phase0/smoke-extension/`), side-loaded as an unpacked folder or a `.vsix` (built with `scripts/pack-vsix.mjs`). It costs nothing and is the go/no-go gate. It can also be installed on the machine as a first beta: whether it works there is the useful signal, not its numbers.
- **E1:** extension-contributed models appear in the chat model picker **with no GitHub or Copilot sign-in** (the state on the machine), on VS Code 1.122 or later. Also record whether a Copilot Business/Enterprise "Bring Your Own Language Model Key" policy or MDM setting applies to a signed-out machine (unverified in the research).
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
| T12 | reproduce a BYOK session as a baseline, with VS Code's Custom Endpoint configured as Ask Sage's VS Code page says (manual; gates Phase 2 acceptance, §1) |
| T13 | long-context threshold behavior with cached input |
| T14 | usage normalization: raw usage fields per flavor captured for §3.2 fixtures |
| T15 | 1-hour and mixed TTLs, with and without the beta header |
| T16 | cache hit when a round adds more than 20 blocks (parallel tool results) |
| T17 | `prompt_cache_key` and `prompt_cache_retention` accepted, stripped or rejected |
| T18 | Gemini thought signatures through G and through the CC shim |
| T19 | budget counter lag and granularity (single-request resolvability) |
| T20 | embeddings endpoint availability and which balance it charges |
| T21 | dataset results-only search leads |
| T22 | model matrix (`--matrix`): cache repeat and a reasoning tool loop per model and flavor, so flagship, other-host and partner models are covered, not only the cheapest per role |

Estimated cost: about 200–350k Ask Sage tokens. **Exit:** `research/live/FINDINGS.md`, with the default flavor table, cache policy and normalization rules confirmed or corrected for the test tenant.

### Phase 0c: other-tenant subset (dropped)
Dropped 2026-09-25: no measurements come back from the machine. Test-tenant findings are the development reference; per-tenant differences are handled by runtime calibration and safe degradation (§2.3), and checked by beta use on the machine.

### Phase 1: skeleton with CC and R, ledger and spend cap
CC and R come first because R is the measured default for GPT-5.4 and later (§2.2) and CC serves every other family except Claude and Gemini, so together they reach the most models in any tenant's catalog (§2.3). M follows in Phase 2 with its breakpoints and thinking; G stays in Phase 4.

Tenant and key setup with scoped settings; the catalog from bundled tables and rates; CC and R transports with streaming (R: `store:false`, full history, never `previous_response_id`); the error normalizer (bodies and SSE events); the usage normalizer; the ledger and the `usage` DataPart; the session spend cap; a status bar showing remaining budget and the last request's cost.

**Accept:** GPT-5.x through R and a non-GPT model (e.g. a partner model) through CC stream in Ask mode; every request lands in the ledger with a normalized, estimated cost; the spend cap stops a synthetic runaway loop.

### Phase 2: tools, agent mode, caching and reasoning state
The M transport; tool conversion; cache breakpoints (M) with TTL, minimum and lookback handling; `prompt_cache_key` (CC, R); tool-list and thinking pinning; the reasoning round-trip with the `state/` fallback; the `prefixHash` ledger field (§3.4); the Check Cache Health command in both its active and passive modes (§4.3).

**Accept** (all live, after T12's Claude and nano-on-Responses legs):
- A multi-step agent task shows cache reads of 80% or more from round 2, on GPT-5.x (R) and on at least one other model family.
- A reasoning model completes a 5+ round tool loop without errors, with its reasoning state carried between rounds, on GPT-5.x (R) and on at least one other family. The state is encrypted reasoning, signed thinking, or the Gemini placeholder. At least one round must make parallel tool calls.
- Estimate accuracy: the measured bill is within ±10% of the estimate per request. T19 showed that single requests are resolvable; use batch mode (§3.6) otherwise.

### Phase 3: budget guards
- The pre-flight estimate, warnings and hard stop against the balance and the caps (§3.5).
- The budget-mode experiment, measured against normal mode before it is recommended.
- The burn-rate forecast.
- The cap-override and request-tokens commands.
- The cache-health and substitution alarms.
- The reconciliation display, which is Check Cache Health's passive mode (§4.3) and not a separate mechanism.

**Accept:** live, on the test tenant:
- a warning is seen in the chat UI
- a balance-based stop and a cap-based stop each refuse a request before it is sent
- the reconciliation display matches the prompt log to within the formula's +1 to +6 constant on the matched rows

### Health report track (§14)
This runs alongside the phases rather than after them. H1 (the report) is required before the next build goes to the machine. H2 (the self-test) follows Phase 2's acceptance.

### Phase 4: remaining flavors and overrides
- G.
- The **flavor settings panel** (§2.2): every catalog model against its dynamic flavor, with a per-model, per-tenant manual pin that always wins.
- Multi-flavor picker entries.
- The rate-override editor.
- Workspace policy.

(R moved to Phase 1 once T3 made it the GPT-5.x default.)

### Phase 5: search tools
Subject to the §8 gate: `#asksageCodebase` (local embeddings index, purge command) and `#asksageDocs` (dataset query); N as an opt-in "Ask Sage (datasets)" model variant.

### Phase 6: reports and packaging
The reports webview and CSV export; the `.vsix`; a README covering cache-capable models, utility-model cost, budget mode findings and workspace policy.

---

## 10. Testing and build
- `node:test` unit tests (no npm) against the recorded Phase 0 fixtures, run with `scripts/run-tests.mjs` so they work under VS Code's bundled Node (`ELECTRON_RUN_AS_NODE=1`) as well as a plain `node`.
- **Replay recorded responses wherever one exists.** Error parsing, stream parsing and usage normalization are tested against the fixtures under `research/live/`, not against strings the same author wrote. A hand-written fake is acceptable only when no recording exists, and its test says so.
- Tests cover the shapes agent mode produces: parallel tool calls, a stream that stalls or never ends, a model switch mid-conversation, and an empty thinking text.
- Pure logic kept free of `vscode` imports: converters, usage normalizer, parsers, cost formula, breakpoint placement, reasoning cache, reconciliation.
- No build: plain `// @ts-check` JavaScript (CommonJS) loaded directly by VS Code. The `.vsix` is produced by `scripts/pack-vsix.mjs`, a zero-dependency packer run with VS Code's bundled Node; loading the unpacked folder also works.
- No code copied from `asksageclient`, which is proprietary.
- Ask Sage ships almost daily, so rates, flavors and fixtures are re-checked before each release. Copilot internals (`_conversationId`, the `usage` DataPart, virtual tools) are re-checked against each VS Code release.

---

## 11. Revision history

- **v3 (2026-09-25).** Revised after a design review of v2. The changes are in the table below.
- **v3.1 (2026-09-25).** Plain JavaScript, no build step, no npm (the implementation constraint at the top).
- **v3.2 (2026-09-25).** Two premises corrected:
  - Never signed in to Copilot. v3 had assumed "the account's Copilot plan and org policy".
  - Rates come from the API at runtime.
- **v3.3 (2026-09-25).** 117 measured requests (`research/rate-sources-investigation.md`) settled the rate source, the cache rules per host, and reconciliation through the prompt log (§2.1, §3.1, §3.6).
- **v3.4 (2026-09-27).** Claude thinking rules per model (§4.1, §5), from Anthropic's API reference and T22.
- **v3.6 (2026-09-30).** §3.5: the balance limit added to the pre-flight, unset caps derived from the monthly limit, a notification per warning. §4.3: pinned tool lists admit additions.
- **v3.5 (2026-09-29).**
  - Build status moved out to `REQUIREMENTS.md`, and defects recorded in `DEFECTS.md`.
  - §4.1's 2026-09-28 "correction" (that there is no System role) reverted, because the Phase 0a evidence contradicts it.
  - §3.5: the guards named against the balance and the caps, with visible warnings and model-substitution detection.
  - §4.1 and §5: the rules for resending reasoning blobs.
  - §7: idle timeouts and plain-language errors.
  - §9: Phase 2 acceptance now waits for T12 and needs a parallel-tool round; Phase 3 got acceptance criteria.
  - §14: the on-machine health report added. It is a plain-language report the owner reads and describes aloud, because nothing physical returns from the machine.
  - §12: the third-party-terms question dropped.

| Area | v2 | v3 |
|---|---|---|
| Phase 0 | API probes only | Environment smoke test first (E1–E5), run **signed out of Copilot** on VS Code ≥1.122 (v3.2); other-tenant subset (0c) |
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
| Claude thinking | one `enabled` + budget shape | per-model table (adaptive + effort on 4.6+, always-on Opus 5.5/Fable), display, sampling and forced-tool-choice rules, preserved-thinking strip-and-retry (v3.4, 2026-09-27) |

---

## 12. Open decisions
- Data-handling policy for code sent to the API, and the default `asksage.workspacePolicy`.
- Whether the extension is for one user or shared.
- VS Code version and policy on the machine. These are not measurable; §14's health report shows the version and what feature detection found. The extension must work on the oldest VS Code it declares, and say clearly when something it needs is missing.
- Whether a Copilot Business/Enterprise "Bring Your Own Language Model Key" policy or MDM setting binds a machine that is not signed in. It did not on the dev machine (E1); elsewhere it is found out by beta use.

Closed decisions, with their reasons, are listed in `REQUIREMENTS.md` §6:
- the day-to-day tenant, and Phase 0c
- which rate set Ask Sage bills
- the web-app rate refresher
- Ask Sage's terms for third-party clients: not pursued, because this is not a commercial product

---

## 13. Mission brief for the future Claude Code build

> Build the Ask Sage VS Code language-model provider in `PLAN.md` phase by phase, starting with the Phase 0a smoke-test provider, then the Phase 0b probe script.
>
> Read `research/*.md` first, especially `caching-and-endpoint-flavors.md` and `token-conversion-and-ui-endpoints.md` (not yet in this repository, §0; until they are, `research/live/FINDINGS.md` and `research/rate-sources-investigation.md` are the committed evidence). The specs in `research/sources/` are the starting data. Rates come from the API at runtime, not from a table (§3.1); `model-token-conversion.json` is a 2026-09-22 snapshot of the web app's table, useful only as a cross-check.
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

---

## 14. On-machine health report

**Why.** The machine is where the extension matters. Nothing physical comes back from it: no files, logs or copied text. What comes back is the owner's **spoken account** of what they saw. That account is only cheap to give if the extension has already done the diagnosis.

So the extension produces a **health report written for a person to read**. In plain sentences, it says which features work and which don't, and what was seen. The owner can look at it and say, for example:
- "Claude doesn't work: every request is rejected for asking too much output."
- "Caching on the GPT models is poor, and it says the tool list keeps changing."

The owner decides what is fine to repeat. The report does not pre-filter for them, apart from never showing secrets.

**Principles.**
1. **Verdicts, not data.** Every feature gets a status word and a one-sentence explanation. A number appears only where a reader can judge it. When a number decides the verdict, the threshold is shown next to it, for example: "84% of input was read from cache from the second round on (good: 80% or more)".
2. **Say-able.** Features are named in ordinary words ("Chat with Claude models", "Caching on GPT models", "Reasoning kept between tool steps"), never in this repo's shorthand (M, CC, R, T-numbers). The same names are used in error messages and in §14.2. So a spoken report maps straight to a feature here, and nothing needs decoding.
3. **Most important first.** A short summary at the top lists what is not working, then what is degraded, then what hasn't been tried yet.
4. **Honest about gaps.** "Not tried yet" (no traffic of that kind) and "Can't tell" (the data needed is missing) are verdicts of their own. A feature with no traffic is never shown as OK.
5. **No secrets.** The API key and access tokens never appear, and neither does prompt text (the ledger holds none). Everything else may appear if it helps the reader describe a problem: model names, server error messages, versions, setting values.
6. **Works when things are broken.** With no key, no network or an empty ledger, the report still opens and says so plainly.

The smoke extension's report (`phase0/smoke-extension/lib/report.js`) is a precedent for what to collect. This one differs in being written for a reader, not for analysis.

### 14.1 What it looks like

A markdown document opened in VS Code's preview. For example:

> **Ask Sage health report.** Extension 0.3.0 · VS Code 1.139.1 · covers the last 7 days
>
> **Summary**
> - **Not working: chat with Claude models.** All 4 requests were rejected by Ask Sage because the extension asked for more output than the model allows ("max_tokens: 800000 > 128000 …").
> - **Poor: caching on GPT models (Responses endpoint).** 12% of input was read from cache from the second round on (good: 80% or more). Most cold rounds came right after Copilot changed the tool list.
> - **Working:** setup, connection, model list, chat with GPT models, cost estimates.
> - **Not tried yet:** agent mode with Claude, stopping a reply partway.
>
> **Features**
>
> | Feature | Status | What was seen |
> |---|---|---|
> | Connection to Ask Sage | Working | The model list loaded in 0.4 s. |
> | Chat with Claude models | Not working | 4 of 4 requests rejected. Latest: "max_tokens: 800000 > 128000 …" |
> | Caching on GPT models (Responses) | Poor | 12% from round 2 (good: 80%+). Cold rounds: 14 after a tool-list change, 2 after a pause of more than 5 minutes. |
> | Spend limits | Warning | The hourly limit (200,000) is larger than the balance left this month (150,000). |
>
> **Recent problems** (newest first): a sentence each, with when (relative: "2 hours ago"), the model, what happened, and the server's own message.
>
> **Details**: per-model counts, for anyone who wants them.

### 14.2 Features checked

| Feature | Judged from | Verdict rule (sketch) |
|---|---|---|
| API key and account email | settings, SecretStorage | Missing key: not working. Missing email: cost and budget features are off, and the report says which ones |
| Connection to Ask Sage | a free model-list fetch | The failure is explained in words: name lookup failed, connection refused, certificate problem ("often a network inspection proxy"), timed out |
| Sign-in to the account's token service | the free token exchange | Working, or the server's message |
| VS Code support | version and API feature detection | Below 1.122: signed-out chat is not supported. Also reports whether the thinking display, conversation id and system prompt are present |
| Model list | the catalog plus `force_models` | Counts, what is hidden and why, and whether the organization's restriction matched any model |
| Chat with Claude / GPT (Responses) / other models (Chat Completions) | ledger and the failure recorder | Any failures: the most common server message, and how many of how many requests |
| Agent mode tool calls | ledger | Tool steps, the longest loop, parallel calls seen, tools added mid-conversation |
| Caching, per kind of model | ledger | The share of input read from cache from round 2: good at 80% or more, poor below 50%. Cold rounds are counted by cause, in words (§4.3) |
| Reasoning kept between tool steps | ledger (`reasoningStateLost`) | Lost in N of M steps |
| Long replies | ledger and the failure recorder | Replies cut off by a timeout, or stopped at the output limit with nothing visible |
| Stopping a reply | ledger | Cancels were seen and were recorded with an estimated cost |
| Cost estimates | the free prompt log | The share of requests whose bill matched the estimate within the formula's constant; unmatched requests counted |
| Spend limits | settings, balance, ledger | The limits compared with the remaining balance; stops and warnings triggered |
| Copilot background calls | ledger | Titles and progress messages: how many, and whether they were answered locally |

**Sources.**
- The ledger for the last 7 days.
- A recorder of the last 50 failures in `globalState`, holding the full server message, the model and the step number. It records failures even where the ledger has no row (DEFECTS D8).
- The free calls the extension already makes (catalog, token exchange, tokenizer, balance, prompt log).
- Feature detection.

### 14.3 Error messages in chat

Every error shown in chat says three things in plain words:
- what failed, using the feature names from §14.2
- the likely cause
- what to try (for example, a setting, another model, or "Show Health Report")

The server's own message follows. It is raised as the `LanguageModelError` kind that fits (§7). An owner who only saw a chat error can therefore repeat it meaningfully without opening anything.

### 14.4 Self-test (optional, spends tokens)

**Ask Sage: Run Self-Test** first confirms, showing a tokenizer-priced estimate. Then, for each kind of model, on the cheapest listed one or a model the user picks, it runs:
- a plain reply
- a repeated long prompt, to check caching
- a 2-step tool loop with reasoning carried between the steps
- a step with parallel tool calls
- a stopped reply

The results appear in the report as plain rows, for example "Self-test, Claude: plain reply works; caching works; tool loop not working (…)". This covers features the owner hasn't exercised in real use.

### 14.5 Commands

- **Ask Sage: Show Health Report.** Free. It is also linked from the status bar tooltip and from Show Status.
- **Ask Sage: Run Self-Test.** Spends tokens.
- When a feature first turns "Not working" during real use, a one-time notification offers to open the report.

### 14.6 Build order and acceptance

- **H1: the report.** Free. It needs:
  - plain-language errors (§14.3)
  - error records in the ledger (DEFECTS D8) and the failure recorder
  - the Show Health Report command

  H1 is required before the next build goes to the machine.
- **H2: the self-test.** After Phase 2's acceptance, so that it tests code already known to work.

**Accept (H1, on the dev machine):**
- The report opens within 2 s in each case: no key, a wrong key, a bogus host, and normal use.
- For each failure provoked on purpose, the summary names the right feature as not working, in a sentence that someone who has not read the code can repeat. The failures: a wrong key, a bogus host, a model not in the catalog, and a Claude request whose stream stalls.
- A unit test confirms that the API key and access token never appear in the report, even when a server message echoes them.
