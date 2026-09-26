# Phase 0a E4 in a multi-round tool loop: dev machine

Run 2026-09-25 on the developer's test machine (VS Code 1.139.x, signed out of Copilot), in Agent mode, with the smoke extension's `smoke:loop 3 read_file {...}` (commit 272ea06). The install source (folder install or development host) was not captured with this output; the report's E3 row and API-surface table record it. The tool input used a placeholder path, so every `read_file` call returned an error result. That does not matter here: an error result still drives the next request.

## Result

| Round | Signature in thinking metadata | Thinking back | Thinking id | Thinking metadata | Signature back unchanged | Private data part back |
|---|---|---|---|---|---|---|
| 1 | 1,024 B | yes | yes | yes | yes | no |
| 2 | 8,192 B | yes | yes | yes | yes | no |
| 3 | 65,536 B | yes | yes | yes | yes | no |

Read on the request that carried round 3's tool result: 9 messages, roles `{"system":1,"user":5,"assistant":3}`, parts `{"text":6,"thinking":3,"toolCall":3,"toolResult":3}`, 55 tools. **Every earlier round's** thinking part was in history, not only the latest one. Each round's signature came back with the same length and hash. The private-MIME data part never came back, as in the single-round run (`phase0a-report.md`).

## What it shows

- Reasoning state can ride in the thinking part's metadata through a tool loop of at least three rounds, at sizes up to 64 KB. That covers Claude signatures (hundreds of bytes to a few KB) and leaves headroom for encrypted reasoning items.
- The metadata is returned byte-for-byte, so the provider can hand a signature back to the API unchanged.
- Still to show: 5+ rounds (Phase 2's target; `smoke:loop 6` does it), an installed copy if this was the development host, and the target machine.

## Raw echo (placeholder path as sent)

```text
Tool result received for `smoke-smk-3-i7suro` (122 chars, parts [text]). **E2 tool round trip works.**
ERROR while calling tool: Invalid input path: .... Be sure to use an absolute path.

- Messages: 9, roles {"system":1,"user":5,"assistant":3}, parts {"text":6,"thinking":3,"toolCall":3,"toolResult":3}
- Prompt size by role (chars): {"system":24315,"user":3958,"assistant":561}
- Request option keys: includeEncryptedThinking: undefined, modelConfiguration: undefined, modelOptions: object, requestInitiator: string(19), toolMode: number, tools: array(55)
- modelOptions keys: _capturingTokenCorrelationId: string(36), _conversationId: string(36), _enableThinking: boolean, _otelTraceContext: object, _telemetryTurn: number

| Earlier nonce | Text | Thinking | Thinking id | Thinking metadata | Signature | Data part |
|---|---|---|---|---|---|---|
| smk-1-0v0ym3 | yes | yes | yes | yes | intact (1024 B) | no |
| smk-2-avmvdq | yes | yes | yes | yes | intact (8192 B) | no |
| smk-3-i7suro | yes | yes | yes | yes | intact (65536 B) | no |
```
