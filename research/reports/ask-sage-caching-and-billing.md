# Prompt caching and token billing on Ask Sage: what was measured

Measured 2026-09-25 and 2026-09-26 on one personal paid test account on `api.asksage.ai`, in two independent runs (161 billed requests in total, about 36,000 plus about 9,000 Ask Sage tokens). Not reviewed by Ask Sage. Corrections are welcome, and every number below can be re-checked with the tools in this repository (§8).

## BLUF

Prompt caching does save tokens on Ask Sage, but only on some paths, and on the most popular one you have to ask for it. Published prices and billed prices do not match. One path bills nothing at all.

- **Claude (Anthropic endpoint): caching works if the request asks for it.** Cached input costs **0.1×** (a 90% discount). Writing the cache costs 1.25× (5-minute cache) or 2× (1-hour cache). A request that does not send `cache_control` gets no caching at all: the same request sent twice was billed in full both times.
- **OpenAI GPT on Azure (Chat Completions and Responses): caching is automatic**, cached input costs **0.1×**, and hits are not guaranteed (one model missed 4 of 9 attempts). This includes models the web app's rate table lists without cache rates.
- **Gemini and OpenAI models hosted on AWS Bedrock: no discount.** Gemini reports cache hits in its usage numbers, which looks like it worked, but the bill was the full price.
- **Claude through the OpenAI-compatible (Chat Completions) endpoint was billed 0** (10 requests, two runs): correct answers, nothing charged, nothing cached. This appears to be a billing bug. Do not build on it: when it is fixed the same traffic will cost full price, with no caching.
- **The published per-model rate (`get-models`, `token_conversion_rate`) is not what is billed.** On 75 of the 93 models that have both numbers, the bill is about **1.3×** the published rate. On 18 models it differs by 0.65× to 3.6× in either direction. The **`/server/tokenizer` endpoint with `convert_to_asksage`** reproduced all 101 non-zero bills within +1 to +5 tokens each. Budgeting from `get-models` under-counts most models by about a quarter.
- **Scope:** one commercial-hosted account, two days. Other Ask Sage instances (other hosting regions, tiers or organizations) were **not tested** and may differ. Anyone can re-run the same tests on their own instance (§8); the free tool takes minutes.

**What we ask of Ask Sage** (details in §9): say which rate is authoritative and make `get-models` match it (or document the difference); fix or document the Claude-via-Chat-Completions billing; publish cache, long-context and thinking rates in the API; document which endpoints and hosts cache and what a client must send to get it.

## 1. Does caching save tokens? By path

"Endpoint" is the address a program sends the request to. "Host" is who actually runs the model behind it (Ask Sage routes the same model name to different hosts on different instances). Measured on the test account; each row was billed and read back.

| Endpoint | Model and host | Must the client ask for caching? | Billed for cached input | Notes |
|---|---|---|---|---|
| Anthropic Messages, `/server/anthropic/v1/messages` | Claude on Google Vertex; Claude on AWS Bedrock | **Yes**: put `cache_control` on the system, tool or message parts to cache | Read **0.1×**; write **1.25×** (5-minute) or **2×** (1-hour) | Without `cache_control`: no caching. Same multipliers on both hosts. 40k-token prefix: write 3,105, read 253 |
| OpenAI Chat Completions, `/server/openai/v1/chat/completions` | GPT-4.1, 5.4, 5.6, 6 on Azure (including `gpt-5.6-luna-gov`) | No: automatic for prompts of 1,024 tokens or more, exact same start | Read **0.1×**. Write 1.25× only on models that report a write count (GPT-5.6 and 6); no write charge on 4.1 and 5.4 | Not guaranteed: GPT-5.6 Luna missed 4 of 9 attempts here. Small models the web table lists with no cache rate (GPT-4.1 nano, 5.4 nano) were discounted too |
| OpenAI Responses, `/server/openai/v1/responses` | same GPT on Azure | No: automatic | same as Chat Completions | Hit 3 of 3 (small sample) |
| OpenAI Chat Completions | **Claude** (any host) | n/a | **Billed 0** | Appears to be a billing bug (§6). Not cached either |
| Gemini, `/server/google/...` | Gemini 2.5 Flash, 3.1 Flash Lite Gov | No: implicit | **None**: the cache hits (usage shows 33,764 of 34,622 tokens cached on a repeat) but the bill is the full price | Cache makes it faster, not cheaper |
| OpenAI Chat Completions | GPT on AWS Bedrock (`aws-bedrock-gpt-5-6-*-gov`) | n/a | None | No caching reported; full price every time |
| Native, `/server/query` | any | n/a | None | Bills like the Anthropic endpoint for the same text plus about 34 injected tokens |

## 2. How much does it save?

A 6-round Claude tool loop (context growing from 5,800 to 12,700 tokens), same model, with and without cache breakpoints:

| Run | No caching | With caching | Saving |
|---|---|---|---|
| Cloud session (2026-09-25) | 4,061 | 1,497 | 2.7× |
| Author's machine (2026-09-26) | 3,996 | 1,480 | 2.7× |

From round 2 on, a cached round cost 172 to 211 tokens; the same round uncached cost 515 to 914. The gap grows with each round and with context size (the cloud run estimated about 5× for a 100,000-token context over 20 rounds; that is inference from the multipliers, not measured).

## 3. How long does a cache last?

| What | Idle time before the next request | Result |
|---|---|---|
| Claude, default 5-minute cache | 8 minutes | **Miss**: paid the 1.25× write again |
| Claude, 1-hour cache (`"ttl": "1h"`), no beta header | 7 and 28 minutes | **Hit** both times. Over 60 minutes: not measured |
| GPT on Azure (Chat Completions) | 5 to 6 minutes | Hit |
| GPT on Azure | 20 minutes | **Miss**: full price again |
| GPT with `prompt_cache_retention: "24h"` | 20 minutes | Miss: the parameter is accepted but had no effect |

In practice: a person who pauses for more than 5 minutes between messages will pay the write price again on Claude unless the 1-hour cache is used (it costs 2× once instead of 1.25× each time).

## 4. Why people are confused (what we think; labeled)

**[M]** measured here. **[I]** inference, not confirmed.

- **Claude caching is opt-in, and many clients never opt in.** A plain system prompt string and a client-specific field (`copilot_cache_control`, used by VS Code's built-in "bring your own key" route) got no caching **[M]**. Users of such clients see full price every time and conclude caching "does not work" **[I]**.
- **The web app's rate table lists cache rates for only some models** (30 of 108 rows) **[M]**. A missing entry looks like "no caching", but GPT models without an entry were discounted **[M]**.
- **Gemini shows cache hits but is not discounted** **[M]**, so the usage numbers say "cached" while the bill says otherwise.
- **OpenAI caching is automatic but fragile**: the start of the prompt must be identical, prompts must be 1,024 tokens or more, and hits varied between identical attempts **[M]**. Anything that changes the start (a date, a reordered tool list) will miss **[I]**.
- **Published rates do not match bills** (§5), so a person checking their own math against `get-models` gets numbers that do not add up **[M]**.
- **Claude via Chat Completions is free today** (§6), which hides both cost and the absence of caching **[I]**.
- **The same model name can run on a different host per instance**: `claude-haiku-4-5-com` (Anthropic direct) was served, logged and billed as `google-claude-45-haiku` (Vertex) on this account **[M]**. Caching behavior depends on the host, so results from one instance may not carry over **[I]**.

## 5. Published rates versus billed rates

Ask Sage exposes rates in three places:

| Source | What it is | Unit |
|---|---|---|
| `POST /server/get-models?format=full` → `token_conversion_rate` | Prompt and completion multipliers for 95 of 105 models | Ask Sage tokens per model token |
| The chat web app's Token Conversion table | Hardcoded in the page's JavaScript; also has cache and long-context rates | model tokens per Ask Sage token (the inverse) |
| `POST /server/tokenizer` with `convert_to_asksage` | Converts a given text and expected reply size into Ask Sage tokens | Ask Sage tokens |

Results, compared on 2026-09-25:

- **The tokenizer endpoint reproduced the bill** for all 101 non-zero requests, on 18 models and all five endpoint types, within +1.3 to +5.3 Ask Sage tokens each (median +2.9; the small constant looks like rounding) **[M]**. It is free and covers every model, including the 10 with no published rate.
- **The web app's table matched** the tokenizer on 98 of 105 models within 1.5%, and was off on 7 **[M]**.
- **`get-models` did not match**: 75 of the 93 models with both numbers are billed at 1.29 to 1.30× the published rate; 18 others range from 0.65× (published is higher than billed) to 3.6× (published is much lower than billed). Twelve models have no published rate (image, video and some others) **[M]**.
- **The per-request bill is exact in the prompt log**: `POST /user/get-user-logs` returns `total_tokens` per request, and 117 rows summed to the used-tokens counter to the token **[M]**.

Examples from the author's run (small requests are affected by rounding; the first three are the clearest):

| Request | Model | Tokens in / out | Billed | `get-models` rate implies | Billed ÷ published |
|---|---|---|---|---|---|
| Long prompt | `google-claude-45-haiku` | 4,382 / 4 | 318 | 242 | 1.31 |
| Long reply | `google-claude-45-haiku` | 27 / 526 | 192 | 146 | 1.31 |
| Long prompt | `google-gemini-3.1-flash-lite-gov` | 4,374 / 1 | 81 | 60 | 1.34 |
| Long reply | `gpt-5.4-nano` | 22 / 635 | 59 | 44 | 1.34 |
| Long prompt | `gpt-5.6-luna` | 891 / 4 | 15 | 20 | 0.75 |
| Long reply | `gpt-5.6-luna` | 22 / 581 | 52 | 58 | 0.90 |

Largest deviations worth checking first (billed ÷ published prompt rate): `aws-bedrock-claude-45-sonnet-gov` 3.6×, `google-claude-sonnet-5` 1.95×, and the GPT-5.4, 5.6 and 6 families about 0.65× (billed less than published).

We do not know whether the 1.3× is a deliberate markup that `get-models` leaves out, or a stale number. Either would be fine to document; what hurts is that it is undocumented.

## 6. Claude through the OpenAI-compatible endpoint is billed 0

Ten requests in two runs sent `google-claude-45-haiku` through `/server/openai/v1/chat/completions`. Each returned HTTP 200 and a correct answer, with `usage` in Anthropic's shape (`input_tokens`, `cache_creation_input_tokens`) instead of OpenAI's. Every prompt-log row said `total_tokens: 0`, and the used-tokens counter did not move. One streaming request left no log row. A plain system string, an array system prompt, `cache_control` on system and user parts, and the client-specific `copilot_cache_control` field all billed 0. The same model through the Anthropic endpoint billed normally on every one of 28+ requests.

Likely cause **[I]**: the billing step looks for OpenAI-shaped usage, finds none, and records zero. Please treat this as a bug report, not as something to use: the test was about ten small requests (roughly 1,000 input tokens each) and we do not intend to use the path. If it is fixed, the same traffic will cost full price with no caching. Anyone relying on this path (for example a client pointed at Ask Sage as "OpenAI-compatible" while configured for a Claude model) should expect that change.

## 7. What was not tested

- Any instance or account other than the one test account. Rates and hosts may differ per instance, region or organization.
- Claude with extended thinking on (whether thinking is billed as output).
- Prompts over the long-context thresholds (about 200,000 tokens for some Claude models, 272,000 for some GPT models).
- The 1-hour Claude cache after more than 60 minutes idle; OpenAI's exact expiry between 6 and 20 minutes.
- Cache-read multipliers below 0.1× that the web table lists (`aws-bedrock-claude-fable-5-1-gov` at 0.025×, Opus 5.5 at 0.05×).
- Images, video, embeddings.
- Whether the tokenizer endpoint's conversion is authoritative by design or shares the billing code by coincidence.

## 8. Check your own instance

**Without writing code:** the web app's Prompt Logs page shows `total_tokens` for each request. Send the same request twice and compare. If the second costs about 10% of the first, caching is being billed; if the two are equal, it is not.

**With this repository** (plain JavaScript; needs Node 22 or newer, which VS Code includes; no installs):

1. **Free, minutes:** `node phase0/probe/rate-sources.mjs chat.<your instance>` compares the three rate sources on your instance and writes only ratios to `research/live/`.
2. **Spends tokens (about 9,000):** `node phase0/probe/billing-probe.mjs --api <your api host> --alias <a name for your instance>` prints the plan and cost; add `--yes` to run it. It sends small synthetic requests, reads each bill from the prompt log and reports whether it matches the tokenizer's rate and the cache rules above. See `phase0/probe/README.md` for credentials. It never records prompt text.
3. Send us or Ask Sage the resulting `summary.md`. It contains no key, tenant host or user identifiers.

If your instance disagrees with this report, that is the useful result. If your instance is private, do not post its results publicly: follow your own handling rules and channels, and keep the outputs out of any public repository (see the ignored paths in `.gitignore`).

## 9. Requests to Ask Sage

1. State which rate set is authoritative for billing. Make `get-models` `token_conversion_rate` match it, or document the markup.
2. Fix the billing of Claude through `/server/openai/v1/chat/completions`, or document that it is unbilled and unsupported.
3. Publish cache read and write, long-context and thinking rates through the API (or in the tokenizer's response).
4. Document, per endpoint and host, whether caching applies and what a client must send (in particular that Claude needs `cache_control`, and that Gemini and Bedrock GPT get no discount). The table in §1 is a starting point.
5. Confirm that `POST /server/tokenizer` with `convert_to_asksage` and the `total_tokens` field of `POST /user/get-user-logs` are supported ways to read billing, and document the undocumented parameters they rely on (`limit`, `before_id`, `completion_estimate`).
6. Say whether Gemini's discount will be passed through.
7. Say whether other instances (other regions, tiers or organizations) match these results, or point us at how to test them.

## Appendix A: terms

- **Token:** a chunk of text a model reads or writes, roughly three-quarters of a word.
- **Ask Sage token:** the unit an account is billed in. Each model converts model tokens into Ask Sage tokens with its own rate.
- **Prompt caching:** the provider remembers the start of a long prompt so a repeat is cheaper. Providers charge a little more to store it (the write) and much less to reuse it (the read).
- **Endpoint / flavor:** the API address and message format a client uses: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses, Gemini, or Ask Sage's own native query.
- **Prompt log:** the web app's per-request history of what each request cost.

## Appendix B: evidence in this repository

| What | Where |
|---|---|
| 117 measured requests (cloud session) | `research/live/test-tenant/billing/2026-09-25/measurements.json` |
| 37 measured requests (author's machine, independent) | `research/live/manual-run/billing/2026-09-26-0200-8b45f7/` |
| Rate-source comparison (ratios only) | `research/live/chat.asksage.ai/rates/2026-09-25/summary.md`, `summary.json` |
| Public model catalog with published rates | `research/live/chat.asksage.ai/catalog/2026-09-25/get-models-full.json` |
| Full write-up of the cloud session's findings | `research/rate-sources-investigation.md` |
| Tools | `phase0/probe/rate-sources.mjs`, `phase0/probe/billing-probe.mjs`, `phase0/probe/lib/billing.mjs` (with tests under `test/probe/`) |
