# `sandbox-proxy`: cloud-sandbox run, no working credential

`probe/2026-09-25-1503-5a5c49/` is a Phase 0b run (T0, T19 only) from a Claude Code cloud sandbox that has network access to `api.asksage.ai` through a proxy the environment described as providing an injected Ask Sage credential. It doesn't: every credentialed call in this run returns the same `HTTP 200 {"status":400,"message":"Token is invalid"}` envelope as a genuinely unauthenticated request, and a direct `POST /user/get-token-with-api-key` with an empty body came back `"Missing required fields"` rather than a real token — the proxy passes the literal request through unmodified rather than injecting `email`/`api_key`.

**What this run does and doesn't confirm:**
- Does *not* confirm any §3 budget/billing or §2 caching **LIVE-TEST** assumption — no request ever authenticated, so there is nothing to measure. Treat every LIVE-TEST item in `requirements/REQUIREMENTS.md` as still ⛔ pending a real key.
- Does corroborate, from a fresh empirical sample, `PLAN.md` §7's already-verified claim that every flavor (M/CC/R/G/server) returns HTTP 200 with a `{"response","status"}` error envelope on bad auth.
- Confirms the unauthenticated `get-models` catalog (105 ids) matches what `catalog-audit.mjs` already found for the public catalog.

Real Phase 0b confirmation still needs a real `ASKSAGE_API_KEY` + `ASKSAGE_EMAIL` for a test tenant.
