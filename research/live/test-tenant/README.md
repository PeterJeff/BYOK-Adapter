# `test-tenant`: the real Ask Sage test account, via this session's proxy

This is the "Independent / Personal Use / API Testing" account PLAN.md calls the **test tenant** (§9), reached through this cloud session's `api.asksage.ai` proxy credential. Unlike the earlier `sandbox-proxy/` run, authentication here is real: `validate_token_with_full_user` returns the real account (`max_tokens: 200000`, `paid: true`), and budget counters move after real requests.

**Two things had to be fixed before this worked, in this session:**
1. The proxy wasn't attaching a working credential at all at first (see `research/live/sandbox-proxy/README.md`) until it was reconfigured to inject via the `x-access-tokens` header.
2. Even after that, `api-probe.mjs` kept failing with `Token is invalid` while plain `curl` succeeded. Cause: Node's built-in `fetch` does not read `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node ≥22.21) — a Node/environment quirk unrelated to Ask Sage. Every invocation of `api-probe.mjs` (and any other script using `fetch` against a real host) from this kind of session needs that env var set.

**A caveat specific to this proxy setup:** the proxy substitutes a real credential into *any* value in a recognized auth header — including the deliberately-bad placeholder `api-probe.mjs` sends for T0's "bad auth" check. So `T0`'s "bad auth is HTTP 200 + error envelope on every flavor" check cannot produce a real result from this environment: every flavor now gets a real, authenticated response instead of an auth error (`bad-auth CC` happened to still error, but on a real completion-length limit, not on auth). That specific check needs a run from a machine that talks to Ask Sage directly, without this proxy in the path.

**Confirmed for real, from `probe/2026-09-25-1534-b69656/` (T0, T19):**
- §3.3's monthly-limit endpoint (`validate_token_with_full_user` → `max_tokens`) works via the JWT obtained under a gateway-authenticated request: confirmed `max_tokens: 200000`.
- §3.3's `app_name` tagging on `POST /server/count-monthly-tokens` does **not** change the returned count — the same value (411) came back tagged and untagged. Per-app usage attribution via this parameter doesn't work as PLAN.md hoped.
- T19: the budget-used counter moved after a single request, first seen at ~2s. Per-request reconciliation (§3.6) is resolvable for this tenant — the batch-mode fallback isn't needed here.

**Not yet run:** T1–T9, T11, T15–T18, T20 (the caching/billing/reasoning battery, ~13k Ask Sage tokens estimated) — see `requirements/REQUIREMENTS.md` §4 for why and what's needed to finish it.
