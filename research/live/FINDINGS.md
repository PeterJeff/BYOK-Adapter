# Phase 0b findings (test tenant)

The Phase 0b exit document (PLAN §9). It confirms or corrects the plan's defaults from recorded fixtures on the public test tenant (`api.asksage.ai`), the development reference (PLAN §9: no data comes back from other environments, so tenant differences are handled at runtime).

**Sources.**
- **Probe run** `research/live/manual-run/probe/2026-09-26-0402-c5ced6/` (`api-probe.mjs`, all default tests, run by the author 2026-09-26; 8,550 Ask Sage tokens by the used counter). Fixture paths below are relative to that folder. Models: `google-claude-45-haiku` (served `claude-haiku-4-5-20251001`), `gpt-5.4-nano`, `google-gemini-3.1-flash-lite-gov` (served `gemini-3.1-flash-lite`).
- **Flagship follow-ups** `research/live/manual-run-01/probe/` (2026-09-26, about 30k Ask Sage tokens): T6 and T17 on `gpt-6-sol` (`0511-7d58e1`), T8 and T9 on `gpt-5.6-sol` (`0513-742522`), T15 and T16 on `google-claude-opus-5-5` (`0516-f56b8c`).
- **Matrix runs** `research/live/manual-run-01/probe/` (2026-09-26, T22): `google-claude-sonnet-5` on M and `gpt-6-sol` on R (`0537-0d5ccf`, 2,763 tokens against an estimate of 11,786), `google-gemini-3.1-flash-lite-com` and `google-gemini-3.7-flash` on G and CC (`0543-35341f`, 1,197 tokens).
- **Billing measurements** 2026-09-25: `research/rate-sources-investigation.md` (117 requests reconciled against the prompt log) and `research/live/manual-run/billing/`.

Bills below are in Ask Sage tokens from the used counter, which moved within 2 seconds and resolved single requests (T19). Ratios are taken against a same-size uncached control in the same run, so they do not depend on the rate scale.

## Confirmed

| Plan | Finding | Evidence |
|---|---|---|
| §2.1 Claude cache pricing | Write 1.25× (474 vs 380 uncached for a 5.2k prefix), read about 0.1× (42), 1-hour write 2× (751). Mixed 1h + 5m write billed as the sum (1,224). | `T1/`, `T15/`; matches `rate-sources-investigation.md` §3 |
| §2.1 TTL | `ttl: "1h"` accepted with and without the beta header. After 6 minutes idle the 1h entry was read and the 5m entry had to be rewritten. | `T15/` |
| §2.1 OpenAI cache | CC and R both report `cached_tokens` on a repeat (4,864 of 5,185) and bill the read at a discount (15 vs 77). | `T2/`, `T3/` |
| §2.2 GPT-5.x default R | R caches and discounts like CC, so R stays the default for GPT-5.4+. `store:false`, `prompt_cache_key` and `prompt_cache_retention` are echoed back (also on GPT-6 Sol). | `T3/`, `T17/`, `manual-run-01/.../0511-7d58e1/T17/` |
| §2.1 on Opus 5.5 | 1-hour write 2.0× (3,581 for 6,237 tokens), mixed 1h + 5m write billed as the sum (5,832), the 1h entry survives 6 minutes and the 5m entry does not. | `manual-run-01/.../0516-f56b8c/T15/` |
| §3.2 CC/R normalization | CC `prompt_tokens` and R `input_tokens` include `cached_tokens` (321 + 4,864 = 5,185; 312 + 4,864 = 5,176). M `input_tokens` excludes cache reads and writes (13 with a 5,244 write). | `T2/`, `T3/`, `T1/` |
| §3.2 Claude through CC | Answers with Anthropic-shaped usage (`input_tokens`, `cache_*`) inside a CC response, and honors `cache_control`. The normalizer must decide by the fields present, not by the flavor. (Billing: 0 on 2026-09-25, an Ask Sage bug; still never route Claude through CC.) | `T2/027-*`, `T2/028-*` |
| §3.3 budget endpoints | `validate_token_with_full_user` works with an API-key JWT (`max_tokens`, `force_models`, `custom_intro_prompt` present). Counters are integers. The raw API key works as `x-access-tokens` but not as a bearer token. Access tokens are HS512 JWTs valid 24 hours. | `T0/` |
| §3.6 T19 | The counter moves within about 2 s of the response and resolves a single tiny request (Δ4 for an estimate of 1.9: the known +1 to +5 rounding). Per-request reconciliation is possible; batch mode is not needed. | `T19/` |
| §4.3 T5 injection | No server-side injection on M, CC, R or G: a one-line prompt is 7 to 14 input tokens, and `count_tokens` equals billed input on M. N injects about 780 tokens (820 prompt tokens with the default persona, 40 with a system-prompt override). | `T5/` |
| §5 Claude signed thinking | A round 2 with the thinking block (596-character signature) succeeds; a tampered signature is rejected by Anthropic, so signatures are verified end to end through Ask Sage. Stripping thinking is **accepted** here (not enforced for Haiku 4.5), which the plan must not rely on. | `T7/050-*` to `053-*` |
| §3.5 output caps | Every flavor honors an explicit cap (`max_tokens`, `max_completion_tokens`, `max_output_tokens`, `maxOutputTokens`) with the native stop reason. CC with no cap produced 2,720 tokens. | `T8/` |
| §8 T20 embeddings | `text-embedding-3-small` (not in the catalog) works on the OpenAI embeddings path, 1,536 dimensions, and is charged to the **training** balance (teach counter +11, inference counter 0). | `T20/` |
| §2.1 on Sonnet 5 and GPT-6 Sol | Sonnet 5 on M: read 0.1× (150 for 6,299 cached), write 1.25× (1,694). GPT-6 Sol on R: read 0.1×, and it reports `cache_write_tokens`, billed at 1.25× (498 for 2,191 written). So Opus 5.5's 0.05× read is specific to that model. | `manual-run-01/.../0537-0d5ccf/T22/` |
| §2.1 Gemini cache | No discount through G: `gemini-3.7-flash` had no implicit hit; the Flash Lite `-com` request (served as 2.5 Flash, below) hit 5,092 of 5,244 tokens and was billed 104 all three times. | `manual-run-01/.../0543-35341f/T22/` |

## Corrected

| Plan | Was | Now | Evidence |
|---|---|---|---|
| §3.2 M thinking | "`output_tokens` includes thinking; no separate thinking count" | Vertex Claude reports `output_tokens_details.thinking_tokens` (51 of 107 output tokens). Use it when present; fall back to `thinkingUnknown` otherwise. The probe's normalizer now does this. | `T7/050-m-round1.json` |
| §3.5 cancellation (T9) | Unknown; estimate from input plus streamed output | A cancelled stream is billed for more output than had arrived when the client stopped reading, but far less than the cap (M: 43 and 51 against a full-cap estimate of 826; CC: 6 on GPT-5.4 nano, 136 on GPT-5.6 Sol against 85 streamed and 7,436 full). The model runs on briefly upstream. The ledger should take the exact bill from the prompt log and mark cancelled records as estimated until matched. | `T9/` |
| §4.1 lookback | A lookup only checks about 20 blocks back, so a round adding more than 20 blocks misses | A request whose last breakpoint was 50 blocks past the cached one still read the whole cached prefix (5,795 of 5,795). The window did not bite on Vertex Haiku 4.5, nor on Opus 5.5 (6,633 of 6,633, `manual-run-01/.../0516-f56b8c/T16/`). Keep the intermediate breakpoint as cheap insurance; it is no longer a correctness requirement. | `T16/106-*` |
| §2.2 Gemini | CC by default if thought signatures survive the CC shim, else G | **CC is not available**: every Gemini id tried (`3.1-flash-lite-gov`, `3.1-flash-lite-com`, `3.7-flash`) is "Unsupported model" on CC. **G works for tool loops with Google's placeholder signature.** Ask Sage strips thought parts, `thoughtsTokenCount` and `thoughtSignature` from G responses (the model still thinks: `totalTokenCount` exceeds prompt + candidates by 20 to 49 tokens). Sending round 1's function call back as returned is rejected (HTTP 400) on Gemini 3 (`3.1-flash-lite-gov`, `3.7-flash`); sending it with `thoughtSignature: "skip_thought_signature_validator"` succeeds on `3.7-flash`. The G converter must add that placeholder to every function-call part in history that lacks a signature. Google documents that this skips validation, so the model does not see its earlier reasoning: acceptable for agent mode, with that caveat. | `T18/`, `manual-run-01/.../0543-35341f/T22/` |
| §2.1 Gemini cache | The implicit cache hits and is billed in full | This run saw no implicit hit at all on `gemini-3.1-flash-lite` (`cachedContentTokenCount` 0 on three identical 5.2k requests). Same conclusion: no cache benefit through G. | `T4/` |
| §2.1 Claude read multiplier | 0.1× on every Claude model, a constant in code | **Opus 5.5 reads at about 0.05×**: after a 5m rewrite of 6,234 tokens at 1.25×, the 6,276 tokens read cost about 95 of 2,333 (0.053× at the billed rate implied by its 1-hour write). This matches the web app's table (0.05×), so its 0.025× for Fable 5.1 is probably right too (unmeasured). The rule is per model, not per host: `billing.mjs` `cacheRule` now carries Opus 5.5 at 0.05× and Fable 5.1 at 0.025×. | `manual-run-01/.../0516-f56b8c/T15/` (D) |
| §2.2 CC as GPT-6 fallback | "CC; it drops reasoning between tool rounds" | **GPT-6 Sol rejects function tools on CC whenever reasoning is on**, and reasoning is on by default: a plain tools request with no `reasoning_effort` failed with "Function tools with reasoning_effort are not supported for gpt-6-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'." So for agent mode R is the only path with reasoning on GPT-6 Sol; CC works only with `reasoning_effort: "none"`. | `manual-run-01/.../0511-7d58e1/T6/` |
| §4.1 / §5 Claude thinking parameter | `thinking: {type: "enabled", budget_tokens}` | **Sonnet 5 rejects it**: "\"thinking.type.enabled\" is not supported for this model. Use \"thinking.type.adaptive\" and \"output_config.effort\"". The M converter needs a per-model thinking shape: `enabled` + budget for older models, `{type: "adaptive"}` + `output_config: {effort}` for newer ones. Opus 5.5 reports thinking tokens with no thinking parameter at all (T16), so it probably thinks adaptively by default. Signed-thinking round trips on Sonnet 5 are not yet tested. | `manual-run-01/.../0537-0d5ccf/T22/022-*` |
| §3.5 served model | `resolvedModel` different from the requested id is usually an alias; compare families | **Real substitution happens**: `google-gemini-3.1-flash-lite-com` was served as `gemini-2.5-flash` on every request, and **billed at 2.5 Flash's rate**: request A's bill implies a prompt rate of 0.0195 (2.5 Flash's catalog rate × 1.3) where the tokenizer gives 0.0160 for the requested id. The `-gov` Flash Lite was served correctly. The cache-health alarm must flag a different model (version or tier), not only a different string, and cost estimates for a substituted request are wrong by the rate difference. The probe's `sameModel` (`lib/matrix.mjs`) is the rule to reuse. | `manual-run-01/.../0543-35341f/T22/020-*` |
| §3.2 Gemini thinking | `candidatesTokenCount` excludes `thoughtsTokenCount` (separate) | `thoughtsTokenCount` is absent through Ask Sage; hidden thinking = `totalTokenCount − promptTokenCount − candidatesTokenCount`. It is **not billed** (3.7 Flash: 20 hidden tokens; the bill of 285 fits input and visible output only). | `manual-run-01/.../0543-35341f/T22/028-*` |

## New rules for the converters and the error normalizer

- **Errors (T0, T10).**
  - Bad or expired auth: **HTTP 200** with Ask Sage's envelope `{"status":400,"response":"Token is invalid ..."}` on every flavor, not the flavor's own error shape and not 401.
  - Unknown model: HTTP 400 in the flavor's native shape (Anthropic `invalid_request_error`, OpenAI `invalid_request_error`, Gemini `{error:{code:400}}`).
  - In a stream: HTTP 200 `text/event-stream` with the error as an event.
  - M, malformed request: **HTTP 502 `api_error` "Provider request failed"**, with no detail. This happened for a missing `messages`, a missing `max_tokens` and an unknown top-level parameter. The M converter must send only known fields, always send `max_tokens`, and map this error to "the request was rejected upstream (check the request shape)".
  - Over-limit caps give a clear Anthropic message with the real limit (`max_tokens: 136000 > 64000`).
- **Unknown parameters (T17).** CC and R silently accept or strip them; M fails with the 502 above.
- **GPT-5 on CC (T6).** `max_tokens` is rejected; send `max_completion_tokens`. `reasoning_effort` and `temperature` are accepted. GPT-6 Sol: tools need `reasoning_effort: "none"` on CC (above).
- **Output caps on reasoning GPTs (T8, GPT-5.6 Sol).** A 32-token cap was spent entirely on reasoning: stop `length` (CC) or `incomplete` (R) with no visible output. Reasoning counts against `max_completion_tokens`/`max_output_tokens`, so the cap must leave room for it, and "stopped at the cap with nothing visible" needs its own message. With no cap, CC wrote 2,395 tokens for a short prompt.
- **Tools (T11).** CC rejects more than 128 tools; M accepted 129. Schemas: M and CC reject a schema with no `type` (G accepts it). **G rejects `$schema`/`additionalProperties` and `type: ["string","null"]`**, so the G converter must strip or rewrite them. Empty-object, `anyOf`, `format`/`default` and arrays without `items` pass everywhere.
- **Served model names (T10, all).** Requested and served ids differ as aliases (`google-claude-45-haiku` → `claude-haiku-4-5-20251001`; `gpt-5.4-nano` → `gpt-5.4-nano-2026-03-17` on CC but undated on R). The cache-health alarm must compare model families, not raw strings, or it fires on every request.

## Still open

| Question | Next step | Cost |
|---|---|---|
| Reasoning state on flagship models (T7, T22) | Still untested: gpt-5.4-nano and GPT-6 Sol spent 0 reasoning tokens on the simple weather prompt, so they returned no encrypted reasoning; Sonnet 5's run fell back to no thinking. T7 R and T22 now ask a question that needs a little reasoning (is 391 prime? It is 17 × 23, so the answer is Berlin) and T22 retries Claude with adaptive thinking. Rerun `--matrix google-claude-sonnet-5,gpt-6-sol@R` (about 3k tokens actual). | small |
| Gemini tool loops (T18) | Answered for Gemini 3.7 Flash (placeholder signature works, above). Optional: confirm on Gemini 3.1 Pro or 3.5 Flash before offering them for agent mode. | small |
| Long-context pricing (T13) | Opt-in, expensive. Needed only before long-context models are offered. | large |
| BYOK baseline (T12) | Manual, in Phase 2. | – |
| Dataset search (T21) | Opt-in with `--dataset`; Phase 5. | small |
| Cache TTL beyond 60 minutes, Fable 5.1 read multiplier | From `TODO.md`; not needed for Phase 1. | small |

**Model coverage gap.** Every test above ran on the cheapest model per family (Haiku 4.5, GPT-5.4 nano, Gemini 3.1 Flash Lite Gov). Flagship GPT caching, Claude flagships (Sonnet 5, Opus 5.5), other hosts and partner models are covered by billing measurements only (`rate-sources-investigation.md`), not by cache and reasoning loops. `api-probe.mjs --matrix` (T22) fills this; see `phase0/probe/README.md`, "Model coverage".

## Probe cost accuracy

The dry run's "pessimistic" estimate priced requests at the catalog rate, which is below the bill on most models (PLAN §3.1). The Opus 5.5 run was estimated at 17,992 and cost 24,284. The probe now prices at the tokenizer's billed rate when a key and email are set (free calls), else the catalog rate × 1.3, both in the dry run and in the spend cap.

## Effect on Phase 1

Phase 1 (M and CC, ledger, spend cap) has what it needs. The M and CC request shapes, usage normalization (including M thinking tokens and Claude-shaped usage in CC responses), error normalization, output caps and per-request reconciliation are all confirmed or corrected above. Gemini and R reasoning are Phase 4 and 2 concerns and are the only open items that touch the default flavor table.
