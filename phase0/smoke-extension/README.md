# Ask Sage smoke test (Phase 0a)

A throwaway language-model provider that answers every chat message with a report of what VS Code sent it. It calls no API and costs nothing. It answers the go/no-go questions in `PLAN.md` §9 (Phase 0a) on the machine where the real extension will run:

| Test | Question |
|---|---|
| E1 | Do extension-contributed models appear in the chat model picker under this account's Copilot plan and org policy? |
| E2 | Will Agent mode use such a model, pass it tools, and run a tool call the model emits? |
| E3 | Can an extension be side-loaded here at all? |
| E4 | Do thinking parts and private-MIME data parts emitted by the provider come back in later requests' history? (Decides plan §5: history parts vs. the side cache.) |
| E5 | Does the extension host reach the Ask Sage host through the local proxy and TLS inspection? |

It needs VS Code 1.104 or later (the stable `LanguageModelChatProvider` API) with GitHub Copilot Chat signed in.

## 1. Load it (E3)

Pick whichever your machine allows. Nothing here needs npm.

**A. Install a `.vsix`.** Build it with VS Code's own Node, from the repository root:

```powershell
# Windows, PowerShell. For a system-wide install use "C:\Program Files\Microsoft VS Code\Code.exe".
$code = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
$env:ELECTRON_RUN_AS_NODE = "1"
& $code scripts\pack-vsix.mjs phase0\smoke-extension
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

```sh
# macOS / Linux: use the VS Code executable (Linux: /usr/share/code/code; macOS: the binary in
# "Visual Studio Code.app/Contents/MacOS/").
ELECTRON_RUN_AS_NODE=1 /usr/share/code/code scripts/pack-vsix.mjs phase0/smoke-extension
```

This writes `dist/byok-adapter.asksage-smoke-0.1.0.vsix`. Install it from the Extensions view (`...` menu → **Install from VSIX...**) or with `code --install-extension dist/byok-adapter.asksage-smoke-0.1.0.vsix`.

**B. Run it without installing.** `code --extensionDevelopmentPath="<absolute path to phase0/smoke-extension>"` opens a second window with the extension loaded.

**C. Copy the folder.** Copy `phase0/smoke-extension` to `~/.vscode/extensions/byok-adapter.asksage-smoke-0.1.0` (Windows: `%USERPROFILE%\.vscode\extensions\...`) and restart VS Code. Recent VS Code versions track installs in `extensions.json` and may ignore a folder copied in by hand; use A or B if it does not show up.

If VS Code refuses (for example "extension is not allowed" from the `extensions.allowed` policy), that is the E3 answer: record the message.

Check it loaded: **View → Output → Ask Sage Smoke** shows `activated: ...`.

## 2. Run the tests

1. **E1.** Open the Chat view and its model picker. Look for **Ask Sage Smoke Echo** and **Ask Sage Smoke Echo (128-tool limit)**. If they are missing, try **Manage Models...** in the picker and enable the "Ask Sage (smoke test)" provider. Select one, stay in **Ask** mode and send `hello`. The reply is the echo report.
2. **E2.** Switch to **Agent** mode and send `smoke:tool`. The reply lists the tools Agent mode passed. Pick a harmless read-only one and send, for example, `smoke:tool <tool name> {"filePath": "<some file in the workspace>"}` with arguments that match its schema. Approve the tool if VS Code asks. The next reply should say **E2 tool round trip works**. A tool error still counts: it proves the result came back.
3. **E4.** Send any second message in the same chat. The reply's table shows, for each earlier smoke reply, whether its text, thinking part (with id and metadata) and private data part came back.
4. **E5.** Command Palette → **Ask Sage Smoke: Test Connectivity (E5)**. Enter your tenant's API host (default `api.asksage.ai`). It sends one unauthenticated POST to `/server/get-models` through both `fetch` and Node's `https` module. `HTTP 200` with body class `asksage-auth-rejected` means Ask Sage was reached. A failure lists the error codes (e.g. `SELF_SIGNED_CERT_IN_CHAIN` for TLS inspection, `ECONNREFUSED`, `ENOTFOUND`).
5. Optional: **Ask Sage Smoke: Self-Test through vscode.lm** calls the model through the extension API instead of the chat UI.
6. **Ask Sage Smoke: Show Report** opens the full report as a markdown document.

Other chat directives: `smoke:help`, `smoke:slow` (streams for about 15 seconds; press Stop to test cancellation) and `smoke:error` (shows how VS Code displays a provider error, which is what the budget hard stop will look like).

## 3. Record the result

Review the report, replace the tenant host with its alias, and save it as `research/live/<tenant-alias>/phase0a-report.md`. The report holds no prompt text, but it does list tool names, setting values and host names. Local home-directory paths and proxy credentials are masked automatically.

Besides E1–E5, the report answers some later questions early:
- whether `modelOptions._conversationId` is present (plan §3.4 conversation ID)
- which option keys VS Code passes (e.g. anything like `requestInitiator`)
- how many tools Agent mode sends and how big Copilot's prompt is per role, which sets the scale for caching
- how often `provideTokenCount` is called

If a part type breaks chat rendering, remove it from the `asksageSmoke.emitParts` setting and rerun. **Ask Sage Smoke: Clear Findings** starts over.

## Uninstall

Extensions view → Ask Sage Smoke Test → Uninstall. The findings live in the extension's global state and go with it.
