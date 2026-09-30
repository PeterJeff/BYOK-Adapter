# Ask Sage provider (the extension)

It routes each model to one of three transports: CC (OpenAI Chat Completions), R (OpenAI Responses) or M (Anthropic Messages, for Claude). Gemini (G) is not built, so Gemini models are not listed.

The CC and R paths are live-tested (Phase 1). M, the cache breakpoints, tool and thinking pinning, the reasoning round-trip and the budget guards (Phases 2 and 3) are unit-tested only. **Read `DEFECTS.md` before relying on them.** Status: `REQUIREMENTS.md` §5.

## 1. Load it

Same folder-install path as `phase0/smoke-extension` (see its README for the `.vsix` and
`--extensionDevelopmentPath` alternatives). Command Palette → **Developer: Install Extension
from Location...** → select this `src/` folder. Reload the window if later edits don't take
effect.

## 2. Configure

- `asksage.tenant` defaults to `public` (`api.asksage.ai`, the Phase 0 test tenant). Leave it
  unless you're pointing at a different instance, in which case set it to `custom` plus
  `asksage.host`.
- `asksage.email` — only needed for cost/budget features (the `/server/tokenizer` rate lookup
  and the **Ask Sage: Show Status** command exchange the API key for a JWT via
  `/user/get-token-with-api-key`, which needs an email). Chat streaming itself works without
  it; you'll just see no cost estimate and a warning in the log.
- Run **Ask Sage: Set API Key** (stored only in `SecretStorage`, never logged).

All three settings are `scope: "application"` and listed in `restrictedConfigurations`, and
the extension reads them from user settings only, so a workspace's `.vscode/settings.json`
cannot redirect requests or the API key.

## 3. Try it

Open Copilot Chat and pick a model under the **Ask Sage** vendor.
- Models are listed with their flavor in the tooltip. Gemini ids are left out rather than misrouted.
- Some listed models fail on the flavor they are routed to (DEFECTS D20).
- If your organization restricts models (`force_models` in your account info), only those are listed. That needs `asksage.email`; without it the list is unrestricted, and Ask Sage still refuses a model the organization doesn't allow.

Ask mode on CC and R is the tested path. Agent mode and Claude are built but not yet live-tested.

Every real message spends real Ask Sage tokens.
- **Caps.** Left unset, the spend caps are 10% of your monthly limit per conversation (`asksage.budget.sessionCapTokens`) and 25% per rolling hour (`asksage.budget.hourlyCapTokens`), and never more than 50,000 and 200,000. Set either one and your number is used as written, so a cap can be set above the defaults. **Setting a cap to 0 turns that cap off:** with both at 0 there is no session or hourly limit. The balance check below cannot be turned off, only relaxed through `asksage.budget.reserveTokens`; it stops a request only when the account's remaining monthly tokens cannot cover it.
- **Pre-flight.** Before each request, an input-only estimate is checked against your remaining monthly balance (minus `asksage.budget.reserveTokens`) and the caps. A request the balance cannot cover is refused, except in the last 6 hours before the monthly reset (00:00 UTC on the 1st), when it only warns. The request that crosses a cap on its output still completes, and the next one is refused.
- **Where warnings go.** A warning from the pre-flight check or the cache-health alarm shows as a notification, at most once per 10 minutes for the same warning, and is also written to the "Ask Sage" output channel. So are each request's estimate, conversation id and running totals (no prompt text).
- **Long answers.** A response that goes 180 seconds without a byte is stopped and reported as an error, with the text received so far left in the chat. A long answer that keeps streaming is never cut off.
- A changed cap applies to the next request, with no reload.

## If something looks wrong

- **Output panel → "Ask Sage" channel** for logs (nothing secret is ever written there).
- **`<globalStorageUri>/ledger/*.jsonl`** — one line per request, plain JSON, no prompt text.
  Useful for checking what was actually normalized and what it was estimated to cost.
  **Ask Sage: Open Ledger Folder** opens it (also linked from the session-cap setting).
- The first message to any given model pays a small extra latency hit: five free
  `/server/tokenizer` calls to learn that model's billed rate, cached for 24h afterward.
- **`asksage.debug.logRequests`** (default `false`): when turned on, writes the exact request
  body and the concatenated response text to `<globalStorageUri>/debug/*.jsonl` — one line per
  attempt (a rejected first try and its retry both get their own line). This is the only place
  in the codebase allowed to hold prompt text, and only because you turned it on; the ledger
  never does. Turning it on logs a warning in the Output channel with the exact file path.
  **Ask Sage: Open Request Log Folder** opens it (also linked from the setting).

## Known VS Code / Copilot Chat interactions

- **"No utility model is configured for 'copilot-utility-small' ... main agent model is BYOK"**
  (2026-09-27, thrown from Copilot Chat's own bundle, not this extension — the stack trace is
  entirely inside `extensions/copilot/dist/extension.js`). Copilot Chat uses a separate small
  "utility model" internally (intent detection, gathering codebase references) and doesn't
  automatically reuse a BYOK main model for that. It surfaced via `_getCodebaseReferences` —
  **confirmed to happen in plain Ask mode too** (2026-09-27), whenever that turn's request ends
  up with a "codebase" context attached, not only in Agent mode. Fix with a VS Code setting, not
  a code change here:
  ```json
  "chat.byokUtilityModelDefault": "mainAgent"
  ```
  (or point `chat.utilitySmallModel` at a specific model, including one of ours, if you want
  those utility calls ledgered too).
- **`chat.byokUtilityModelDefault: "mainAgent"` trades the error above for real background
  spend.** Once set, one visible chat turn can produce *several* real model calls: confirmed
  (2026-09-27, ledger + the Ask Sage prompt log) an auto-generated session title and the
  rotating "Warming up the code" / "Brewing fresh logic" progress-message flourish shown while
  waiting are both real inference through this provider, not free UI text. In one observed turn,
  a single visible question produced 4 real requests (1 answer + 3 background), on two different
  models, all within about a second. The per-call cost is small (a few Ask Sage tokens each) but
  it's a real request multiplier this extension can't prevent — Copilot Chat decides when to
  make these calls, not the provider. If it looks like a burst of tiny unexplained ledger entries
  clustered around one real question, this is almost certainly why.

- **Deselecting tools in the chat tools picker doesn't always apply** (2026-09-27, Ask mode).
  It took several tries (switching to another agent, deselecting, switching back, deselecting
  again) before a request went out without the full tool list, and `session_store_sql` was sent
  even with every tool deselected. Check what was really sent with `asksage.debug.logRequests`.
  This matters for models that reject Copilot's tool list (Bedrock Gemma on CC, see
  `research/live/FINDINGS.md`).

## Known Ask Sage data-quality issues (worked around here, not silently trusted)

- **`get-models?format=full`'s `limits.max_output` is often not the real completion-token cap**
  (`research/live/FINDINGS.md`, "Extension live checks"). `src/rates/outputCaps.js` starts
  from the catalog value, learns the real cap from an OpenAI-worded rejection, and remembers it
  per model. A "rejected max output ... retrying once" line in the "Ask Sage" log is this
  mechanism working. Both the OpenAI and the Anthropic wording are recognized.

## Known defects and gaps

`DEFECTS.md` lists them all, with the most serious first. Model calls are never
retried on a transport failure; the JWT-based `/server` and `/user` calls retry once on an
auth-invalid response.
