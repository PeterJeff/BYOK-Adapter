# Phase 0 probes

## `api-probe.mjs`: authenticated API probes (T0–T21)

Runs the Phase 0b tests in PLAN.md §9 against one tenant and records redacted fixtures to `research/live/<alias>/probe/<date>-<run>/`: one JSON file per request under a folder per test, plus `summary.md` / `summary.json`. The summary is raw observation. The conclusions go in `research/live/FINDINGS.md`.

**It spends Ask Sage tokens.** It prints the models it picked and a pessimistic, full-price estimate first. It sends nothing billable without `--yes` or a typed `yes`, and it stops before any request that would push its running estimate past `--max-spend` (default 60,000). With the default models on the public catalogs the whole default set estimates at about 10k.

**Only run the paid tests from a machine with a real tenant key.** Hosted/cloud Claude Code sessions (cloud containers, CI) don't have one and shouldn't be asked for one — from there, run `--dry-run` and `--tests T0` only (free). The full battery is for a human running Claude Code locally (Desktop or CLI) with `ASKSAGE_API_KEY`/`ASKSAGE_EMAIL` for a test tenant.

```sh
node phase0/probe/api-probe.mjs --api api.asksage.ai --alias tenant-a --dry-run        # plan and cost only; no key needed
node phase0/probe/api-probe.mjs --api api.asksage.ai --alias tenant-a --tests T0,T19   # free checks + counter lag first
node phase0/probe/api-probe.mjs --api api.asksage.ai --alias tenant-a --yes            # the default set
```

Credentials come from `ASKSAGE_API_KEY` and `ASKSAGE_EMAIL`, or from `--key-file <file>` and `--email`. The key is never printed or written. Every fixture passes through `lib/redact.mjs`, which removes the key, the access token, emails, user and org identifiers and the tenant hosts. The result is then scanned, and a file that still contains any of them is not written. Check the fixtures before committing them anyway.

**Key but no email (key-only mode).** The email is only used to exchange the key for an access token (`/user/get-token-with-api-key`, `kind: 'user'`/`'server'`). M, CC, R and G calls authenticate directly with the raw key and don't need it, so with `ASKSAGE_API_KEY` set and no `ASKSAGE_EMAIL`/`--email`, the caching/billing/reasoning tests still run for real: T1–T9, T11, T15–T18, T20. What can't work without the email-derived token: T0's budget/user-object checks, T19 (needs the budget counters), and T21 (needs `/server/get-dataset-results` and the native `N` flavor) — those show as auth errors, which is expected, not a bug. The probe never prompts for a missing email; it just proceeds key-only and says so.

**No key in the environment at all?** The probe does not prompt for one either. It sends requests with no client-supplied credential instead, on the assumption that something in front of `--api` (a corporate gateway, a proxy, a sidecar) authenticates them itself. Pass `--no-auth-headers` to choose that mode explicitly even when a key is available, for example to see how such a gateway actually behaves. In this mode every auth-dependent check has nothing to measure and is recorded as an error.

| Option | Effect |
|---|---|
| `--api <host>` | API host (required) |
| `--alias <name>` | Tenant alias (required). Names the output folder and replaces the host in everything saved |
| `--no-auth-headers` | Send no client-supplied credential; assume a gateway in front of `--api` authenticates requests. Implied automatically when no key is available |
| `--tests T0,T1,...` / `--skip ...` | Choose tests. Default: everything except the opt-in T13 (long context, expensive) and T21 (needs `--dataset`) |
| `--model role=id` | Override a model. Roles: `claude`, `gpt`, `gemini`, `embedding`, `long` |
| `--allow-non-cui` | Allow `cui_capable: false` models (skipped by default) |
| `--max-spend <n>` | Spend cap in Ask Sage tokens (probe's own full-price estimate) |
| `--no-measure` | Skip the budget-counter polling (much faster; T9, T19 and the billing checks become "skip") |
| `--ttl-wait <s>` | T15's wait before re-reading the 1h/5m entries (default 360; 0 skips) |
| `--prefix-tokens <n>` | Size of cached prefixes (default 6000; the minimum is 4500, because Haiku 4.5 needs 4096) |
| `--catalog <file>` | Use a saved `get-models-full.json` instead of fetching it |
| `--dataset <name>` | Dataset for T21 |
| `--out <dir>` | Output folder |

By default each role gets the cheapest `cui_capable` model that matches, preferring anything over commercial-hosted `-com` variants. Every cached prefix starts with a run-unique nonce, so an earlier run's cache cannot produce false hits. Budget measurement assumes nothing else spends from the same account while the probe runs, so close the web app. T19 runs early and tunes how long later steps wait for the counters to settle.

Run T0 and T19 on their own first. T0 is free: it checks auth, the budget endpoints, the full user object (recorded as a shape summary, with values only for budget and model-restriction fields), the authenticated catalog, bad-credential envelopes, and the tokenizer's own Ask Sage conversion, which shows whether rates multiply or divide. T19 shows whether single requests can be resolved on the counters at all. If they can't, the per-request billing checks will read "unknown" and PLAN.md §3.6 batch mode applies.


## `rate-sources.mjs`: which rates are billed (free)

Compares three per-model rate sources for one instance and saves the ratios: `get-models` `token_conversion_rate`, the chat web app's hardcoded rate table (and its older "legacy" list), and `POST /server/tokenizer` with `convert_to_asksage`, which reproduced every measured bill on 2026-09-25 (`research/rate-sources-investigation.md`). Nothing is billed; the tokenizer needs the access token (`ASKSAGE_API_KEY` + `ASKSAGE_EMAIL`) or a gateway that adds it.

```sh
node phase0/probe/rate-sources.mjs chat.asksage.ai                     # all models
node phase0/probe/rate-sources.mjs chat.<tenant> --alias tenant-a --models 'claude|gpt-5'
node phase0/probe/rate-sources.mjs chat.asksage.ai --no-tokenizer      # public sources only
```

`summary.md` / `summary.json` (ratios and model lists) go to `research/live/<alias or host>/rates/<date>/`; the absolute rates go to `raw/` there, which is gitignored (the web app's table is not published in this repo).

## `billing-probe.mjs`: measured bills per request (spends tokens)

Sends small synthetic requests and reads each one's exact bill from the prompt log (`POST /user/get-user-logs`: `total_tokens` per request), then compares it with the tokenizer's rates and the measured cache rules (`lib/billing.mjs`). Experiments: `rates` (prompt-heavy and output-heavy per model), `cache` (M 5m/1h/none, CC, R, G, and whether Claude through CC is billed), `loop` (a 6-round Claude tool loop, uncached versus Copilot-style breakpoints), `ttl` (re-send after `--ttl-wait` minutes). The default set is about 9k Ask Sage tokens at the test tenant's rates (the loop is 5.6k of it). Without `--yes` it only prints the plan. Nothing else may use the account while it runs (bills are matched to requests by time). Only numbers are saved: no prompt or response text, no log or user ids.

```sh
node phase0/probe/billing-probe.mjs --api api.asksage.ai --alias test-tenant                  # plan only
node phase0/probe/billing-probe.mjs --api api.asksage.ai --alias test-tenant --experiments cache,loop --yes
```

## `catalog-audit.mjs`: model catalog audit

For one Ask Sage instance, the audit compares:
1. what the instance **declares**, from `https://<chat host>/vars.js`
2. what its **web app offers**, from the default / gov / DoD allow-lists hardcoded in the chat bundle
3. what its **API serves**, from `POST /server/get-models?format=full` plus the static `openai` and `anthropic` `/v1/models` catalogs

It then reports the mismatches: non-CUI models on a government or CUI instance, models outside the instance's allow-list, `-com` models on government instances, undocumented suffixes, alias collisions, and unpriced models.

**It only makes public, unauthenticated requests.** No API key is read or sent, and nothing is billed. It shows what an instance *lists*, not what an account can *call*. See `research/model-catalog-findings.md` for the background and caveats.

### Run it

Windows, with VS Code's bundled Node:

```powershell
$code = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
$env:ELECTRON_RUN_AS_NODE = "1"
& $code phase0\probe\catalog-audit.mjs chat.<instance> --alias <name>
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

Anywhere with Node 22:

```sh
node phase0/probe/catalog-audit.mjs chat.asksage.ai
node phase0/probe/catalog-audit.mjs chat.<your-tenant> --alias tenant-a   # dedicated instance
node phase0/probe/catalog-audit.mjs --from research/live/tenant-a/catalog/2026-09-25   # re-audit saved snapshots
```

The markdown report goes to stdout. Snapshots and `audit.md` / `audit.json` are saved to `research/live/<alias or host>/catalog/<date>/`.

| Option | Effect |
|---|---|
| `--alias <name>` | Names the output folder and replaces the real host names in everything saved (PLAN.md §6). Use it for any non-public instance. |
| `--api <host>` | API host, when it can't be derived from `vars.js` or `chat.* → api.*` |
| `--out <dir>` | Output folder |
| `--no-save` | Print only |
| `--json` | Print the audit as JSON |
| `--from <dir>` | Re-audit saved snapshots offline |

Only the profile-related `vars.js` keys are saved. The 12 MB web app bundle is not saved; its path and SHA-256 are recorded in `meta.json`.

### Network behind a proxy or TLS inspection

Node's `fetch` ignores the system proxy unless told otherwise:
- **Proxy:** set `HTTPS_PROXY=http://proxy:port` and `NODE_USE_ENV_PROXY=1`. This needs Node 22.21 or later; check with `& $code -p process.versions.node` (with `ELECTRON_RUN_AS_NODE=1` set). On older builds, run the audit from a machine with direct access, or run it inside the extension later, which uses VS Code's proxy support.
- **TLS inspection:** set `NODE_EXTRA_CA_CERTS=<path to your org's CA bundle (PEM)>`, or run node with `--use-system-ca`.

The script prints these hints when a request fails with a matching error.

### When the web app changes

The allow-list extractor looks for the `REACT_APP_force_gov_models`, `REACT_APP_force_dod_models` and `REACT_APP_allowed_models` names, not the minified variable names, so it survives rebuilds. If Ask Sage changes the code shape, the affected list reports "not found" rather than a guess, and the checks that depend on it are skipped.
