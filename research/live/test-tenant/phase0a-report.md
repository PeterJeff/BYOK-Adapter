# Phase 0a report: dev machine, VS Code 1.139.1, signed out of Copilot

Run 2026-09-25 with `phase0/smoke-extension` 0.1.0 loaded through `--extensionDevelopmentPath` in a throwaway VS Code profile (fresh user-data and extensions directories), no GitHub or Copilot sign-in. The smoke extension's own report was generated 2026-09-26T01:11Z.

**This is the developer's test machine, the reference environment** (PLAN §9, revised 2026-09-25: the target gets beta builds and no data comes back from it). E5 is a property of this machine's network. The tenant alias `test-tenant` is `api.asksage.ai`.

## Verdicts

| Test | Verdict | What it means |
|---|---|---|
| E1 Models in picker | **PASS**, with a caveat | Signed out, "Ask Sage Smoke Echo" and "Ask Sage Smoke Echo (128-tool limit)" appeared in **Chat: Manage Language Models** and could be selected in chat. **Caveat:** the first attempt in this profile, on VS Code **1.139.0**, showed a sign-in request and no model could be selected. After the user restarted VS Code (it updated to **1.139.1**) with no other change, it worked. Cause unestablished: the update, or first-run state of a fresh profile. Check the target machine's exact version. |
| E2 Agent mode + tools | **PASS** | Agent mode passed 51–52 tools (list below). A tool call emitted by the provider (`read_file`) ran and its result came back as a tool-result part carrying the provider's own call id. Tool inputs are validated against the tool's schema by VS Code before the tool runs: a call missing `startLine` returned "Your input to the tool was invalid" as the tool result. |
| E3 Side-loading | **PASS** (follow-up, folder install) | This run's PASS did not count: the extension was loaded by the development host, which skips install policy, and the E3 verdict was hardcoded (it now passes only for a local install). A later folder install (Developer: Install Extension from Location...) loaded and ran in the everyday window; see `phase0a-e4-loop.md`. `extensions.allowed` is `*` here, so the target machine's policy is still untested. |
| E4 Parts round-trip | **Plain replies: thinking and data parts dropped. Tool loop: thinking part comes back, data part does not** | *Between turns* (5 earlier replies seen again in the same chat): text came back, the thinking part **0/5**, the private-MIME data part **0/5**; no `usage` data part was ever seen in history. *Inside a tool loop* (rerun with the fixed extension, reply `smk-3-oc8prx`: thinking + text + data part + tool call, then the tool result): the next request carried parts `{text:4, thinking:1, toolCall:1, toolResult:1}`; **thinking part back: yes, with its id and its metadata intact; data part: no**. One sample, one tool round, a small metadata object, development host. |
| E5 Network reach | **PASS** | `fetch` and `https` both reached `api.asksage.ai/server/get-models` (HTTP 200, 466 ms and 423 ms), no proxy. The unauthenticated call returns the model catalog (class `asksage-catalog-no-auth-required`), consistent with the catalog audit. |

## What this changes in the design

1. **PLAN §5: reasoning state can ride on the thinking part inside a tool loop.** That is where it is needed (Claude requires its signed thinking block back only during the tool loop; Gemini thought signatures and OpenAI encrypted reasoning items likewise). The signature goes in the thinking part's id or metadata. A private-MIME data part never came back, so it is not a route. Between turns thinking is dropped, which Claude does not need. The tool-call id also round-trips (E2), so the bounded side cache stays as the fallback. Still to show: several rounds, realistic signature sizes, and an installed (non-development-host) extension.
2. **Conversation id:** `modelOptions._conversationId` was present (PLAN §3.4), still to be feature-detected. `modelOptions` also carries `_enableThinking` (boolean), which shows whether Copilot wants thinking on, plus `_capturingTokenCorrelationId`, `_otelTraceContext` and `_telemetryTurn`. Request options: `requestInitiator` (a 19-character string), `toolMode`, `tools`, `modelOptions`, and the keys `includeEncryptedThinking` and `modelConfiguration` (undefined in this run).
3. **`provideTokenCount` is called constantly:** 78,070 calls across 16 chat requests in about 35 minutes (roughly 4,900 per request). Token counting must stay local and cheap, with no I/O, as PLAN §3.5 already says; it probably needs a per-text cache too.
   - **Known:** for extension-contributed models Copilot builds its tokenizer on the VS Code language-model API (`extChatEndpoint.ts`: `acquireTokenizer()` returns an `ExtensionContributedChatTokenizer` around the model), so every token measurement Copilot makes goes to the provider. Its prompt is rendered with `prompt-tsx` elements that carry priorities and token budgets (`agentPrompt.tsx`: `priority`, `flexGrow`, `TokenLimit`), which have to be measured to fit a budget.
   - **Not known:** why that comes to about 4,900 calls per request, whether it is repeated measurement of the same texts, and how much happens while idle. The smoke extension now records this (calls before and during each request, distinct versus repeated texts, sizes; no text kept). Read the "Token count calls" lines of the next report. Source snapshot: 2026-09-22, not committed.
4. **Copilot's own prompt is large:** system role 23,823 characters (about 6k tokens) and 51–52 tool definitions on every request; the largest prompt was 40,232 characters (about 10k tokens). This is the prefix that caching must pay for (PLAN §4).
5. **Proposed-API availability may differ when installed.** `LanguageModelThinkingPart` and the system message role showed as present in the development host, which enables proposed APIs for the extension under development. The research notes say the thinking class is exported at runtime with no proposal check (only its typings are proposed), so an installed extension should get it too. **Follow-up:** confirmed for the thinking class. The folder-installed copy emitted thinking parts and got them back (`phase0a-e4-loop.md`). The system role was also present in that run's requests.

## Environment

| Key | Value |
|---|---|
| extension | byok-adapter.asksage-smoke 0.1.0, install source: extension development host |
| extensionKind | ui |
| VS Code | 1.139.1 (first attempt: 1.139.0), desktop, local (no remote), win32 x64 |
| Node / Electron | 24.20.0 / 43.6.0 |
| Copilot Chat | 0.67.0 (built in) |
| workspaceTrusted | true |
| proxyEnv | none |

Settings: `extensions.allowed` = `*`, `chat.agent.enabled` = true, `chat.extensionTools.enabled` = true, `http.proxy` empty, `http.proxySupport` = override, `http.systemCertificates` = true, `http.experimental.systemCertificatesV2` = false, `http.fetchAdditionalSupport` = true, `http.proxyStrictSSL` = true.

API surface, all present in this run: `lm.registerLanguageModelChatProvider`, `lm.selectChatModels`, `lm.registerTool`, `LanguageModelTextPart`, `LanguageModelToolCallPart`, `LanguageModelToolResultPart`, `LanguageModelDataPart` (and `.json`), `LanguageModelThinkingPart` (proposed), `LanguageModelChatMessageRole.System` (proposed), `LanguageModelError`, `globalThis.fetch`.

## Requests seen by the provider

- Activations 2; model-list requests 8 (all silent); token-count calls 78,070; chat requests 16 (all `asksage-smoke-echo`), none cancelled.
- Largest prompt 40,232 characters. Last request: 20 messages, roles `{"system":1,"user":11,"assistant":8}`, characters by role `{"system":23823,"user":10202,"assistant":6207}`.
- Tool calls emitted by the provider 1; tool results received 1.
- Tools seen (52): `click_element`, `copilot_getNotebookSummary`, `create_and_run_task`, `create_directory`, `create_file`, `create_new_jupyter_notebook`, `create_new_workspace`, `drag_element`, `edit_notebook_file`, `fetch_webpage`, `file_search`, `get_errors`, `get_task_output`, `get_terminal_output`, `get_vscode_api`, `github_repo`, `github_text_search`, `grep_search`, `handle_dialog`, `hover_element`, `insert_edit_into_file`, `install_extension`, `kill_terminal`, `list_dir`, `manage_todo_list`, `memory`, `navigate_page`, `open_browser_page`, `read_file`, `read_notebook_cell_output`, `read_page`, `renderMermaidDiagram`, `replace_string_in_file`, `resolve_memory_file_uri`, `runSubagent`, `run_in_terminal`, `run_notebook_cell`, `run_playwright_code`, `run_vscode_command`, `screenshot_page`, `send_to_terminal`, `session_store_sql`, `setup_tools_createNewWorkspace`, `terminal_last_command`, `terminal_selection`, `testFailure`, `type_in_page`, `view_image`, `vscode_askQuestions`, `vscode_listCodeUsages`, `vscode_renameSymbol`, `vscode_searchExtensions_internal`.
- Other run: `smoke:error` (a `LanguageModelError` thrown by the provider) surfaced in chat as "Sorry, your request failed. Please try again." with the provider's message and a client request id in the details. That is how the budget hard stop will look.

## E4 detail (plain replies)

Twelve replies were recorded. All emitted thinking, data and usage parts without error (`ok`). Replies smk-1 to smk-6 never reappeared in a later request, so there was nothing to compare. Replies smk-7, 11, 12, 13 and 14 came back as text (`yes`) in the same chat, and in every one the thinking part, thinking id, thinking metadata and data part were `no`. smk-16 was the last reply, not yet seen again.
