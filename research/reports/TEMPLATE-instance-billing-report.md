<!-- Template for a per-instance caching and billing report. Copy it to private/<name>/report.md for a restricted
     instance (never into a tracked path), fill in every <...>, delete these comments. Keep the structure of
     research/reports/ask-sage-caching-and-billing.md so reviewers can compare instances. -->

# Prompt caching and token billing on <instance alias>: what was measured

DRAFT: pending owner review. Handling markings to be set by the owner.

Measured <dates> on <one-line description of the account and instance, alias only>, in <N> billed requests (about <N> Ask Sage tokens). Not reviewed by Ask Sage.

## BLUF

<!-- 5 to 8 bullets, plain language, no jargon without a gloss. Each bullet is a finding a reader can act on. Lead with caching: what saves tokens, what does not, and what a client must do. Then: do published prices match bills; anything billed at zero or wrongly. End with scope: what was and was not tested. Then one line: what is asked of Ask Sage. -->

- <Caching finding for the main Claude path>
- <Caching finding for GPT>
- <Gemini / other hosts: discount or none>
- <Published rate versus billed rate>
- <Any request path billed at 0 or otherwise wrong>
- **Scope:** <instance, dates, number of models; what was not tested>.

## 1. Does caching save tokens? By path

<!-- One row per endpoint and model host that exists on this instance and was tested. Columns as in the commercial report. Mark a cell "not tested" rather than leaving it blank. Say where the result differs from the commercial report. -->

| Endpoint | Model and host | Must the client ask for caching? | Billed for cached input | Notes |
|---|---|---|---|---|
| | | | | |

## 2. How much does it save?

<!-- The agent-loop comparison (uncached versus cached totals and per-round costs), from billing-probe's `loop` experiment. -->

## 3. How long does a cache last?

<!-- Idle-time table per family. State which idle times were not measured. -->

## 4. Why people are confused (labeled: [M] measured, [F] fetched, [I] inference)

## 5. Published rates versus billed rates

<!-- The three sources, the comparison (counts of models within tolerance, ratio distribution, the largest deviations), a small worked-examples table. State which models have no published rate. -->

## 6. Anything billed at zero or otherwise wrong

## 7. What was not tested

## 8. Requests to Ask Sage

## Appendix A: terms

<!-- Copy from the commercial report. -->

## Appendix B: vetting

<!-- Required. For every number in this report: the results file it comes from (under private/) and the command or script that recomputes it. A reviewer must be able to check each claim without trusting the author. Also list: tool versions (git commit of this repository), Node version, run ids, and any deviation from the standard procedure. -->

| Claim (section) | Source file | How to recompute |
|---|---|---|
| | | |
