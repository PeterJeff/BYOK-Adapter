# TODO

The open-work list, **in priority order**. Each item is one line and points to where its detail lives (AGENTS.md §4). Delete an item when it is done and its evidence is recorded.

**Token budget.** The owner is conserving Ask Sage tokens until the monthly reset (early October 2026). Items marked 💲 spend tokens and need the owner's go-ahead each time (AGENTS.md §3). Everything else is free.

**Model priority.** Test and build for model families in this order: ChatGPT (R and CC), then Gemini, then Grok, then Nemotron and the other third-party models, then Claude. Claude is not excluded; its items come last within any group below.

## 0. Before the token reset (2026-10-01, about 24 hours away) 💲
The dev account has 29,081 tokens left, and unused tokens are lost at the reset. The owner has approved spending them on the items below, in this order and stopping at the budget. Dry-run every probe first (`phase0/probe/README.md`). Delete this section once the reset has passed.
- A. ChatGPT, in VS Code, cheap model only (`gpt-5.4-nano`), about 2–4k in all:
  - T12 (a): the Custom Endpoint on `responses`, then (b): the same task and wording through the extension (`research/live/test-tenant/t12/README.md`). Read the bills with `prompt-log.mjs`.
  - In the extension run, also cover the Phase 2 checks on R: a 5+ round loop that includes parallel tool calls, the cache-read share from round 2, the estimate against the bill (Reconcile command), and `asksage.checkCacheHealth` on the model.
  - With `asksage.debug.logRequests` on for a short chat, check that `asksage.interceptUtilityRequests` catches titles and progress calls and no real turn (item 11).
- B. Probes from the owner's terminal, one `--dry-run` first, each capped with `--max-spend` (recent runs bill a quarter to a third of the estimate). Stop when about 4k remains:
  - ChatGPT: `--matrix gpt-6-luna,gpt-4.1-mini --max-spend 6000`.
  - Gemini: `--matrix google-gemini-3.5-flash-gov,google-gemini-3.7-flash --max-spend 6000` (streaming tool loop, signatures).
  - Grok, then Nemotron: `--matrix grok-4-20-reasoning --max-spend 5000`, then `--matrix aws-bedrock-nemotron-super-3-120b-gov --max-spend 5000`.
  - Nothing on Claude before the reset.
- C. The machine's remaining tokens: nothing physical comes back, so the useful data needs the health report first (item 4). Then run item 10's checks there on a cheap GPT model, and describe the report aloud.

## 1. Now: free work
1. Merge `claude/phase2-m-and-caching` into `main`, labeled "built, not live-verified". Then delete the stale local branches (`claude/e4-multi-round` and the merged ones). DEFECTS P4.
4. Build the health report, H1 (PLAN §14): plain-language chat errors, error records in the ledger (DEFECTS D8) plus the failure recorder, and the Show Health Report command. This is required before the next build goes to the machine.
5. Fix the remaining Medium defects (D8–D11 first; D4, D5 and D12 concern Claude thinking and come last), then the Low ones.
6. Free live checks for Phase 1:
   - A workspace `.vscode/settings.json` setting `asksage.tenant: "custom"` and `asksage.host: "example.invalid"`, trusted and untrusted, must not redirect anything (REQUIREMENTS §2).
   - `force_models` can only be checked on an account whose organization sets it.
7. Add `scripts/check-docs.mjs` (zero-dependency, run by the test suite): relative links and paths in `*.md` resolve, `PLAN §N` and `DEFECTS Dn` references exist, TODO has no done items. It automates the mechanical half of an AGENTS.md §5.3 audit.
8. Wording pass over `research/` and `phase0/` docs under AGENTS.md §3: keep vendor ids where they are needed, and replace environment commentary with neutral wording.

## 2. After the reset: live (💲)
9. 💲 T12's remaining legs, cheap models only (`research/live/test-tenant/t12/README.md`). **This decides priorities** (DEFECTS P1, PLAN §1):
   - (a) the Custom Endpoint with `gpt-5.4-nano` on `responses`
   - (b) the same task and wording through the extension
   - (c) last, after every non-Claude item: Claude on Messages through the Custom Endpoint, with an exact id (`google-claude-45-haiku`)
10. 💲 Phase 2's live acceptance (PLAN §9):
   - ≥80% cache reads from round 2 on R, then on M (M last)
   - a 5+ round reasoning loop that includes a round of parallel tool calls, on R, then on M
   - the estimate within ±10%
   - `asksage.checkCacheHealth` on one R model, then one M model
11. 💲 Confirm `asksage.interceptUtilityRequests` against real Copilot traffic (with `asksage.debug.logRequests` on): titles and progress calls are intercepted, and no real turn is. Only then consider making it the default.
12. 💲 Phase 3's live acceptance (PLAN §9).
13. 💲 The health report's self-test, H2 (PLAN §14.4), after item 10.
14. 💲 The FINDINGS "Still open" probe queue, in its order:
    - the `breadth` matrix (GPT, then Gemini, then the Bedrock partner models)
    - the Gemini loop on `streamGenerateContent`
    - the `partners` preset (Grok first), then `hosts`
    - last: Opus 5.5 preserved thinking, and `premium`
15. 💲 Bisect the Bedrock Gemma tool-schema rejection from a logged request (FINDINGS "Corrected", §2.2 CC row). Then decide per model: strip the keyword, or report `toolCalling: false`.
16. 💲 Find out what Copilot does when the model calls a tool Copilot has since removed (a tool Copilot removes stays in the pinned list, so the model can still call it).
17. 💲 Build the Check Cache Health parallel-tool-results case against a real conversation's tool list (PLAN §4.3).
18. 💲 The budget-mode experiment (PLAN §3.5).
19. 💲 Billing still unmeasured:
    - long-context thresholds (T13)
    - images
    - last, Claude: the 1h cache after 60 minutes or more idle, whether thinking is billed as output, and Fable 5.1's read multiplier
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
