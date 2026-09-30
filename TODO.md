# TODO

The open-work list, **in priority order**. Each item is one line and points to where its detail lives (AGENTS.md §4). Delete an item when it is done and its evidence is recorded.

**Token budget.** The owner is conserving Ask Sage tokens until the monthly reset (early October 2026). Items marked 💲 spend tokens and need the owner's go-ahead each time (AGENTS.md §3). Everything else is free.

## 1. Now: free work
1. Merge `claude/phase2-m-and-caching` into `main`, labeled "built, not live-verified". Then delete the stale local branches (`claude/e4-multi-round` and the merged ones). DEFECTS P4.
4. Build the health report, H1 (PLAN §14): plain-language chat errors, error records in the ledger (DEFECTS D8) plus the failure recorder, and the Show Health Report command. This is required before the next build goes to the machine.
5. Fix the remaining Medium defects (D4, D5, D9–D12), then the Low ones.
6. Free live checks for Phase 1:
   - A workspace `.vscode/settings.json` setting `asksage.tenant: "custom"` and `asksage.host: "example.invalid"`, trusted and untrusted, must not redirect anything (REQUIREMENTS §2).
   - `force_models` can only be checked on an account whose organization sets it.
7. Add `scripts/check-docs.mjs` (zero-dependency, run by the test suite): relative links and paths in `*.md` resolve, `PLAN §N` and `DEFECTS Dn` references exist, TODO has no done items. It automates the mechanical half of an AGENTS.md §5.3 audit.
8. Wording pass over `research/` and `phase0/` docs under AGENTS.md §3: keep vendor ids where they are needed, and replace environment commentary with neutral wording.

## 2. After the reset: live (💲)
9. 💲 T12's remaining legs, cheap models only (`research/live/test-tenant/t12/README.md`). **This decides priorities** (DEFECTS P1, PLAN §1):
   - (a) the Custom Endpoint with `gpt-5.4-nano` on `responses`
   - (b) the same task and wording through the extension
   - (c) Claude on Messages through the Custom Endpoint, with an exact id (`google-claude-45-haiku`)
10. 💲 Phase 2's live acceptance (PLAN §9):
   - ≥80% cache reads from round 2 on R and on M
   - a 5+ round reasoning loop that includes a round of parallel tool calls
   - the estimate within ±10%
   - `asksage.checkCacheHealth` on one M and one R model
11. 💲 Confirm `asksage.interceptUtilityRequests` against real Copilot traffic (with `asksage.debug.logRequests` on): titles and progress calls are intercepted, and no real turn is. Only then consider making it the default.
12. 💲 Phase 3's live acceptance (PLAN §9).
13. 💲 The health report's self-test, H2 (PLAN §14.4), after item 10.
14. 💲 The FINDINGS "Still open" probe queue, in its order:
    - the `breadth` matrix
    - the Gemini loop on `streamGenerateContent`
    - the `partners` and `hosts` presets
    - later: Opus 5.5 preserved thinking, and `premium`
15. 💲 Bisect the Bedrock Gemma tool-schema rejection from a logged request (FINDINGS "Corrected", §2.2 CC row). Then decide per model: strip the keyword, or report `toolCalling: false`.
16. 💲 Find out what Copilot does when the model calls a tool Copilot has since removed (a tool Copilot removes stays in the pinned list, so the model can still call it).
17. 💲 Build the Check Cache Health parallel-tool-results case against a real conversation's tool list (PLAN §4.3).
18. 💲 The budget-mode experiment (PLAN §3.5).
19. 💲 Billing still unmeasured:
    - the Claude 1h cache after 60 minutes or more idle
    - whether Claude thinking is billed as output
    - long-context thresholds (T13)
    - Fable 5.1's read multiplier
    - images
20. 💲 Run `phase0/probe/billing-probe.mjs --yes` once (about 9k tokens) to validate it live.

## 3. Reports and questions to Ask Sage
21. Post the public caching and billing report (`research/reports/ask-sage-caching-and-billing.md`, commercial test account only) once the owner has read it. Commit `research/live/manual-run/` with it.
22. Report to Ask Sage support:
    - Claude through CC is billed 0.
    - Bedrock Nemotron on CC is routed to the Responses API.
    - Ask whether the tokenizer's `convert_to_asksage` is the supported way to read billed rates, and for cache and long-context rates by API.
    - Ask what `-ts` and `-sec` mean (`research/model-catalog-findings.md` §5).

## 4. Decide before the phase that owns it
23. Picker (Phase 4): whether to also intersect with the public `/server/openai/v1/models` and `/server/anthropic/v1/models` lists, and whether to hide models that fail on their flavor (DEFECTS D20).
24. Flavor choice (Phase 4): a learned CC↔R retry on "unsupported" errors, versus the static table. It only ever changes the dynamic default; a manual pin (PLAN §2.2) always wins.
25. N as a user-chosen fallback for models no provider-compatible endpoint serves (Phase 5). A `dryRun` setting that builds and logs a request without sending it.
26. Decide what research to import into the public repo. Recommended: the analysis docs from the earlier research folder, starting with `vscode-lm-provider-research.md`. Not the scraped rate table, raw bundles or Copilot source snapshots.
27. The open decisions in PLAN §12: the data-handling policy, and one user or shared.

## 5. Low priority and optional
28. Switch `api-probe.mjs`'s budget measurement (T1–T4, T19) from counter deltas to the prompt log. Its estimates already use tokenizer rates.
29. Why 1.139.0 asked for a sign-in in a fresh profile and 1.139.1 did not. If it is first-run state, the README must tell a new user what to do.
30. Explain the 78k `provideTokenCount` calls: the smoke report's "Token count calls" lines.
31. Optional: a local-only "save last prompt" command in the smoke extension, to read Copilot's system prompt and tools. Never committed.
32. Optional, for the owner only: measure a private instance with `research/handoff/private-instance-billing-run.md`. The results stay out of this repo.
