# Handoff: measure caching and billing on a private instance

Written for: a Claude Code instance on a machine that can reach a private Ask Sage instance, cold, with this public repository pulled. It may have no internet access beyond that instance. The project owner (the human) is your only channel.

Read first: `CLAUDE.md`, then `research/reports/ask-sage-caching-and-billing.md` (what was found on a commercial test account, and how), then `research/rate-sources-investigation.md` (the detail behind it).

## The job

The public report measured prompt caching, rates and billing on one account. The owner needs the same numbers for a different instance whose results cannot be published. Run the same measurements there and write the same report with that instance's data, for the owner to have reviewed and to send through their own channel.

## Data handling: hard rules (read twice)

1. **Nothing measured on the private instance is public.** Do not commit, push, paste, upload, or open a pull request or issue containing its outputs, the report, model lists, counts, host names or your findings. The public repo is a code-and-method repo only.
2. **Keep outputs out of tracked paths.** Always run the tools with `--alias private-<short name>`: their default output directory (`research/live/<alias>/...`) then falls under `research/live/private-*/`, which is gitignored. You may instead use `--out private/<...>` (also ignored). Write the report and all notes under `private/`. Before any `git` command that stages something, run `git status`; never `git add -A` or `git add .`; never create branches or PRs from this session's data. The owner commits code changes (tools, tests) if any; they must contain no instance data.
3. **The owner decides handling.** Do not invent handling markings, release channels or reviewers. Label the report `DRAFT: pending owner review; handling to be set by the owner`.
4. **No sensitive content in outputs.** The tools record no prompt text, key or token, and replace hosts with the alias. Verify that anyway before handing anything over: search your outputs for the instance's host names, user or organization identifiers, emails and key-like strings. Keep the report free of anything about who the owner is, where they work or why they are asking.
5. **Synthetic prompts only. Use only models the owner has cleared for this instance.** Catalogs can list models that are not approved for the owner's data-handling rules (the catalog's flags and undocumented name suffixes; see `research/model-catalog-findings.md`). Sending a request to such a model can itself be the problem. Ask the owner which models you may call; do not decide that yourself.
6. **Do not spend Ask Sage tokens without the owner's explicit go-ahead for that spend**, and do not chunk a batch that Claude Code's safety classifier blocked to get around it (see `CLAUDE.md`). Free steps first. If the classifier blocks a paid run, stop and give the owner the exact command to run themselves.

## Steps

**0. Environment.** Node 22 or newer, or VS Code's bundled Node (`ELECTRON_RUN_AS_NODE=1 <Code executable> script.mjs`). `node scripts/run-tests.mjs` should pass. If HTTPS to the instance fails with certificate errors (a corporate proxy that inspects TLS, private root certificates), do not disable verification. Node can trust the operating system's certificate store: try `NODE_USE_SYSTEM_CA=1` (Node 22.15 or newer, and 24), and check the Node documentation for the version you have. If a proxy is required, Node's `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node 22.21 or newer).

**1. Free measurements.** Ask the owner for the instance's chat host and API host.
- `node phase0/probe/catalog-audit.mjs <chat host> --api <api host> --alias private-<name>`: the model list, hosts and flags.
- `node phase0/probe/rate-sources.mjs <chat host> --api <api host> --alias private-<name> --models '<regex of cleared models>'`: the three rate sources (`get-models`, the web app's table, and the tokenizer's `convert_to_asksage`), as ratios. Add `--no-tokenizer` if the tokenizer endpoint is unavailable, and note that fact: it is a finding.

**2. Paid measurements, after the owner's explicit approval.**
- `node phase0/probe/billing-probe.mjs --api <api host> --alias private-<name>` prints the plan and the estimated cost; show it to the owner. The run is `... --yes` with the experiments and models the owner approves (the commercial run cost about 9,000 Ask Sage tokens). It reads each request's bill from the prompt log and compares it with the tokenizer's rate and the cache rules.
- If the prompt-log endpoint (`POST /user/get-user-logs`) or the tokenizer is missing on this instance, say so and stop that experiment: the probe's numbers depend on them. Do not fall back to counter deltas without telling the owner why the accuracy is lower.

**3. Answer these, with the data** (each is a row or section of the public report; say *same*, *different* or *not tested*, and give the numbers):
1. Per endpoint and model host present on this instance: does caching apply, must the client ask for it, and what multipliers are billed for reads and writes?
2. How long does a cache last on Claude (5-minute and 1-hour) and on GPT?
3. How do the three rate sources compare with the bills? Is the 1.3× relation between `get-models` and billing present, and on which models?
4. Is Claude through the OpenAI-compatible endpoint billed at all here?
5. Do Gemini and Bedrock-hosted GPT get any discount?
6. Which models exist here, on which hosts, and does a model name resolve to a different host than on the commercial instance?
7. What could not be measured, and why.

**4. Write the report.** Copy `research/reports/TEMPLATE-instance-billing-report.md` to `private/<name>/report.md` and fill it in. Requirements from the owner: **BLUF first**; readable by technical and non-technical readers (plain language up front, detail below); every claim labeled measured, fetched or inferred; comprehensive but scannable; a clear statement of what was **not** tested. Finish with a **vetting appendix**: for every number in the report, the file it comes from and the command that recomputes it, so a reviewer can check it without trusting you.

**5. Stop.** Hand the report and the vetting appendix to the owner in `private/`. Do not send them anywhere. The owner arranges review and the channel.

## Constraints from `CLAUDE.md` that still apply

Plain JavaScript, no npm, no dependencies, nothing copied from `asksageclient`. If a tool needs changing for this instance (a different endpoint path, a missing field), make the change small, with a test, and keep it free of instance data, so the owner can commit it to the public repo.
