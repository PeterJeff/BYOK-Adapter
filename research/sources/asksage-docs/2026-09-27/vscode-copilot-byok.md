Source: https://docs.asksage.ai/llms-full.txt (sha256 2a2c34b05c184de2..., fetched 2026-09-27), lines 13516-13771 (VS Code Copilot BYOK: setup and configuration shapes, before the model tables), 14311-14363 (Troubleshooting) and 5044-5058 (Provider-Compatible Endpoints table). The model tables are unchanged in substance from `../2026-09-25/byok-models-by-environment.md`.

Source: /integrations/vscode-copilot-byok/

# VS Code GitHub Copilot Integration

Use Ask Sage models directly in VS Code Copilot Chat via Bring Your Own Key (BYOK)

Bring Ask Sage's models into Visual Studio Code through GitHub Copilot Chat's Bring Your Own Key (BYOK) language-model support. This integration uses VS Code's **Custom Endpoint** provider and works with the same Ask Sage API key you already use for other integrations.

---

---

**Instance-Specific Base URL:** The endpoints and configuration shown reflect the instance at [chat.asksage.ai](https://chat.asksage.ai/). The `api.` prefix and path suffix stay the same across deployments — only the instance segment in the middle changes based on which Ask Sage instance you are logging into. Always use the instance approved by your organization and applicable regulatory requirements, and match the base URL in your configuration to the instance you authenticate against.

---

## At a Glance

### What this integration does

VS Code 1.122 added a **Custom Endpoint** BYOK provider that speaks OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages. This page shows how to point that provider at Ask Sage so GPT, Claude, and Gemini-style models become first-class options in the Copilot Chat model picker &mdash; with the same security boundary, logging, and policy controls you already get from Ask Sage.

API key only &mdash; no Entra ID, no extra sign-in
Works in Commercial, Gov, and managed networks
Chat Completions, Responses, and Anthropic Messages in one provider group
Per-model reasoning effort, tool calling, and vision toggles

---

## Prerequisites

### Before you begin

- **Visual Studio Code 1.122 or later** &mdash; the Custom Endpoint provider was added in this release
- **GitHub Copilot Chat** enabled in VS Code
- An **Ask Sage API key** (from your account settings)
- Network access to the Ask Sage endpoint from your workstation
- For DoD or other managed networks, your organization-provided root certificate may need to be configured for VS Code or your OS certificate store

### Copilot Business / Enterprise users

If you are on a Copilot Business or Enterprise plan, your organization administrator must first enable the **Bring Your Own Language Model Key in VS Code** policy in GitHub Copilot policy settings. Without that policy, the Custom Endpoint flow will not appear.

---

## Step 1 &mdash; Add Ask Sage as a Custom Endpoint Provider

1. Open the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Chat: Manage Language Models**
3. Select **Add Models...**
4. Choose **Custom Endpoint**
5. Enter `Ask Sage` as the group name
6. Paste your Ask Sage API key &mdash; VS Code stores it in OS secret storage, not in the JSON file
7. Choose the default API type for the group (you can mix shapes later): **Chat Completions** &mdash; for `/openai/v1/chat/completions` models
8. **Responses** &mdash; for `/openai/v1/responses` models
9. **Messages** &mdash; for `/anthropic/v1/messages` models

![Select Custom Endpoint from Add Models](/assets/images/vscode-copilot/vscode-add-models-custom-endpoint.png)

![Create the Ask Sage group](/assets/images/vscode-copilot/vscode-create-asksage-group.png)

![Paste the Ask Sage API key](/assets/images/vscode-copilot/vscode-asksage-api-key.png)

![Choose the Ask Sage API type](/assets/images/vscode-copilot/vscode-asksage-api-type.png)

After you choose the API type, VS Code opens `chatLanguageModels.json` with a starter Ask Sage provider group and an empty model entry. The next step is filling that in.

**Do not paste a raw API key into `chatLanguageModels.json`.** Secret fields are resolved through VS Code secret storage. After you enter the key in the UI, VS Code writes an `${input:chat.lm.secret...}` reference into the file. That reference is what should live in the JSON.

---

## Step 2 &mdash; Configure Models

VS Code stores BYOK model groups as a top-level JSON array. Each entry is one provider group. Fill in the `models` array with one or more Ask Sage models. Pick the configuration shape that matches the endpoint you are calling.

**Looking for the complete model list?** The four *Option* snippets below are minimal starters. See [Available Models by Environment](#available-models-by-environment) and [Drop-in Configurations by Environment](#drop-in-configurations-by-environment) further down for full per-tenant catalogs (Commercial / Gov / DoD) and copy-paste configurations.

![VS Code starter chatLanguageModels.json](/assets/images/vscode-copilot/vscode-chat-language-models-json-starter.png)

**Responses models require `"zeroDataRetentionEnabled": true`.** Ask Sage's `/responses` endpoint is stateless. Without this model-level flag, VS Code sends a `previous_response_id` the endpoint cannot resolve, and multi-turn chat fails with `invalid_prompt` / &ldquo;Previous response with id ... not found.&rdquo; Every `apiType: "responses"` example below already includes it &mdash; add it to any Responses model you define. Chat Completions and Anthropic Messages models do not need it. See [Troubleshooting](#troubleshooting) for details.

### Option A &mdash; OpenAI Chat Completions

chatLanguageModels.json &mdash; Chat Completions

```json
[
  {
    "name": "Ask Sage",
    "vendor": "customendpoint",
    "apiKey": "${input:chat.lm.secret.example}",
    "apiType": "chat-completions",
    "models": [
      {
        "id": "gpt-4.1",
        "name": "GPT 4.1 (Ask Sage)",
        "url": "https://api.asksage.ai/server/openai/v1/chat/completions",
        "apiType": "chat-completions",
        "toolCalling": true,
        "vision": true,
        "maxInputTokens": 128000,
        "maxOutputTokens": 32768
      }
    ]
  }
]
```

### Option B &mdash; OpenAI Responses (with reasoning)

chatLanguageModels.json &mdash; Responses

```json
[
  {
    "name": "Ask Sage",
    "vendor": "customendpoint",
    "apiKey": "${input:chat.lm.secret.example}",
    "apiType": "responses",
    "models": [
      {
        "id": "gpt-6-astra",
        "name": "GPT-6 Astra (Ask Sage)",
        "url": "https://api.asksage.ai/server/openai/v1/responses",
        "apiType": "responses",
        "zeroDataRetentionEnabled": true,
        "toolCalling": true,
        "vision": true,
        "thinking": true,
        "supportsReasoningEffort": ["low", "medium", "high"],
        "reasoningEffortFormat": "responses",
        "maxInputTokens": 272000,
        "maxOutputTokens": 128000
      }
    ],
    "settings": {
      "gpt-6-astra": {
        "reasoningEffort": "high"
      }
    }
  }
]
```

### Option C &mdash; Anthropic Messages

chatLanguageModels.json &mdash; Anthropic Messages

```json
[
  {
    "name": "Ask Sage",
    "vendor": "customendpoint",
    "apiKey": "${input:chat.lm.secret.example}",
    "apiType": "messages",
    "models": [
      {
        "id": "claude-opus-5",
        "name": "Claude Opus 5 (Ask Sage)",
        "url": "https://api.asksage.ai/server/anthropic/v1/messages",
        "apiType": "messages",
        "toolCalling": true,
        "vision": true,
        "thinking": true,
        "supportsReasoningEffort": ["low", "medium", "high", "xhigh", "max"],
        "maxInputTokens": 1000000,
        "maxOutputTokens": 128000
      }
    ],
    "settings": {
      "claude-opus-5": {
        "reasoningEffort": "medium"
      }
    }
  }
]
```

### Option D &mdash; Combined (Chat Completions + Responses + Messages)

You can place all three API shapes in a single Ask Sage provider group. Set `apiType` on each individual model to override the group default.

chatLanguageModels.json &mdash; Combined (live-tested)

```json
[
  {
    "name": "Ask Sage",
    "vendor": "customendpoint",
    "apiKey": "${input:chat.lm.secret.example}",
    "models": [
      {
        "id": "gpt-4.1",
        "name": "GPT 4.1 (Ask Sage)",
        "url": "https://api.asksage.ai/server/openai/v1/chat/completions",
        "apiType": "chat-completions",
        "toolCalling": true,
        "vision": true,
        "maxInputTokens": 128000,
        "maxOutputTokens": 32768
      },
      {
        "id": "gpt-6-astra",
        "name": "GPT-6 Astra (Ask Sage)",
        "url": "https://api.asksage.ai/server/openai/v1/responses",
        "apiType": "responses",
        "zeroDataRetentionEnabled": true,
        "toolCalling": true,
        "vision": true,
        "thinking": true,
        "supportsReasoningEffort": ["low", "medium", "high"],
        "reasoningEffortFormat": "responses",
        "maxInputTokens": 272000,
        "maxOutputTokens": 128000
      },
      {
        "id": "claude-opus-5",
        "name": "Claude Opus 5 (Ask Sage)",
        "url": "https://api.asksage.ai/server/anthropic/v1/messages",
        "apiType": "messages",
        "toolCalling": true,
        "vision": true,
        "thinking": true,
        "supportsReasoningEffort": ["low", "medium", "high", "xhigh", "max"],
        "maxInputTokens": 1000000,
        "maxOutputTokens": 128000
      }
    ],
    "settings": {
      "gpt-6-astra": {
        "reasoningEffort": "high"
      },
      "claude-opus-5": {
        "reasoningEffort": "medium"
      }
    }
  }
]
```

---

## Step 3 &mdash; Verify the Configuration

1. Save `chatLanguageModels.json`
2. Open the Command Palette and run **Chat: Manage Language Models** again
3. Your configured Ask Sage models should appear in the Language Models pane
4. Open Copilot Chat, click the model picker, and pick one of the Ask Sage models
5. Send a simple prompt such as `hello world!`. A response confirms VS Code is reaching Ask Sage through the configured BYOK endpoint.

![Configured Ask Sage models in Manage Language Models](/assets/images/vscode-copilot/vscode-asksage-configured-models.png)

![Ask Sage model responding in Copilot Chat](/assets/images/vscode-copilot/vscode-asksage-chat-response.png)

---


---


### Provider-Compatible Endpoints

Ask Sage also exposes the wire formats of the major model providers under `/server/`, so existing SDKs and tools work by changing only the base URL and key. These routes accept the same Ask Sage API key as a Bearer token.

| Method | Endpoint | Description |
| :----- | :------- | :---------- |
| `POST` | `/openai/v1/chat/completions` | OpenAI Chat Completions (supports `stream: true`) &mdash; [guide](/api-documentation/OpenAI-Compatibility-Guide/) |
| `POST` | `/openai/v1/responses` | OpenAI Responses API (supports `stream: true`) |
| `POST` | `/openai/v1/embeddings` | OpenAI Embeddings |
| `GET` | `/openai/v1/models` | List models in OpenAI format |
| `GET` | `/openai/v1/models/{id}` | Retrieve one model in OpenAI format |
| `POST` | `/anthropic/v1/messages` | Anthropic Messages (supports `stream: true`) &mdash; [guide](/api-documentation/Anthropic-Compatibility-Guide/) |
| `POST` | `/anthropic/v1/messages/count_tokens` | Anthropic token counting |
| `GET` | `/anthropic/v1/models` | List Claude models in Anthropic format |
| `POST` | `/google/v1beta/models/{model}:generateContent` | Gemini generateContent &mdash; [guide](/api-documentation/Gemini-Compatibility-Guide/) |
| `POST` | `/google/v1beta/models/{model}:streamGenerateContent` | Gemini streaming |

---

## Troubleshooting

### Manage Language Models shows nothing

Make sure `chatLanguageModels.json` is a **top-level array**, not an object with a `providers` property.

**Correct:**

```json
[
  { "name": "Ask Sage", "vendor": "customendpoint" }
]
```

**Incorrect:**

```json
{
  "providers": []
}
```

### API key not found or authentication fails
- Re-enter the key through **Chat: Manage Language Models** so VS Code stores it as a secret
- Confirm the JSON contains an `${input:chat.lm.secret...}` reference for `apiKey` (not the raw key)
- Verify the Ask Sage API key is still active in your account settings
- Verify the endpoint URL matches the configured `apiType` &mdash; an Anthropic URL with `apiType: "chat-completions"` will fail authentication

### Model does not appear in the picker
- Confirm the provider group `vendor` is `customendpoint`
- Confirm each model has `id`, `name`, `url`, `toolCalling`, `vision`, `maxInputTokens`, and `maxOutputTokens`
- For agent / tool-use scenarios, the model must have `toolCalling: true` &mdash; otherwise it is hidden from the picker
- Reload the VS Code window after editing `chatLanguageModels.json` directly

### Reasoning effort does not appear in the picker
- Set `thinking: true` on the model
- Add `supportsReasoningEffort` with the effort values your endpoint accepts
- For `/responses` endpoints, set `reasoningEffortFormat: "responses"`

### Responses model fails with &ldquo;Previous response with id ... not found&rdquo;

A model with `apiType: "responses"` returns an error such as:

```json
{"code":0,"message":"Previous response with id 'resp_...' not found.","metadata":{"code":"invalid_prompt","responseId":"resp_..."}}
```

VS Code's Responses provider defaults to **stateful** mode: after the first turn it sends only the new message plus a `previous_response_id` pointer and expects the endpoint to have stored the earlier response. Ask Sage's `/responses` endpoint is **stateless** &mdash; it does not retain responses for server-side continuation &mdash; so that pointer cannot be resolved and the follow-up turn fails.

**Fix:** add `"zeroDataRetentionEnabled": true` to each `apiType: "responses"` model. VS Code then stops sending `previous_response_id` and resends the full conversation each turn (the mode this endpoint expects). This is a client-side setting, not an Ask Sage data-retention toggle &mdash; the endpoint is stateless by design and there is no server-side option to enable response retention. Chat Completions and Anthropic Messages models are unaffected.

---

