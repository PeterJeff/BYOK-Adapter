# Ask Sage provider (Phase 1 skeleton)

CC (OpenAI Chat Completions) and R (OpenAI Responses) transports only. No Claude (M), no
Gemini (G), no cache breakpoints, no reasoning-state round-trip yet — those are Phase 2+
(`PLAN.md` §9). Unit-tested against an injected fake `fetch`
(`test/provider/provider.test.js`); R is now also live-confirmed (2026-09-27, real `public`
tenant traffic, gpt-5.4-nano and gpt-5.6-luna) — see `requirements/REQUIREMENTS.md` §5 for what
that live pass caught and fixed.

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

All three settings are `scope: "application"` (a workspace's `.vscode/settings.json` cannot
override them), but they are not yet registered in VS Code's `restrictedConfigurations` org
policy — that's a separate, unverified step.

## 3. Try it

Open Copilot Chat and pick a model under the **Ask Sage** vendor. Only CC/R-flavored models
are listed — Claude and Gemini ids are filtered out rather than silently misrouted through the
wrong endpoint. Use **Ask mode**: Phase 1's accept criteria and tests only cover plain
streaming, not an agent tool loop. Tool calls are wired (basic passthrough) but untested at any
scale, and there is no cache-breakpoint or reasoning-state logic yet, so an agent-mode session
will re-send the full context uncached every round and may lose reasoning between rounds.

Every real message spends real Ask Sage tokens. The default spend caps
(`asksage.budget.sessionCapTokens` 50,000 / `asksage.budget.hourlyCapTokens` 200,000 per hour)
are generous enough not to interfere with ordinary testing, but they only block a request
*before* it's sent if the running total is already over — they don't project the cost of the
message you're about to send.

## If something looks wrong

- **Output panel → "Ask Sage" channel** for logs (nothing secret is ever written there).
- **`<globalStorageUri>/ledger/*.jsonl`** — one line per request, plain JSON, no prompt text.
  Useful for checking what was actually normalized and what it was estimated to cost.
- The first message to any given model pays a small extra latency hit: five free
  `/server/tokenizer` calls to learn that model's billed rate, cached for 24h afterward.

## Known VS Code / Copilot Chat interactions

- **"No utility model is configured for 'copilot-utility-small' ... main agent model is BYOK"**
  (2026-09-27, thrown from Copilot Chat's own bundle, not this extension — the stack trace is
  entirely inside `extensions/copilot/dist/extension.js`). Copilot Chat uses a separate small
  "utility model" internally (intent detection, gathering codebase references) and doesn't
  automatically reuse a BYOK main model for that. It surfaced via `_getCodebaseReferences`,
  which suggests it's tied to implicit codebase-context gathering (Agent mode or `#codebase`),
  not plain Ask mode. Fix with a VS Code setting, not a code change here:
  ```json
  "chat.byokUtilityModelDefault": "mainAgent"
  ```
  (or point `chat.utilitySmallModel` at a specific model, including one of ours, if you want
  those utility calls ledgered too).

## Known gaps (tracked in `requirements/REQUIREMENTS.md` and `TODO.md`)

- No Claude (M) or Gemini (G) transport, no cache breakpoints, no reasoning-state round-trip
- Catalog filtering is `cui_capable` only; `force_models` intersection (§2.3) isn't implemented
- No pre-flight cost estimate before sending, only the after-the-fact ledger/cap accounting
- No retry-on-transport-failure logic for CC/R model calls (the JWT-based `/server`/`/user`
  calls do retry once on an auth-invalid response)
