# TODO

Working list. The phase plan is `PLAN.md`; expectations vs. what is verified is `requirements/REQUIREMENTS.md`. Delete an item when it is done and its evidence is in `research/live/`.

## Open

- [ ] **Phase 0a, folder install on the dev machine** (Command Palette → Developer: Install Extension from Location... → `phase0/smoke-extension`; no packaging): makes E3 real and shows whether `LanguageModelThinkingPart` exists outside the development host. `smoke:loop 3` passed (3 rounds, signatures up to 64 KB intact: `research/live/test-tenant/phase0a-e4-loop.md`); from the folder install, run `smoke:loop 6 read_file {json}` with a real absolute path and save the report. Steps: `phase0/smoke-extension/README.md`.
- [ ] **Phase 0a on the target machine** after it works on the dev machine: pull the repo, install from the folder (no `.vsix` until distribution makes sense), run E1–E5 (its VS Code version, proxy/TLS for E5, any org policy). Before that, check any applicable software or extension policy for installing an unpublished extension. Save as `research/live/<tenant-alias>/phase0a-report.md`; dev-machine results are in `research/live/test-tenant/phase0a-report.md`.
- [ ] Find out why 1.139.0 asked for a sign-in in a fresh profile and 1.139.1 did not (version, or first-run state), so the target machine's version is known to be fine.
- [ ] Explain the 78k `provideTokenCount` calls: after the reload, read the report's "Token count calls" lines (calls before/during each request, repeat percentage). Decides the size and shape of the count cache.
- [ ] Phase 1 design inputs from 0a: cheap cached `provideTokenCount`, `_conversationId`/`_enableThinking` from `modelOptions`, side cache keyed by tool-call id.
- [ ] Optional: an opt-in, local-only "save last prompt" command in the smoke extension, to read what Copilot's system prompt and tool definitions actually say (never committed). Feeds the question of whether the provider should trim or replace them.
- [ ] **Measure a private instance** with `research/handoff/private-instance-billing-run.md` (free steps first; the owner approves any spend). Results stay out of this repo: `--alias private-<name>` or `--out private/...` (both gitignored); the owner decides review and channel. Template: `research/reports/TEMPLATE-instance-billing-report.md`.
- [ ] **Post the public caching and billing report to Ask Sage** (`research/reports/ask-sage-caching-and-billing.md`, commercial test account only) after the owner has read it; commit `research/live/manual-run/` (independent run, checked: no keys, ids or hosts) with it.
- [ ] **Decide what research to import into the public repo.** Recommended: the analysis docs from the earlier `Ask Sage Model Provider/research` folder, with a caveat where they quote rates; `vscode-lm-provider-research.md` first (it documents that extension-provided models work signed out from VS Code 1.122). Not recommended: the scraped rate table, `evidence.zip`, raw bundles, Copilot source snapshots.
- [ ] **Review the rates/billing findings** (`research/rate-sources-investigation.md`, branch `claude/rates-billing-findings`); PLAN §2, §2.1, §3.1, §3.5, §3.6 and REQUIREMENTS §3 are already updated from it.
- [ ] **Report to Ask Sage support:** Claude through `/server/openai/v1/chat/completions` is logged and billed 0 (every shape tried, 2026-09-25); ask whether `/server/tokenizer` `convert_to_asksage` is the supported way to read billed rates, and for cache/long-context rates by API.
- [ ] **Run `phase0/probe/billing-probe.mjs --yes` once on the test tenant** (about 9k tokens) to validate the committed tool live; its first live run from the cloud session was blocked by Claude Code's auto-mode classifier. Then on the day-to-day tenant (Phase 0c) with `rate-sources.mjs` first (free).
- [ ] Billing still unmeasured: Claude 1h cache after ≥60 min idle; Claude thinking (billed as output?); long-context thresholds (T13); Fable 5.1 / Opus 5.5 cache-read multipliers (table: 0.025× / 0.05×); images; embeddings (T20).
- [ ] Switch `api-probe.mjs` budget measurement (T1–T4, T19) from counter deltas to the prompt log (`lib/billing.mjs`), and its estimates from `get-models` rates to the tokenizer's.
- [ ] Re-run T0's bad-auth check from a path that is not behind a credential-injecting proxy (`research/live/test-tenant/README.md`).
- [ ] Ask Ask Sage support: which rate set is billed; an endpoint for cache, thinking and long-context rates; what `-ts` and `-sec` mean (`research/model-catalog-findings.md` §5).
- [ ] Phase 0b remainder (T1–T9, T11, T15–T18, T20, about 13k tokens) run by the author, not as an unattended batch.
- [ ] Open decisions in `PLAN.md` §12 (data-handling policy, day-to-day tenant, terms for third-party clients, one user or shared).
- [ ] Phase 1 (`src/`) starts only after 0a passes and 0b findings exist.
