# TODO

Working list. The phase plan is `PLAN.md`; expectations vs. what is verified is `requirements/REQUIREMENTS.md`. Delete an item when it is done and its evidence is in `research/live/`.

## Open

- [ ] **Phase 0a, E1–E5, signed out** (this machine: VS Code 1.139, no Copilot sign-in). In progress 2026-09-25. Output: `research/live/<tenant-alias>/phase0a-report.md`. Steps: `phase0/smoke-extension/README.md`.
- [ ] **Measure which rate set is billed** (the author runs it; no key in cloud or dev sessions). A small run of T19 and T1 on a few model families is about 1.3k Ask Sage tokens by the probe's own pessimistic dry-run estimate (`api-probe.mjs --dry-run`). It needs an explicit go-ahead for the spend, and the exact command is to be written when that is given. Compare measured/estimated per model with both hypotheses: API multipliers vs. the web app's table (`research/handoff/cloud-rates-and-billing.md`).
- [ ] **Decide what research to import into the public repo.** Recommended: the analysis docs from the earlier `Ask Sage Model Provider/research` folder, with a caveat where they quote rates; `vscode-lm-provider-research.md` first (it documents that extension-provided models work signed out from VS Code 1.122). Not recommended: the scraped rate table, `evidence.zip`, raw bundles, Copilot source snapshots.
- [ ] **Cloud instance: rates investigation** (no spend): `research/handoff/cloud-rates-and-billing.md`. Merge its PR after review; update PLAN §3.1 and REQUIREMENTS §3 from its findings.
- [ ] Re-run T0's bad-auth check from a path that is not behind a credential-injecting proxy (`research/live/test-tenant/README.md`).
- [ ] Ask Ask Sage support: which rate set is billed; an endpoint for cache, thinking and long-context rates; what `-ts` and `-sec` mean (`research/model-catalog-findings.md` §5).
- [ ] Phase 0b remainder (T1–T9, T11, T15–T18, T20, about 13k tokens) run by the author, not as an unattended batch.
- [ ] Open decisions in `PLAN.md` §12 (data-handling policy, day-to-day tenant, terms for third-party clients, one user or shared).
- [ ] Phase 1 (`src/`) starts only after 0a passes and 0b findings exist.
