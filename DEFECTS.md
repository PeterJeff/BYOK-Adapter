# Known defects and problems

Found by a review of branch `claude/phase2-m-and-caching` at commit `c42f711` (2026-09-29). **None of these is fixed yet.** This is the one home for defect detail: `REQUIREMENTS.md` and `TODO.md` point here by ID and do not repeat it. When a defect is fixed, delete its entry in the same commit and note the fix in the commit message; when a fix is only partial, edit the entry.

**How each entry was established.**
- *Reproduced*: shown by running the code in a scratch script against a fake or a recorded fixture.
- *Read*: follows directly from the code, with no live run needed to see it.
- *Suspected*: the code does something questionable, but whether Ask Sage or Copilot actually rejects or mishandles it needs a live run.

**Severity.**
- *Blocker*: likely stops Phase 2's live acceptance, or basic use of a model family.
- *High*: wrong results or money lost silently.
- *Medium*: wrong or degraded behavior with a workaround.
- *Low*: cosmetic, rare, or diagnosability only.

Every piece of code named below is on the Phase 2 branch. `main` has the Phase 1 code only.

## A. Code defects

### D1 (Blocker, reproduced): Claude requests are rejected on the output cap, and the correction never triggers
- **Where.** `src/errors.js` `parseOutputCapTooLarge` (`OUTPUT_CAP_RE`). The value comes from `src/extension.js`, where `model.maxOutputTokens` is the catalog's `limits.max_output`.
- **What.** The extension sends the catalog's `limits.max_output` as `max_tokens` and relies on a rejection to learn the real cap (`src/rates/outputCaps.js`). The rejection parser only knows OpenAI's wording ("supports at most N completion tokens"). Anthropic's wording is "`max_tokens: 136000 > 64000, which is the maximum allowed number of output tokens for claude-haiku-4-5-20251001`". It is recorded in `research/live/manual-run/probe/2026-09-26-0402-c5ced6/T8/061-over-limit.json`, and `parseOutputCapTooLarge` returns `null` for it (reproduced).
- **Why it bites.** The committed catalog snapshot (`research/live/chat.asksage.ai/catalog/2026-09-25/get-models-full.json`) lists every Claude model with a `max_output` of 135,000 to 990,000. That is far above the real caps of 64k to 128k.
- **Effect.** Every request to such a Claude model is likely rejected, and the error is shown to the user. Nothing is learned, so the next request fails the same way. This has not been seen live only because M has never run live.
- **Fix direction.** Parse Anthropic's wording too, and test the parser against the recorded fixture rather than a hand-written string. Consider starting from a conservative per-family default instead of the catalog value.

### D2 (High, reproduced): a stream longer than 180 s is cut off silently, and reported as a success
- **Where.** `src/transport/httpClient.js` `request`.
- **What.** The 180 s timer covers the whole request, including the streaming phase, and is never reset as data arrives. When it fires, the stream reader's abort error is swallowed (`if (!ac.signal.aborted) throw e`). The result has `error: null` and `transportError: null`.
- **Reproduction.** A fake stream that sends one event and then stalls past a 300 ms timeout returns 1 event, no error and no transport error.
- **Effect.** Long answers are silently truncated. Long reasoning (Opus 5.5, GPT-6 at high effort) and large file edits in agent mode are the likely cases.
  - Usage arrives at the end of a stream, so there is none. The ledger then records `status: 'ok'` with zero cost, and the spend cap is not charged, although Ask Sage bills the tokens.
  - The user sees a partial answer with no error.
- **Fix direction.** Use an idle timeout that is reset on every chunk, plus a separate optional total cap. Report a timeout abort as a transport error, distinct from a user cancel.

### D3 (High, reproduced in the converter; effect through Ask Sage suspected): parallel tool calls on M resend the thinking block once per call
- **Where.** In `src/transport/anthropicMessages.js`, `onThinking` fires once for each tool call. `src/extension.js` then reports a new `LanguageModelThinkingPart` for each call, all carrying the same signature. `src/convert/messages.js` `toAnthropicMessages` sends every thinking part that has a signature.
- **What.** An assistant turn with N parallel tool calls comes back in history with N identical thinking parts. It is resent as N identical `thinking` blocks. This was reproduced with two parts: the output was `thinking, thinking, tool_use, tool_use`.
- **Effect.** Anthropic requires thinking blocks to come back unmodified, so a duplicated block is probably rejected.
  - If the error wording happens to match `isThinkingBoundRejection`, the request is retried with thinking stripped. The model then loses its reasoning on every parallel round, and a wasted request is sent.
  - Otherwise the turn fails.
  - Parallel reads are routine in agent mode, so this would show up on Claude models with thinking on.
- **Fix direction.** Emit one thinking part per assistant turn, and have the converter deduplicate by signature.

### D4 (Medium, suspected): an empty thinking text is resent as a single space
- **Where.** `src/extension.js` `onThinking`: `new LanguageModelThinkingPart(t.value || ' ', ...)`.
- **What.** On the models whose thinking text is empty by default (Sonnet 5, Opus 4.7 and newer, Fable), `display` is `"omitted"`. The part is emitted with `' '`, round-trips as `' '`, and is resent as `thinking: " "` alongside the original signature.
- **Unverified.** Whether Anthropic checks the text against the signature is not known. If it does, every tool round on those models loses its reasoning state, or fails, the same way as in D3.
- **Fix direction.** Resend the text exactly as received. Keep it in metadata if VS Code will not render an empty part.

### D5 (Medium, read; effect suspected): reasoning blobs don't record which flavor or model produced them
- **Where.** `src/convert/messages.js`. Both `toAnthropicMessages` and `toResponsesInput` read `metadata.signature`.
- **What.** Two different things are stored under the same metadata key: M's Claude thinking signature and R's `encrypted_content`.
- **Effect.** If a chat switches model between a Claude model (M) and a GPT model (R), one flavor's blob is resent to the other. R would get a Claude signature as `encrypted_content`, and M would get OpenAI encrypted content as a thinking signature. Both are likely rejected.
  - M may recover through the strip-and-retry path, if the wording matches.
  - R has no such path.
  - Switching between two Claude models may also fail: signatures are probably bound to the model that made them. That is untested.
- **Fix direction.** Store the flavor and model with the blob, and resend it only to the same flavor and model.

### D6 (High, read): the budget guard never checks the account's remaining balance, and its warnings are invisible
- **Where.** `src/budget/preflight.js` `checkPreflight`, and `src/extension.js`. Warnings and alarms use `log.warn`.
- **What.** PLAN §3.5 designs the hard stop against the *remaining monthly balance* minus a reserve. The pre-flight check compares only against the session and hourly caps. The balance is fetched, but it is only used for the status bar and the forecast.
- **Defaults.** 50,000 per conversation and 200,000 per rolling hour. The hourly default equals the test account's entire monthly limit (`max_tokens: 200000`, T0).
- **Warnings.** The pre-flight "warn" level and the cache-health alarm write only to the Ask Sage output channel. Nobody watches that during a chat.
- **Effect.** A spend like the one that used a large share of the test account's monthly pool on 2026-09-27 is not guarded against (see the cost warning in `research/live/test-tenant/t12/README.md`).
- **Fix direction.** Add a balance-based stop, and caps derived from the balance by default. Show warnings in the chat response or a notification.

### D7 (High, read): tool pinning, on by default, withholds tools added mid-conversation
- **Where.** `src/cache/toolPinning.js`, and the `asksage.cache.pinToolList` setting (default `true`).
- **What.** The first tool list is sent for the conversation's whole life. Tools Copilot adds later are held back until a new chat, and only a log line says so.
- **Effect.** An MCP server the user enables mid-chat is invisible to the model. So are tools that Copilot's virtual-tool grouping adds when the model opens a group. The model is told a tool exists, or is asked to use it, but cannot call it. On a machine nobody can debug remotely, that is a confusing failure.
- **The trade-off.** The cost it avoids is one cold turn per change, which is cheap compared with a broken agent loop.
- **Still unknown.** What Copilot does when the model calls a tool Copilot has since removed (TODO).
- **Fix direction.** Let additions through: one logged cold turn. Removals could stay pinned. Or default the setting off until live use shows how often churn happens.

### D8 (Medium, read): failed requests never reach the ledger
- **Where.** `src/extension.js`. `throw toLanguageModelError(...)` runs before `ledger.append`.
- **What.** Only successful and cancelled requests are recorded. `errorClass` is never set, and `toolCallCount` is always `0`.
- **Effect.** Failures cannot be counted or classified from the ledger. The health report's "not working" verdicts (PLAN §14) depend on them.
- **Fix direction.** Append an error record with an error class before throwing, and keep the server message in the failure recorder (PLAN §14.2). Count the tool calls.

### D9 (Medium, read): cancelled streams are recorded at zero cost
- **Where.** `src/extension.js` and the transports.
- **What.** Usage arrives at the end of a stream. A cancelled stream has none, so `estAsCost` is `null`. The ledger shows zeros, and the spend cap is not charged.
- **What the plan says.** PLAN §3.5 says to estimate from the input plus the streamed output. T9 measured that a cancelled stream is billed for somewhat more than was streamed.
- **Fix direction.** Estimate the input from the pre-flight character count and the output from the streamed characters. Mark the record as estimated.

### D10 (Medium, read; effect suspected): every error is reported as `LanguageModelError.Blocked`
- **Where.** `src/errors.js` `toLanguageModelError`.
- **What.** Auth failures, network errors, "unsupported model", cap rejections and the budget hard stop are all raised as `Blocked`, the content-filter category.
- **Unverified.** How Copilot renders `Blocked`: it may suggest the reply was filtered. VS Code also has `NoPermissions` and `NotFound`, or a plain `Error` can be used.
- **Fix direction.** Map each error class to a suitable kind, and word the message the way PLAN §14.3 describes: what failed, the likely cause, what to try.

### D11 (Medium, read): `prefixHash` leaves out the system prompt, and the code comments deny a System role that has been observed
- **Where.** `src/extension.js` (`prefixHash`: first *user* message plus the tools). The docblock of `src/convert/messages.js` `toAnthropicMessages` has the wrong comment.
- **What.** Phase 0a saw a system-role message in Copilot's requests, both in the development host and in an installed copy (`research/live/test-tenant/phase0a-report.md`, findings 4–5 and the last-request role counts). At runtime `roleEnum.System` exists, so the converters correctly move that message out of the "user" stream.
- **Effect.** `prefixHash` then hashes the user's first prompt and the tools, but not the system prompt. That leaves out the part most likely to change (Copilot rewriting its instructions), which is the case the hash exists to detect (PLAN §3.4).
  - The docblock says the stable API has no System role and it has "never been seen present". That is contradicted by the recorded evidence. PLAN §4.1 carried the same wrong correction until 2026-09-29.
- **Fix direction.** Hash every system message plus the first user message plus the tool definitions, and correct the comment.

### D12 (Medium, read): Claude thinking is always on and ignores Copilot's thinking setting
- **Where.** `src/convert/thinking.js` `defaultThinkingShape`, and `src/extension.js`.
- **What.**
  - Every Claude request carries a thinking config: adaptive with effort `medium`, or `enabled` with a 1,024-token budget on the 4.5 generation. Copilot passes `modelOptions._enableThinking` (seen in Phase 0a), but it is never read. PLAN §4.1's other rules are not built either:
  - `display: "summarized"` is not sent, so newer models show empty thinking.
  - Opus 5.5's effort is not sent explicitly.
  - `toolMode` is never read, so "required" mode quietly behaves as "auto".
  - Thinking is only emitted on turns that have a tool call, so plain answers show no thinking.
- **Effect.** Thinking tokens are spent on requests where the user turned thinking off, and the user never sees the reasoning they pay for.
- **Fix direction.** Honor `_enableThinking` when present, send `display`, and send effort explicitly.

### D13 (Low, read): the cache minimum is 1,024 tokens for every model
- **Where.** `src/cache/breakpoints.js` (default `minPrefixTokens` 1024). `src/transport/anthropicMessages.js` never passes a per-model value.
- **What.** Haiku 4.5 needs 4,096 tokens (PLAN §2.1). Below the minimum, the API ignores a breakpoint without charging for it. The only cost is that a breakpoint the health report thinks will work silently doesn't.

### D14 (Low, read): the fallback conversation id is unstable, and collides between chats
- **Where.** `src/extension.js` `conversationIdFor`. It is used only when `modelOptions._conversationId` is absent (it was present in Phase 0a).
- **What.** The key is the first user message plus the raw tool-set hash of *this* turn. The id is created once and reused for as long as the process lives.
- **Effect.**
  - A tool-list change starts a "new conversation". That defeats tool pinning, thinking pinning, the cache key and the per-conversation cap.
  - Two chats that open with the same text share one id forever. PLAN §3.4 asked for the first-request timestamp to be part of the key.

### D15 (Low, read): per-conversation state grows without limit
- **Where.** In `src/extension.js`: `conversationIds`, `thinkingConfigByConversation` and `conversationCacheState`. Also `src/cache/toolPinning.js`, and `src/budget/spendCap.js` (`perConversation` and bumps).
- **What.** Nothing is ever evicted during the life of the extension host. Only `src/state/reasoningCache.js` is bounded.

### D16 (Low, read): every model advertises `toolCalling: true`
- **Where.** `src/extension.js` `provideLanguageModelChatInformation`.
- **What.** PLAN §7 asks for the numeric tool limit where one exists: CC rejects more than 128 tools (T11), and a number lets Copilot group tools itself. Models known to reject Copilot's tool list (Bedrock Gemma on CC) also advertise tool calling.

### D17 (Low, read): Check Cache Health can say "passed" when it did not check
- **Where.** `src/ui/cacheHealth.js`.
- **What.** The case that is not implemented ("parallel tool results") is reported as `pass: true`. The control case passes as long as there is no error, whatever the cache read was. The overall "passed" message can therefore hide a cold control request.

### D18 (Low, read; partly unverified): reconciliation can miss the rows it should match
- **Where.** `src/ledger/reconcile.js` `matchLogRows`.
- **What.** Rows are matched on the *requested* model id. The prompt log records the *billed* model, which can differ: `claude-haiku-4-5-com` was billed as `google-claude-45-haiku` (PLAN §3.6). Those rows stay unmatched.
- **Also unverified.** No committed fixture shows the format or time zone of `date_time`, so the 120 s matching window is untested against real rows.

### D19 (Low, read): "Request More Tokens" is misnamed
- **Where.** The `asksage.requestMoreTokens` command.
- **What.** It raises the in-memory session cap of the most recent conversation. Ask Sage has a real "request more tokens" feature (`/user/request-tokens`, PLAN §3.3), and the command's name suggests that one. Rename it, for example to "Raise This Conversation's Spend Cap". A real token request can be a separate command.

### D20 (Low, read): the picker lists models that cannot work, and hides some that could
- **Where.** `src/catalog/index.js`.
- **What.**
  - Models that fail on the flavor they are routed to are still listed, and fail with a raw VS Code stack trace. Examples: Grok 4.1 is "Unsupported model" on CC, and Bedrock Nemotron is forwarded to Bedrock's Responses API (FINDINGS §2.2 CC row).
  - `cui_capable: false` models are hidden on every tenant. PLAN §2.3 says to hide them by default only on government-like instances. On the public tenant this hides, for example, `google-claude-fable-5`.

### D21 (Low, read): the declared minimum VS Code version is below what signed-out use needs
- **Where.** `src/package.json` (`engines.vscode: ^1.104.0`), and the activation error message in `src/extension.js`.
- **What.** Signed-out use needs 1.122 or later (AGENTS.md §2). A signed-out 1.104–1.121 install loads without error, but chat cannot use it, and no message explains why.

### D22 (Low, read): the failover alarm compares raw model strings and ignores substitution
- **Where.** `src/extension.js`, in the cache-health alarm block.
- **What.** The alarm fires only when `resolvedModel` changes mid-conversation, compared as a raw string. FINDINGS ("Corrected", §3.5 served model) says to compare model family and version, and to flag a substituted model from the first turn on. `google-gemini-3.1-flash-lite-com` was served as `gemini-2.5-flash` and billed at 2.5's rate.
- **The design mismatch.** The Phase 3 design text said this needs a "canonical mapping this project doesn't have". The probe already has the rule: `sameModel` in `phase0/probe/lib/matrix.mjs`.

### D23 (Low, read): the first request to each model waits on five tokenizer calls
- **Where.** `src/rates/tokenizer.js`. The rate is needed for the pre-flight estimate before the request is sent.
- **What.** Five sequential free calls, once per model per 24 h, sit on the request path before the first token. The rate could be fetched in the background, with the pre-flight using the last known or catalog rate.

## B. Built less than the design says

These are gaps, not bugs. Each is designed in PLAN.md but not built, or only partly built. REQUIREMENTS.md shows the phase status and points here.

| PLAN | Designed | Built |
|---|---|---|
| §3.4 ledger fields | turn and round index, `requestInitiator`, `imageInputs`, `measuredDelta`, `rateTableVersion`, `ttftMs`, `partialOutputTokens`, `retried`, `errorClass` | none of these (`errorClass` is always `null`) |
| §3.6 | each ledger record gets `measured` from the prompt log | on demand only, through the Reconcile command. Nothing is written back to the ledger |
| §3.3 | periodic balance refresh while chat is active | on activation and after each request (30 s debounce) only |
| §3.5 | optional free remote token count near a guard threshold; per-model characters-per-token learned from responses | fixed 3.7 characters per token |
| §4.1 | intermediate breakpoint when one message would exceed the ~20-block lookback | not built: T16 showed it isn't needed on Vertex Haiku 4.5 or Opus 5.5 |
| §4.1 | `display: "summarized"`, explicit effort, "required" tool mode as `auto` plus an instruction | not built (D12) |
| §4.3 | the Check Cache Health case for many parallel tool results | not built (TODO) |
| §3.5 | budget-mode experiment | not built: needs a live comparison |
| §9 Phase 0b | `api-probe.mjs` measures T1–T4 and T19 from the prompt log | estimates use tokenizer rates; measurement still uses counter deltas |

## C. Project-level problems

- **P1. The test that decides the extension's value hasn't run.** PLAN §1 rests the extension's case on caching, cost awareness and error handling. T12 was planned to run before Phase 2. Its Claude-on-Messages leg is still open: the built-in Custom Endpoint with an exact Ask Sage Claude id.
  - Copilot's own `messagesApi.ts` places cache breakpoints. PLAN §4.1 copies its layout from there.
  - So the built-in route may already cache Claude, as it cached GPT-4.1 on Chat Completions.
  - If it does, the extension's caching advantage narrows to the Responses case (GPT-6 Astra cached nothing), tool-list churn, and cost visibility. Priorities would change accordingly.
  - It costs a few thousand tokens on Haiku.
- **P2. A large amount of code has never run live.** Phases 2 and 3 added about 1,550 lines under `src/` on 2026-09-28, and none of it has made a live request.
  - Phase 1's first live pass found three bugs its unit tests could not.
  - This review found D1–D4 by reading and small reproductions, and the existing tests could not catch any of them.
- **P3. The tests share the code's assumptions.** PLAN §10 says unit tests run against the recorded Phase 0 fixtures. Most `src/` tests use hand-written fakes written by the same session that wrote the code, so they encode its assumptions. Examples: the OpenAI cap wording (D1), a single tool call per turn (D3), a stream that always ends (D2). `test/errors.test.js` is the exception: it reads `research/live` fixtures. Converter and transport tests should replay recorded responses the same way.
- **P4. Phases 2 and 3 are unmerged.** They sit on `claude/phase2-m-and-caching`, and `main` still describes Phase 1. Cold sessions that trust `main` see a stale state; that is why AGENTS.md §6's "start from the newest branch" rule exists. Several local branches are merged or gone upstream.
- **P5. The machine can't explain itself.** The owner has run the extension there, but nothing physical comes back, and working out from raw logs or the ledger what went wrong costs more of their time than it is worth. PLAN §14 designs a plain-language health report that the owner can read on the spot and describe aloud.
- **P6. The documentation had outgrown the code.** Status paragraphs had spread into PLAN.md, and single table cells in REQUIREMENTS.md ran to 4,000 characters. Each fact was repeated in three to five places, so sessions skimmed. D11's wrong "correction" entered PLAN.md that way. Reorganized on 2026-09-29; the rules are now in AGENTS.md §4–§5.
