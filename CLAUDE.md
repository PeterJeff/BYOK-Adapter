@AGENTS.md

# Claude Code specifics

`AGENTS.md` (imported above) holds every rule that applies to all tools. This file adds only what is specific to Claude Code.

- **Memory.** Claude Code's auto-memory for this project lives on the dev machine only. Cloud sessions cannot see it. Background that every session needs, and that cannot be public, goes in `private/CONTEXT.md` (AGENTS.md §3), never in a tracked file.
- **Cloud sessions** see only what is committed and pushed, plus `private/` if their environment's setup provides it. They start from the newest branch (AGENTS.md §6).

## Where paid probes may run

Whether a hosted or cloud Claude Code session (a remote container, CI) has a working Ask Sage credential depends entirely on that session's own proxy configuration. Don't assume either way; check first, as below.

This project's remote container has, at times, had a proxy that injects a real credential for `api.asksage.ai`, with no `ASKSAGE_API_KEY` or `ASKSAGE_EMAIL` needed in the process. `research/live/test-tenant/README.md` explains how that was confirmed. Two gotchas cost real debugging time:
1. **The proxy may authenticate nothing at all.** Every call then gets the same "Token is invalid" that a real unauthenticated request would, even though the environment metadata claims a credential is injected. Verify with a real endpoint (for example `validate_token_with_full_user`) before trusting it. `research/live/sandbox-proxy/README.md` documents this dead end.
2. **Node's built-in `fetch` ignores `HTTPS_PROXY`** unless `NODE_USE_ENV_PROXY=1` is set (Node 22.21 or newer). `curl` respects the proxy by default and `fetch` doesn't, which looks exactly like a broken credential until you notice the difference. Always run `api-probe.mjs`, and any other script that uses `fetch` against a real host, from such a session with `NODE_USE_ENV_PROXY=1` set.

**Even once auth works, don't run the full paid battery** (T1–T9, T11, T15–T18, T20; about 13k tokens) as one autonomous batch.
- Claude Code's safety classifier blocks large unsupervised "real-world transaction" runs, including through `run_in_background`.
- Per its own guidance, that block is not to be routed around by splitting the batch into smaller pieces run back to back without the owner present.
- A small, individually approved test (T0, T19) is fine. The full battery needs the owner to run it directly, or to adjust their Bash permission settings to allow it.

**T0's bad-auth check needs a path without such a proxy.** If the proxy substitutes a real credential into *any* value of a recognized auth header, the check cannot produce a real result: every flavor gets a real authenticated response instead of an auth rejection.
