# Handoff: rates and billing investigation (for the Claude Code cloud instance)

**Status 2026-09-25: done, with live measurement (the author approved spending on the test tenant).** Results: `research/rate-sources-investigation.md`. The assumptions below about what the cloud session could not do were superseded.

Written for: a Claude Opus 5.5 instance in Claude Code on the web, starting cold on this public repo. It has no access to the author's machine, no Ask Sage key of its own (check, don't assume; see `CLAUDE.md` "Where Phase 0b's paid probes may run"), and no permission to spend Ask Sage tokens.

Read first: `CLAUDE.md`, then `PLAN.md` §2.1 and §3.1, then `requirements/REQUIREMENTS.md` §3 (the two rows dated 2026-09-25 about rates and cache multipliers), then `research/model-catalog-findings.md` §4.

## The question

The extension must estimate Ask Sage token cost per request. Ask Sage exposes rate data in two places and they disagree. Which one is billed, and can the extension avoid a hand-maintained table?

- **API:** `POST /server/get-models?format=full` returns `token_conversion_rate: {prompt, completion}` per model. It is a multiplier: `Ask Sage tokens = model tokens × rate` (the public spec, `research/sources/asksage-docs/2026-09-25/server-api-spec.json`, says "Multipliers applied to raw provider tokens for billing"). Recorded in `research/live/chat.asksage.ai/catalog/2026-09-25/get-models-full.json`.
- **Web app:** the chat app's JavaScript bundle (`https://chat.<instance>/assets/index-*.js`, public, no login) hardcodes a rate table, `const MSa`, rendered in its Updates → Token Conversion dialog. Its unit is the inverse: model tokens per 1 Ask Sage token, so `Ask Sage tokens = model tokens / rate`. It also carries what the API lacks: cache read/write rates, long-context thresholds and rates. A second, older hardcoded list in the same bundle (`xh`, field `conversion`) is called "legacy" below.

The author's decision (2026-09-25): **do not maintain a rate table by hand; use the API.** The plan now says that (PLAN §3.1), with a per-model calibration factor learned from measured billing. What is unsettled is whether the API multipliers are what is billed.

## What is known

1. **The two sources disagree on every model present in both.** Compared on 2026-09-25 (API fixture above vs. a local snapshot of the web app's table fetched 2026-09-22 from bundle `index-B5zBThzY.js`, 104 models): 91 comparable, 0 within 2%. Writing `r = api_multiplier × table_prompt_rate` (that is, API divided by the table's own multiplier, `1/table_rate`):
   - 71 models: `r = 0.769` on both prompt and completion (0.769 = 1/1.3). So the table charges 1.3× what the API says, on those models.
   - GPT-5.4 and 5.4-sec: 1.538 (prompt) and 1.538 (completion). GPT-5.6 (`sol`, `terra`, `luna`), `gpt-5.4-gov`, `gpt-6-astra`: 1.538 and about 1.154. `claude-sonnet-4-6-com` and `google-claude-46-sonnet`: 1.538 and 1.2. `claude-opus-4-7-com`: 1.538 and 1.19. `aws-bedrock-gpt-5-6-*-gov`: 2.031 and 1.523. `gpt-5.6-*-gov`: 1.923 and about 1.44. `aws-bedrock-claude-45-sonnet-gov`: 0.277 and 0.466.
   - Image models: the API has no completion rate; the table does.
   - So there is one systematic factor (1.3) on most models plus model-specific changes on the newest ones (GPT-5.x, Sonnet/Opus 4.6+ on some hosts).
2. **The API equals the "legacy" list for only 31 of 85 models** (including `google-claude-45-haiku`), so the API is not simply the legacy list. `google-claude-46-opus` through `google-claude-opus-5` are half the legacy prompt multiplier and two-thirds of the legacy completion multiplier in the API (0.275/1.375 vs 0.55/2.06), and the six `-ts` models differ a lot.
3. **One billing measurement.** T19 in `research/live/test-tenant/probe/2026-09-25-1534-b69656/T19/` (test tenant, Messages endpoint, model `google-claude-45-haiku`, no caching involved):
   - Request 019: 5,273 input tokens, 4 output tokens. The used-tokens counter moved **381** (`summary.md`, "usedDelta 381").
   - API multipliers (prompt 0.055, completion 0.275): 5,273 × 0.055 + 4 × 0.275 = **291.1**. Billed is 1.31× that.
   - Web app table (prompt 13.99, completion 2.797 model tokens per Ask Sage token): 5,273 / 13.99 + 4 / 2.797 = **378.3**. Within 0.7%.
   - Legacy list (18.18, 3.636): 291.1, the same as the API for this model.
   - Request 020: 14 input, 4 output, counter moved **4**. API 1.9, table 2.4. Integer counters, so small requests are unreliable, but 4 is above both.
4. **Cache multipliers** (read 0.1×, 5-minute write 1.25×, 1-hour write 2× of the model's own prompt price) exist only in the web app table (26 of 104 rows: 15 Claude, 10 OpenAI GPT-5.4+, 1 xAI read-only; Gemini none; `aws-bedrock-claude-fable-5-1-gov` is 0.025× read; changelog 2026-09-02). They were never checked against billing. They are Anthropic's published ratios; applying them to OpenAI, especially the write multipliers, looks like an artifact of the table.
5. **Counter behavior (T19):** the counter first moves about 2 s after a request; it is an integer; the org pool and any other window's traffic pollute it.

The web app's table (2026-09-22) is not in this repo (it has not been approved for publication, see "Constraints"). Two facts you can rely on without it: the numbers above, and the fact that you can fetch the current bundle yourself.

## What to research (no Ask Sage spend)

These need only public, unauthenticated fetches (the catalog audit already does that from cloud sessions; run `node phase0/probe/catalog-audit.mjs` per `phase0/probe/README.md`, and set `NODE_USE_ENV_PROXY=1` because Node's `fetch` ignores `HTTPS_PROXY` otherwise) and reading docs.

1. **Re-extract the web app's table from the current bundles** (`chat.asksage.ai`, now `index-DcmfUYyN.js`; `chat.asksage.com`, `index-1SBSfNgZ.js`; each instance's `vars.js`). Has the table changed since 2026-09-22? Does the API now match it, on either host? Is the 0.769 factor still there? Write the extractor as a dependency-free `.mjs` with unit tests (against a small synthetic bundle snippet, not the real one), under `phase0/probe/lib/`.
2. **Find where the 1.3× comes from.** Search the bundle, `vars.js` and the docs for a global multiplier, markup, margin, surcharge or "tokens per dollar" constant near the rate table or the token-count display (try 1.3, 0.769, `multiplier`, `markup`, `surcharge`, `fedramp`, `gov`). Check whether it differs per instance (`chat.asksage.ai` vs `.com`) or per model host.
3. **Check the docs and changelog for rate changes** around 2026-09-22 to 09-25 and for statements about which numbers are billed. Sources: `research/sources/asksage-docs/2026-09-25/` (only 4 doc pages and the two API specs are committed; fetch others from `https://docs.asksage.ai` if reachable), the changelog entries embedded in the bundle, and the API guides' token-accounting sections.
4. **Verify the per-family cache rule against public provider docs** (Anthropic, OpenAI, Google) and against what Ask Sage says. In particular: does OpenAI charge for cache writes? Does Gemini have implicit caching discounts, and are they passed through? Report what the docs say and what remains unknown; do not assert what Ask Sage bills.
5. **Design check.** Given the numbers above, critique PLAN §3.1's approach (API multipliers, per-model calibration factor `k` from the ledger's measured/estimated ratio, cache multipliers as per-family constants). Is a single global factor plausible? What is the smallest set of measurements that separates "API multipliers are wrong by a constant 1.3×" from "per-model differences"? Write the proposed measurement plan (models, request shapes, token counts, expected Ask Sage token cost per hypothesis) but **do not run it**.

## Constraints

- **Public repository.** Nothing unredacted: no key, token, email, user/org id, or tenant host other than the public `api.asksage.ai`/`chat.asksage.*`. Raw extracts go under `research/live/**/raw/` (gitignored). Do **not** commit the extracted web app rate table itself (or a translation of it into another format) without the author's approval; commit derived summaries (ratios, counts, which models differ) and the extractor code.
- **No Ask Sage spend.** Do not run T1–T9, T11, T13, T15–T18, T20, and do not chunk them to get past the Claude Code safety classifier (see `CLAUDE.md`). If a measurement is needed, write the plan and stop; the author runs it.
- **Repo rules** (`CLAUDE.md`): plain JavaScript, no npm, no dependencies, nothing copied from `asksageclient`, tests with `node scripts/run-tests.mjs`. Update `requirements/REQUIREMENTS.md` in the same commit that changes a status.
- **Voice of the deliverable:** put findings in a new file under `research/` (for example `research/rate-sources-investigation.md`), open a pull request, and say in it what is fact (fetched, computed) versus inference. Correct PLAN §3.1 only where your findings contradict it, and keep the author's decision (no hand-maintained table) unless the evidence forces otherwise, in which case say so plainly rather than quietly changing course.
