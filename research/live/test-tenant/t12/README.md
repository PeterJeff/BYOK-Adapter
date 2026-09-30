# T12: BYOK baseline (VS Code's built-in Custom Endpoint)

T12 runs one agent task through VS Code's built-in Custom Endpoint, configured as Ask Sage's VS Code page says (`research/sources/asksage-docs/2026-09-27/vscode-copilot-byok.md`, "Option D"). The resulting bills are the baseline the extension has to beat (PLAN §1, §9). Custom Endpoint traffic bypasses the extension's ledger, so bills come from the prompt log: `node phase0/probe/prompt-log.mjs --api api.asksage.ai --since <UTC time>` (free, numbers only, needs `ASKSAGE_API_KEY` and `ASKSAGE_EMAIL`).

## 2026-09-27 (`2026-09-27/`)

| Route | Model | Requests | Billed | Cache reads from round 2 |
|---|---|---|---|---|
| Custom Endpoint, Chat Completions | `gpt-4.1` | 4 | 3,706 | 85%, 98%, 99% (inferred) |
| Custom Endpoint, Responses, effort high | `gpt-6-astra` | 4 | **72,598** | **0% on every round** (inferred: each bill is within 2 tokens of full price) |
| This extension (Phase 1), R | `gpt-5.4-nano` | 7 + title | ~742 (estimate) | 84% measured; 96% without one tool-list change |

- **Responses through the Custom Endpoint cached nothing on GPT-6 Astra.** Each request was billed at the full prompt rate, although its input grew only by tool results. Chat Completions through the same Custom Endpoint (GPT-4.1) cached normally. Not yet known: whether this comes from the Custom Endpoint's Responses requests or from GPT-6 Astra itself (no Astra cache measurement exists yet). Next step, cheap: the same task via the Custom Endpoint with `gpt-5.4-nano` on `responses`, whose caching on R is already measured through the extension.
- **Copilot changes the tool list mid-conversation**, which breaks the cache on R in the extension (`002-*`, `cacheBreak`). Input for Phase 2's cache work.
- **Cost warning.** The Astra run cost about 36% of the test account's 200k monthly limit for one short task. Pick `gpt-5.4-nano` or another cheap model for reruns.
- The two runs used different task wording and models, so they are not yet a like-for-like comparison. Rerun `001`'s task and wording through the extension on `gpt-5.4-nano` (and, once the balance allows, `gpt-6-astra`).

## Standard task (from 2026-09-30)

The 2026-09-27 wording was not recorded, so every T12 run from here on uses this one, verbatim, in a fresh chat in agent mode with this repository open. It needs several rounds and one round of parallel reads:

> Read `package.json`, `README.md` and the first 40 lines of `src/extension.js`, all three in one step. Then search the repository for files that mention "ledger" and open the two smallest of them. Finish with one sentence per file you opened saying what it is for.

Custom Endpoint run: `gpt-5.4-nano` on `responses`. Extension run: `gpt-5.4-nano` through Ask Sage. Note the UTC start time of each, then read the bills with `node phase0/probe/prompt-log.mjs --api api.asksage.ai --since <UTC time>`.
