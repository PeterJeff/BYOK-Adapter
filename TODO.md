# TODO

Working list. The phase plan is `PLAN.md`; expectations vs. what is verified is `requirements/REQUIREMENTS.md`. Delete an item when it is done and its evidence is in `research/live/`.

## Open

- [ ] **Phase 0a, E1–E5, signed out** (this machine: VS Code 1.139, no Copilot sign-in). In progress 2026-09-25. Output: `research/live/<tenant-alias>/phase0a-report.md`. Steps: `phase0/smoke-extension/README.md`.
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
