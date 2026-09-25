# Model catalog audit: chat.asksage.com

Generated 2026-09-25T07:18:30.688Z from public, unauthenticated sources. Listed is not proof of callable: the server may still restrict models per account or organization.

## Declared profile

| Key | Value |
|---|---|
| `REACT_APP_deployment_type` | `commercial` |
| `REACT_APP_classification_level` | `cui` |
| `REACT_APP_allowed_classifications` | `` |
| `REACT_APP_allowed_models` | `` |
| `REACT_APP_customer_tenant` | `false` |
| `REACT_APP_has_government_banner` | `false` |
| `REACT_APP_hide_cui_chip` | `` |
| `REACT_APP_asksage_chat_service` | `https://api.asksage.com/server` |
| `REACT_APP_asksage_user_service` | `https://user-server-nginx.asksage.com` |

- Government/CUI-like: **yes**
- Web app's active list: **default** (79 ids)
- Served by get-models: 92 (12 flagged `cui_capable: false`)
- Web app lists: default 79, gov 73, DoD 49

| Suffix | cui_capable true | cui_capable false |
|---|---|---|
| `(none)` | 49 | 9 |
| `-com` | 8 | 3 |
| `-gov` | 16 | 0 |
| `-sec` | 1 | 0 |
| `-ts` | 6 | 0 |

## Findings

### [HIGH] 12 model(s) flagged cui_capable:false are served

The instance declares deployment_type="commercial", classification_level="cui". Ask Sage docs: non-CUI models "are not found on all instances... If you are on a CUI-compliant instance, these models will not be available."

`deepseek-v3.2-com`, `deepseek-v4-flash`, `deepseek-v4-pro`, `google-claude-fable-5`, `gpt-o3`, `gpt-o4-mini`, `groq-70b`, `groq-deepseek`, `groq-llama33`, `groq-llama4-scout`, `kimi-2.6-com`, `kimi-2.7-code-com`

### [HIGH] Government/CUI deployment runs the unrestricted default model list

vars.js sets deployment_type="commercial" but neither REACT_APP_force_gov_models, REACT_APP_force_dod_models nor REACT_APP_allowed_models, so the web app offers its default list.

### [HIGH] The web app's active list ("default") offers 5 non-CUI model(s)

These appear in the chat UI model picker for this deployment.

`gpt-o3`, `gpt-o4-mini`, `groq-70b`, `groq-llama33`, `groq-llama4-scout`

### [MEDIUM] 33 served model(s) are outside the "gov (reference: deployment is government-like but no list is forced)" allow-list

get-models is unauthenticated and, per Ask Sage docs, not filtered per environment; the server may still refuse these per account. Listed is not proof of callable.

`aws-bedrock-gpt-oss-120b-ts`, `aws-bedrock-gpt-oss-20b-ts`, `aws-bedrock-nemotron-12b-vl-ts`, `aws-bedrock-nemotron-30b-ts`, `aws-bedrock-nemotron-9b-ts`, `aws-bedrock-nemotron-super-3-120b-ts`, `aws-bedrock-titan`, `claude-haiku-4-5-com`, `claude-opus-4-7-com`, `claude-sonnet-4-6-com`, `deepseek-v3.2-com`, `deepseek-v4-flash`, `deepseek-v4-pro`, `google-claude-fable-5`, `google-gemini-3-flash-com`, `google-gemini-3.1-flash-lite-com`, `google-gemini-3.1-pro-com`, `google-gemini-3.5-flash-com`, `google-imagen-3`, `gpt-4.1-gov`, `gpt-4.1-mini-gov`, `gpt-5.4-sec`, `gpt-5.5`, `gpt-image-2-com`, `gpt-o3`, `gpt-o3-mini-gov`, `gpt-o4-mini`, `groq-70b`, `groq-deepseek`, `groq-llama33`, `groq-llama4-scout`, `kimi-2.6-com`, `kimi-2.7-code-com`

### [MEDIUM] 11 "-com" (commercial hosting / provider-direct) model(s) served on a government-like deployment

`claude-haiku-4-5-com`, `claude-opus-4-7-com`, `claude-sonnet-4-6-com`, `deepseek-v3.2-com`, `google-gemini-3-flash-com`, `google-gemini-3.1-flash-lite-com`, `google-gemini-3.1-pro-com`, `google-gemini-3.5-flash-com`, `gpt-image-2-com`, `kimi-2.6-com`, `kimi-2.7-code-com`

### [MEDIUM] Commercial deployment declares classification_level "cui"

The Instances page lists the commercial instance as "Not FedRAMP".

### [MEDIUM] 1 alias(es) map to more than one model

"default" -> aws-bedrock-claude-45-sonnet-gov, google-gemini-2.5-flash

`default`

### [MEDIUM] openai/v1/models lists 2 id(s) backed by a non-CUI model

`gpt-o3`, `gpt-o4-mini`

### [MEDIUM] openai/v1/models lists 1 id(s) that resolve to a "-com" model on a government-like deployment

`gpt-image-2-com` -> gpt-image-2-com

`gpt-image-2-com`

### [INFO] "-gov"/"-ts" model(s) served on a commercial deployment

`aws-bedrock-claude-45-sonnet-gov`, `aws-bedrock-claude-fable-5-1-gov`, `aws-bedrock-claude-opus-5-5-gov`, `aws-bedrock-grok-4-6-gov`, `aws-bedrock-nova-lite-gov`, `aws-bedrock-nova-micro-gov`, `aws-bedrock-nova-pro-gov`, `google-gemini-3.1-flash-lite-gov`, `google-gemini-3.5-flash-gov`, `gpt-4.1-gov`, `gpt-4.1-mini-gov`, `gpt-5.1-gov`, `gpt-5.6-luna-gov`, `gpt-5.6-sol-gov`, `gpt-5.6-terra-gov`, `gpt-o3-mini-gov`, `aws-bedrock-gpt-oss-120b-ts`, `aws-bedrock-gpt-oss-20b-ts`, `aws-bedrock-nemotron-12b-vl-ts`, `aws-bedrock-nemotron-30b-ts`, `aws-bedrock-nemotron-9b-ts`, `aws-bedrock-nemotron-super-3-120b-ts`

### [INFO] Model suffixes with no published definition (-ts, -sec)

Treat their data handling as unknown until Ask Sage defines them.

`aws-bedrock-gpt-oss-120b-ts`, `aws-bedrock-gpt-oss-20b-ts`, `aws-bedrock-nemotron-12b-vl-ts`, `aws-bedrock-nemotron-30b-ts`, `aws-bedrock-nemotron-9b-ts`, `aws-bedrock-nemotron-super-3-120b-ts`, `gpt-5.4-sec`

### [INFO] anthropic/v1/models lists 8 id(s) that are neither a get-models id nor an alias

The server maps these to a backing model per environment (per the BYOK docs, e.g. Commercial -> provider-direct "-com", Gov/DoD -> Vertex). Which backend, and so which hosting and CUI status, cannot be determined from public data: send exact get-models ids instead.

`claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-sonnet-4-5-vertex`, `claude-haiku-4-5`

### [INFO] anthropic/v1/models: 5 public id(s) resolve through aliases

`claude-opus-5-5` -> google-claude-opus-5-5; `claude-opus-5` -> google-claude-opus-5; `claude-sonnet-5` -> google-claude-sonnet-5; `claude-fable-5-1` -> aws-bedrock-claude-fable-5-1-gov; `claude-opus-5-5-gov` -> aws-bedrock-claude-opus-5-5-gov

`claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5-1`, `claude-opus-5-5-gov`

### [INFO] 15 id(s) in the web app lists are not served

`aws-bedrock-gemma-4-26b-a4b-gov`, `aws-bedrock-gemma-4-31b-gov`, `aws-bedrock-gemma-4-e2b-gov`, `aws-bedrock-gpt-5-6-luna-gov`, `aws-bedrock-gpt-5-6-terra-gov`, `aws-bedrock-gpt-oss-120b-gov`, `aws-bedrock-gpt-oss-20b-gov`, `aws-bedrock-grok-4-3-gov`, `aws-bedrock-nemotron-12b-vl-gov`, `aws-bedrock-nemotron-30b-gov`, `aws-bedrock-nemotron-9b-gov`, `aws-bedrock-nemotron-super-3-120b-gov`, `gemini-3-6-flash`, `google-gemini-20-flash`, `gpt-5.4-gov`

### [INFO] 10 model(s) have no token_conversion_rate

The extension must treat these as "unpriced" (plan §3.1).

`google-imagen-3`, `google-imagen-4`, `google-veo-3.1-fast`, `google-veo-3.1-generate`, `google-veo-3.1-lite`, `gpt-4.1-gov`, `gpt-4.1-mini-gov`, `gpt-5.1-gov`, `gpt-o3-mini-gov`, `llma3`

## Sources

- deployment profile: https://chat.asksage.com/vars.js
- web app bundle: https://chat.asksage.com/assets/index-1SBSfNgZ.js (sha256 be26bd9341420460...)
- model catalog: POST https://api.asksage.com/server/get-models?format=full (API host via vars.js REACT_APP_asksage_chat_service)
- fetched: 2026-09-25T07:18:30.688Z
