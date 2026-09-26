# Ask Sage rates, billing and caching: measured (2026-09-25)

Written by the cloud Claude Code session on branch `claude/rates-billing-findings`, answering `research/handoff/cloud-rates-and-billing.md`. The handoff assumed no Ask Sage spend. The author then approved live measurement on the test tenant, so this went further than the handoff asked: **117 requests costing 36,013 Ask Sage tokens** of the test tenant's 200k monthly budget, plus free calls. The used-tokens counter moved from 810 to 36,823, exactly the sum of those 117 prompt-log rows.

**Evidence labels.** **[M]** measured here: a request was sent and its bill was read back. **[F]** fetched: a public bundle, doc page or free endpoint, read on 2026-09-25. **[I]** inference: a reasoned conclusion that no measurement confirms. Everything was measured on the **test tenant** (`api.asksage.ai`, a personal paid account) and is provisional for any other tenant until re-run there (PLAN §2.3, Phase 0c).

Data: `research/live/test-tenant/billing/2026-09-25/` (per-request measurements, redacted: no prompt text, no ids) and `research/live/chat.asksage.ai/rates/2026-09-25/` (rate-source ratios). Tool: `phase0/probe/rate-sources.mjs` (free).

## 1. Answers

| Question | Answer |
|---|---|
| Which rates are billed? | **Neither the API's `token_conversion_rate` nor, on every model, the web app's table. The billed rates are what `POST /server/tokenizer` with `convert_to_asksage` returns** [M]. That endpoint reproduced all 101 non-zero bills with complete usage, across 18 models and all five flavors, to within +1.3 to +5.3 Ask Sage tokens per request. It is free and covers every model, including the 10 that have no API rate. |
| Is the API's rate the bill? | **No** [M]. On 66 of 105 models the bill is exactly **1.30 ×** the API rate. On the rest it is 0.65× to 3.6× the API rate, for example GPT-5.4 at 0.65× (the API over-estimates) and Bedrock Claude 4.5 Sonnet at 3.6× (the API under-estimates). |
| Is the web app's table the bill? | **On 99 of 105 models, yes, within 1.5%** [M/F]. Six models are billed off-table: `google-claude-sonnet-5` 1.5×; `gpt-5.6-sol-gov` 1.25×; `gpt-5.6-luna-gov` 1.25–1.27×; `gpt-5.6-terra-gov` 2.5× prompt / 1.9× completion; `aws-bedrock-gpt-5-6-luna-gov` and `-terra-gov` 1.32×. The table also has no row for cache behavior on models where caching is billed (§3). |
| Where does 1.3× come from? | The table's numbers are the "legacy" list's numbers divided by 1.3, in its unit (model tokens per Ask Sage token) [F]: a 1.3× price markup baked into the hardcoded values. No constant named markup or surcharge exists in the bundle or `vars.js` [F]. `chat.asksage.com/vars.js` sets `REACT_APP_token_ratio_modifier: 0.7`, but the current bundle never reads it [F]. The API rates look like the pre-markup base price on those 66 models [I]. |
| Is there a per-request bill to reconcile against? | **Yes, exactly** [M]. `POST /user/get-user-logs` (the web app's Prompt Logs page) returns one row per request with `model`, `prompt_tokens`, `completion_tokens` and `total_tokens`. `total_tokens` is the bill: the rows summed to the used-tokens counter to the token, every time it was checked. Paging: `{limit ≤ 100, before_id}`. |
| Is caching billed, per endpoint? | M (Claude): **yes**, with read 0.1×, 5-minute write 1.25×, 1-hour write 2× [M]. CC and R (OpenAI via Azure): **yes**, read 0.1×; a 1.25× write only on models that report `cache_write_tokens` (GPT-5.6/6) [M]. **No** discount on G (Gemini: the implicit cache hits, but is billed at full price), on Bedrock-hosted GPT-5.6, or on N [M]. **Claude via CC is billed 0 today**, which is an Ask Sage bug; don't depend on it (§4). |
| What keeps a cache line alive? | Claude: `cache_control` breakpoints. The 5-minute TTL expired after 8 minutes idle. `ttl: "1h"` works with no beta header and held after 28 minutes idle [M]. OpenAI: automatic prefix caching; `prompt_cache_key` accepted; hits survived 4.5 to 6 minutes idle but not 20 minutes; `prompt_cache_retention: "24h"` is accepted but did not extend it [M]. GPT-5.6 Luna on CC missed 4 times in 9 attempts despite a stable key; R hit 3 of 3 [M]. |
| Can cost be estimated before sending? | Yes (§5). Claude: `count_tokens` is free and exact on Vertex, including the newer tokenizer of Opus 5.5 [M]. On Bedrock it over-counts by 28%; ask the Vertex twin model instead. Others: `/server/tokenizer` is free, uses one generic tokenizer, and came within 3% for GPT and Gemini on English text; it under-counts Opus 5.5 by 16% [M]. The price per token comes from the tokenizer's conversion (above). |
| Would an agent loop without caching be ruinous? | A 6-round Claude tool loop cost **4,061** uncached and **1,497** with Copilot-style breakpoints [M]. From round 2 on, a cached round cost 173–212 against 527–926 uncached, and the gap grows with each round. Over a 100k-token context and 20 rounds that is about a **5×** difference [I, from the measured multipliers]. |

## 2. Rates

### 2.1 Three sources [F]

| Source | Where | Unit | Coverage |
|---|---|---|---|
| API | `POST /server/get-models?format=full` → `token_conversion_rate` | Ask Sage tokens per model token | 95 of 105 (no image/video models, `llma3`, four Azure Gov GPT models) |
| Web app table | chat bundle, `{key, rates:{prompt, completion, thinking, cacheRead, cacheWrite5Min, cacheWrite1Hr, longContext*}, longContextThreshold}` | model tokens per Ask Sage token | 108 rows (was 104 on 2026-09-22); 30 with cache rates (was 26: adds Opus 5.5 on Vertex and Bedrock, and GPT-5.6 Gov on Azure) |
| Legacy list | chat bundle, `conversion:{askSageTokens:1, modelTokens:{flatRate, prompt, completion}}` | same as table | 130 rows |
| **Tokenizer** | `POST /server/tokenizer {content, model, convert_to_asksage:true, completion_estimate}` | integer Ask Sage tokens for the given content and completion estimate | every model id; free |

The bundles differ between hosts only in minified names: `chat.asksage.ai` `index-DcmfUYyN.js` and `chat.asksage.com` `index-1SBSfNgZ.js` carry the same tables [F]. The API rates are identical on `api.asksage.ai` and `api.asksage.com` for shared models; `.com` serves 92 models, `.ai` 105 [F].

### 2.2 Agreement (`research/live/chat.asksage.ai/rates/2026-09-25/summary.md`)

- API ÷ table: 75 at 0.769 (1/1.3) on both prompt and completion; the rest from 0.277 to 2.03, as the handoff described. The 2026-09-22 pattern still holds; the table grew by 4 rows.
- API ÷ legacy: 25 at exactly 1.000; the rest vary widely, so the API is not simply the legacy list.
- **Tokenizer ÷ table: 99 of 105 within 1.5%** (the small deviations are integer rounding on cheap models); the 6 exceptions are listed in §1.
- Tokenizer ÷ API: 66 at 1.30, 9 at 1.29, 10 at 0.65 / 0.87 (GPT-5.6/6), and a tail.

### 2.3 Measured bills [M]

Formula, per request, on the response's own usage fields (normalized per PLAN §3.2), with `p`, `c` the tokenizer's prompt and completion rates:

`billed ≈ uncached×p + cacheRead×p×0.1 + write5m×p×1.25 + write1h×p×2 + output×c + ~3`

With no cache discount on G, Bedrock GPT and N. Residual over 101 requests: min +1.27, median +2.87, max +5.27. The small constant looks like per-component rounding up [I]; it matters only for tiny requests (a 14-in/4-out request bills 4).

| Model (flavor) | Measured | Tokenizer formula | Table | API |
|---|---|---|---|---|
| `google-claude-45-haiku` (M), 4,385 in / 4 out | 318 | 314.9 | 314.9 | 242 |
| `google-claude-46-sonnet` (M), 4,369 in | 938 | 936.7 | 937.2 | 1,442 |
| `google-claude-sonnet-5` (M), 5,292 in | 1,137 | 1,134.6 | 756.8 | 582 |
| `google-claude-sonnet-5` (M), 36 in / 700 out | 760 | 758.5 | 505.5 | 389 |
| `google-claude-opus-5-5` (M), 4,221 in | 1,208 | 1,206.4 | 1,207.0 | 929 |
| `aws-bedrock-claude-45-sonnet-gov` (M), 27 in / 952 out | 2,043 | 2,041.5 | 2,041.4 | 948 |
| `gpt-5.4` (CC), 3,422 in / 14 out | 628 | 626.3 | 626.7 | 964 |
| `gpt-5.4-nano` (CC), 26 in / 838 out | 77 | 75.3 | 75.3 | 58 |
| `gpt-6-luna` (CC), 26 in / 867 out | 39 | 37.4 | 37.4 | 43 |
| `aws-bedrock-gpt-5-6-luna-gov` (CC), 26 in / 859 out | 91 | 88.9 | 67.3 | 103 |
| `gpt-5.6-luna-gov` (CC), 26 in / 858 out | 94 | 92.5 | 74.0 | 107 |
| `google-gemini-2.5-flash` (G), 20 in / 947 out | 156 | 154.3 | 154.3 | 119 |

Every measurement is in `research/live/test-tenant/billing/2026-09-25/measurements.json`.

### 2.4 Other billing behavior [M]

- **Model remapping.** `claude-haiku-4-5-com` (Anthropic direct) was served, logged and billed as `google-claude-45-haiku` (Vertex) on this tenant. The log's `model` shows what was billed; the response's `model` field does not reveal the host.
- **Gemini thinking tokens are not billed** through G: `totalTokenCount` exceeded prompt + candidates by 24–188 thought tokens, and the log and the bill counted only prompt and candidates. OpenAI reasoning tokens are part of `completion_tokens` and billed. Claude thinking was not tested (no thinking-enabled run).
- **Streaming bills the same** as non-streaming on M, CC and G. CC returned usage even without `stream_options.include_usage`.
- **Errors bill 0**: a content-filter block (`Output blocked by content filtering policy`, from Claude on Vertex asked to list numbers) and an unsupported model (`grok-4-1-fast-non-reasoning` on CC) both logged 0.
- **N (`/server/query`)** billed the same as M for the same text plus about 34 injected tokens, and never caches.

## 3. Caching

### 3.1 Per flavor and host [M]

| Flavor → host | Trigger | Reported | Billed |
|---|---|---|---|
| M → Claude on Vertex (`google-claude-*`) | `cache_control` on system, tools or message blocks; no implicit caching (identical requests without it billed full price) | `cache_creation_input_tokens` (split `ephemeral_5m`/`1h`), `cache_read_input_tokens` | write 5m **1.25×**, write 1h **2×**, read **0.1×** (a 40k prefix: write 3,105, read 253) |
| M → Claude on Bedrock (`aws-bedrock-claude-45-sonnet-gov`) | same | same | same multipliers (write 3,928, read 325 against 3,144 uncached) |
| CC → OpenAI on Azure (GPT-4.1, 5.4, 5.6, 6) | automatic for prompts ≥1,024 tokens; `prompt_cache_key` accepted | `prompt_tokens_details.cached_tokens`; GPT-5.6/6 also `cache_write_tokens` | read **0.1×** on every model tested, including GPT-4.1-nano and GPT-5.4-nano, which have **no cache rates in the table**; write **1.25×** where `cache_write_tokens` is reported (GPT-5.6/6: a 40k prefix wrote at 615 against 490 uncached); no write charge on 4.1 and 5.4 |
| R → OpenAI on Azure | automatic; `prompt_cache_key` | `input_tokens_details.cached_tokens` / `cache_write_tokens` | same as CC (**R is discounted**, which answers T3) |
| CC → Bedrock GPT-5.6 (`aws-bedrock-gpt-5-6-*-gov`) | none | nothing | full price every time |
| CC → Azure Gov GPT-5.6 (`gpt-5.6-luna-gov`) | automatic | as CC | read 0.1×, write 1.25× (fits the v2.8.1 release note: "Correct prompt-cache pricing for government models", 2026-09-01) |
| G → Gemini (2.5 Flash, 3.1 Flash Lite Gov) | implicit | `cachedContentTokenCount` (33,764 of 34,622 on a repeat) | **full price**: the cache hits upstream, but Ask Sage does not pass the discount on |
| N → any | none | none | full price |
| **CC → Claude** | only with `cache_control` on a content part; a plain system string and Copilot's `copilot_cache_control` field get no caching | Anthropic-shaped `usage` inside the OpenAI response | **0 on every request** (§4) |

The web app's caption says cache rates "apply only when called through an Ask Sage passthrough endpoint" and lists the Messages and Chat Completions URLs [F]; R is discounted as well [M].

### 3.2 PLAN §2.1's per-family rule, corrected [M]

- **Claude (M): 0.1 / 1.25 / 2 confirmed** on Vertex and Bedrock, Haiku 4.5, Sonnet 4.6 and Sonnet 4.5. `aws-bedrock-claude-fable-5-1-gov` (0.025× read) and Opus 5.5 (0.05×) have lower read multipliers in the table and were not measured.
- **OpenAI via Azure (CC, R): read 0.1× for every GPT model, write 1.25× only when `cache_write_tokens` is reported.** It is not "no discount outside the table's 26 rows". GPT-4.1 and 5.4-nano, which the table lists without cache rates, are discounted.
- **No discount:** Gemini (G), Bedrock GPT, N. Gemini's implicit cache makes requests faster, not cheaper.
- The ratio-based rule means the extension needs no per-model cache table: the response's usage fields say which bucket each token is in, and the host (from the model id) says whether a discount applies.

### 3.3 TTL and keeping a cache line alive [M]

| Test | Idle before re-send | Result |
|---|---|---|
| Claude 5m entry (Haiku, Vertex) | 8 min | **miss**, re-written at 1.25× |
| Claude 1h entry, no beta header | 7 min | hit |
| Claude 1h entry, no beta header | 28 min | **hit** |
| Claude 1h entry, beta header, untouched since written | ≥60 min | not measured (the scheduled run was cancelled; see §8) |
| GPT-5.4-nano, GPT-4.1-nano (CC), 4k prefix | 5–6 min | hit |
| GPT-5.4-nano, GPT-4.1-nano (CC), 34k prefix | 20 min | **miss** (full price again) |
| GPT-5.4-nano with `prompt_cache_retention: "24h"` | 20 min | **miss**: the parameter is accepted (no error, no extra write charge) but had no effect |
| GPT-5.6 Luna (R) | 4.5 min | hit |
| GPT-5.6 Luna (CC) | 6.5 min | miss (and 3 other misses with no idle time) |

- **Claude:** a cache line lives as long as the same prefix, with the same breakpoints, is re-sent within the TTL. Each hit refreshes it (Anthropic's documented behavior; consistent with the hits above). A 1h breakpoint costs 2× once instead of 1.25×, so it pays off whenever a human pause longer than 5 minutes would otherwise force a re-write. With a 1.25 vs 2 write and a 0.1 read, one avoided 5m re-write saves 1.15× the prefix. Nothing else is needed: no conversation id, no beta header.
- **OpenAI:** the prefix must be byte-identical, and routing decides hits. Cache lines lasted between 6 and 20 minutes idle; nothing the client sends extends that (the 24h retention parameter did not). `prompt_cache_key` is accepted, but GPT-5.6 Luna on CC still missed 4 of 9 times while R hit every time. Whether R's advantage holds at volume is not established [I]; the ledger's cache-health check (PLAN §3.5) will show it. Each miss on GPT-5.6/6 costs a 1.25× write, not merely a full-price read.
- **Tool and system changes** invalidate the prefix on every family; nothing new was measured here.

## 4. The Claude-over-Chat-Completions billing bug [M]

Eight requests to `google-claude-45-haiku` through `/server/openai/v1/chat/completions` were answered correctly: HTTP 200, a completion, and `usage` in Anthropic's shape (`input_tokens`, `cache_creation_input_tokens`, …) instead of OpenAI's. Every one was logged with `prompt_tokens: 0, completion_tokens: 0, total_tokens: 0`, and the used counter did not move. A streaming one produced no log row at all. The shapes tried were a string system prompt, an array system prompt, `cache_control` on system or user parts, and Copilot's `copilot_cache_control`. All billed 0.

The likely cause is that the billing step reads OpenAI-shaped usage and finds none [I]. This is Ask Sage's bug, and it will presumably be fixed. **The extension must not route Claude through CC to save money.** It should report the bug to Ask Sage (TODO.md). It also means that anyone who judged VS Code's built-in BYOK route by its Ask Sage bill, with Claude configured as Chat Completions, saw a bill of 0 there, not the uncached cost PLAN §1 assumes. Once the bug is fixed, that route costs full price every round, because a plain system string gets no caching.

## 5. Estimating before sending [M]

| Method | Cost | Accuracy (measured) | Use |
|---|---|---|---|
| `POST /server/anthropic/v1/messages/count_tokens` | free, 0.3–0.7 s | exact on Vertex Claude (Haiku 4.5, Sonnet 4.5, Sonnet 4.6, Opus 5.5); **+28%** on `aws-bedrock-claude-45-sonnet-gov`; exact when the same body is counted with the Vertex twin (`google-claude-45-sonnet`) | Claude pre-flight, with Bedrock ids mapped to their Vertex twin for counting |
| `POST /server/tokenizer` | free, 0.35–1.9 s | one generic tokenizer for every model; on ~21.6k characters of English filler it gave 4,409 against actual 4,355–4,366 (Claude 4.5), 4,294–4,342 (GPT) and 4,342–4,366 (Gemini); **−16%** on Opus 5.5, whose tokenizer is denser; adds about 19 tokens of wrapper (`"x"` counts as 20) | non-Claude pre-flight; and, with `convert_to_asksage`, the per-model billed rate |
| `convert_to_asksage` + `completion_estimate` | free | reproduces the bill (§2.3), including off-table models | the rate source for the cost formula |
| Local `chars / 3.7` (the web app's documented "conservative approximation") | none | +24% to +34% high on this English filler; code tokenizes denser than prose, so the error there is smaller [I] | `provideTokenCount` (PLAN §3.5 keeps that local) |

`provideTokenCount` stays local. The pre-flight guard can make one free remote count per request when the local estimate is near a budget threshold. Per-model local ratios (actual prompt tokens ÷ characters) can be learned from the ledger, since every response reports the true count [I].

## 6. Endpoints and files not in the public specs [F]

- `POST /user/get-user-logs` is in the user spec. The body parameters `limit` (max 100), `before_id` and `full_text` are not; they come from the web app's Prompt Logs page (`aKa()` builds `{user_id, before_id: id+1, limit: 1, full_text: true}` to expand one row). Rows: `id, date_time, model, prompt_tokens, completion_tokens, total_tokens, prompt, response, prompt_length, response_length, *_truncated, teach, ip, user_id`. **The rows include prompt and response text**, so the extension must never persist them; it needs only the numeric fields.
- `/server/tokenizer`: `convert_to_asksage` and `completion_estimate` are in the server spec but not in the guides. In this session a request with no credential header also succeeded. Whether that was the session's proxy injecting a credential or the endpoint being public is unknown.
- `chat.asksage.com/vars.js` has `REACT_APP_token_ratio_modifier` (0.7), `REACT_APP_asksage_prompt_service` (`https://api.asksage.com/prompt`) and `REACT_APP_host_force_default`, none of which the current bundle reads. `chat.asksage.ai/vars.js` has `REACT_APP_pool_only_enforce_user_cap`.
- `https://docs.asksage.ai/llms-full.txt` (893 kB) is the whole documentation set as one text file, the practical way to search it. It has no page on prompt caching or rate tables. The relevant items are the v2.8.1 release note above, and "Ask Sage Tokens" and "Conversation Context" (3.7 characters per token; an 8,000-token reserve in the web app's context gauge).
- The bundle's embedded changelog (28 entries, 2026-04-22 to 09-23) states rate changes in words ("cached input costs a quarter as much" for Fable 5.1; Opus 5.5 "prompt and completion tokens go a quarter further, cached input two and a half times as far"; GPT-6 Sol/Luna "half the price" of GPT-5.6). All agree with the table.

## 7. What this means for PLAN §3.1 and §2.1

The author's decision stands: **no hand-maintained rate table**. The evidence changes which API supplies the rates:

1. **Rates from `/server/tokenizer` (`convert_to_asksage`), not from `get-models`.** Per model, a few free calls (see `phase0/probe/rate-sources.mjs`) yield the billed prompt and completion rates. Cache them per tenant with a timestamp and refresh daily or on a new model. `get-models` still supplies the catalog, limits and CUI flags. Its `token_conversion_rate` is a fallback only, marked "unverified" and multiplied by 1.3 (the relation on 66 of 105 models [M]).
2. **Reconciliation from the prompt log, not the budget counters.** `get-user-logs` gives the exact bill per request, so PLAN §3.6's noisy counter-delta method (lag, integers, org pool, in-flight exclusion, batch mode) becomes a fallback. The ledger matches its own requests to log rows by model, time and token counts, keeping only the numbers. The calibration factor `k` then serves as a check (it should sit at 1.0), not as a correction that takes a week of traffic to learn.
3. **Cache rule per host, not per family** (§3.2): Claude on M: 0.1 / 1.25 / 2. OpenAI on Azure (CC/R): read 0.1; write 1.25 when `cache_write_tokens` is reported. Gemini, Bedrock GPT, N: none.
4. **Flavor defaults:** Claude → M (unchanged; CC is unbilled today and uncached tomorrow). GPT-5.x → R is safe on cost (T3's question is answered: discounted); R also hit the cache more reliably than CC in this sample. Gemini → caching gives no discount either way, so choose G or CC on quality and thought-signature handling.
5. **Long context, Claude thinking, images, flat-rate models** (`aws-bedrock-titan`, `llma3`: constants of 813 and 299 per request in the tokenizer's conversion) were not measured.

## 8. Not done, or still open

- The 1-hour Claude TTL at ≥60 minutes idle. A run was scheduled, but was cancelled once the classifier blocked further unattended spending. OpenAI's exact idle expiry between 6 and 20 minutes.
- `phase0/probe/billing-probe.mjs` (the committed version of the harness used here) is unit-tested and dry-run only: its live validation run was blocked by Claude Code's auto-mode classifier and is left for the author to run.
- Claude with thinking on (is thinking billed as output, at the completion rate?), long-context thresholds (T13), images, embeddings (T20).
- Fable 5.1 and Opus 5.5 cache-read multipliers (the table says 0.025× and 0.05×).
- Other tenants (Phase 0c). The rates here are the test tenant's; the tokenizer conversion may differ per tenant or organization, which is another reason to read it at runtime.
- Whether `/server/tokenizer`'s conversion is authoritative by design or just happens to share the billing code. Ask Ask Sage support, along with the CC-Claude bug.
