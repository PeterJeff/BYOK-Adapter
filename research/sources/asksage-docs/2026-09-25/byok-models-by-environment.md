Source: https://docs.asksage.ai/llms-full.txt (sha256 2a2c34b05c184de2..., fetched 2026-09-25), lines 13772-13932 and 14120-14126 (VS Code Copilot BYOK: Available Models by Environment, DoD drop-in note)

## Available Models by Environment

The Ask Sage models exposed through the OpenAI- and Anthropic-compatible endpoints depend on which Ask Sage environment your API key is provisioned in. The catalog below mirrors the canonical per-environment allow-lists from the Ask Sage Client (`src/config.js`) enriched with model metadata from the [Ask Sage CoreUI](https://ask-sage.ghe.com/Ask-Sage/CoreUI) shared model catalog (`src/Data/models.ts`).

Image, video, and embedding models are intentionally omitted &mdash; the VS Code Copilot Chat picker only consumes chat / reasoning / Anthropic Messages shapes.

You can always confirm what your specific account is entitled to by calling:

```bash
curl https://api.asksage.ai/server/openai/v1/models

curl https://api.asksage.ai/server/anthropic/v1/models
```

Both endpoints are unauthenticated, so no key is needed &mdash; and none should be passed, since doing so puts it in your shell history for no benefit. They report what the *deployment* serves; models can still be restricted further per organization or per user by an administrator, so treat a model appearing here as necessary but not sufficient.

**Heads up:** the live `/openai/v1/models` and `/anthropic/v1/models` endpoints currently return a static catalog that does not yet enforce per-environment filtering or expose the full set of supported IDs (including internal aliases). Treat the tables below as the source of truth for now; a Server-side fix is tracked in the Ask Sage Server repo to bring those endpoints in line.

### Commercial (SaaS) Tenants

Default profile for accounts on `api.asksage.ai` not tagged as Gov or DoD.

### Commercial &mdash; 47 chat / reasoning models
| API Shape | Public ID | Display Name | Provider / Hosting | Input Ctx | Output Ctx | Tools | Vision | Reasoning |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic Messages | `claude-opus-5` alias: `google-claude-opus-5` | Anthropic Claude Opus 5 | Google Vertex AI | 1,000,000 | 128,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-sonnet-5` alias: `google-claude-sonnet-5` | Anthropic Claude Sonnet 5 | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-haiku-4-5` alias: `claude-haiku-4-5-com` | Anthropic Claude Haiku 4.5 | Direct | 200,000 | 32,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-5` alias: `google-claude-45-opus` | Google Anthropic Claude 4.5 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-6` alias: `google-claude-46-opus` | Google Anthropic Claude 4.6 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-7` alias: `claude-opus-4-7-com` | Anthropic Claude Opus 4.7 | Direct | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-8` alias: `google-claude-48-opus` | Google Anthropic Claude 4.8 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-sonnet-4-5-vertex` alias: `google-claude-45-sonnet` | Google Anthropic Claude 4.5 Sonnet | Google Vertex AI | 200,000 | 32,768 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-sonnet-4-6` alias: `claude-sonnet-4-6-com` | Anthropic Claude Sonnet 4.6 | Direct | 200,000 | 32,768 | ✅ | ✅ | ✅ |
| Chat Completions | `aws-bedrock-gpt-oss-120b-gov` | OpenAI GPT-OSS 120B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | ✅ |
| Chat Completions | `aws-bedrock-gpt-oss-20b-gov` | OpenAI GPT-OSS 20B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | ✅ |
| Chat Completions | `aws-bedrock-nemotron-12b-vl-gov` | NVIDIA Nemotron Nano 12B v2 VL | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `aws-bedrock-nemotron-30b-gov` | NVIDIA Nemotron Nano 3 30B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nemotron-9b-gov` | NVIDIA Nemotron Nano 9B v2 | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nemotron-super-3-120b-gov` | NVIDIA Nemotron Super 3 120B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | — |
| Chat Completions | `deepseek-v3.2-com` | DeepSeek V3.2 | Direct | 128,000 | 8,192 | ✅ | — | ✅ |
| Chat Completions | `deepseek-v4-flash` | DeepSeek V4 Flash | Direct | 128,000 | 8,192 | ✅ | — | ✅ |
| Chat Completions | `google-gemini-2.5-flash` | Google Gemini 2.5 Flash | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-2.5-pro` | Google Gemini 2.5 Pro | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-3-flash-com` | Google Gemini 3 Flash | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-3.1-flash-lite-com` | Google Gemini 3.1 Flash Lite | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-3.1-pro-com` | Google Gemini 3.1 Pro | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-3.5-flash-com` | Google Gemini 3.5 Flash | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `gpt-4.1` | Azure OpenAI GPT-4.1 | Azure OpenAI (Commercial) | 128,000 | 32,768 | ✅ | ✅ | — |
| Chat Completions | `gpt-4.1-mini` | Azure OpenAI GPT-4.1-mini | Azure OpenAI (Commercial) | 128,000 | 32,768 | ✅ | ✅ | — |
| Chat Completions | `gpt-4.1-nano` | Azure OpenAI GPT-4.1-nano | Azure OpenAI (Commercial) | 128,000 | 16,384 | ✅ | ✅ | — |
| Chat Completions | `grok-4-1-fast-non-reasoning` | X.AI Grok 4.1 Fast | Direct | 256,000 | 16,384 | ✅ | ✅ | — |
| Chat Completions | `grok-4-1-fast-reasoning` | X.AI Grok 4.1 Fast (Reasoning) | Direct | 256,000 | 16,384 | ✅ | ✅ | ✅ |
| Chat Completions | `grok-4-20-non-reasoning` | X.AI Grok 4.20 (Fast) | Direct | 256,000 | 16,384 | ✅ | ✅ | — |
| Chat Completions | `grok-4-20-reasoning` | X.AI Grok 4.20 (Reasoning) | Direct | 256,000 | 16,384 | ✅ | ✅ | ✅ |
| Chat Completions | `groq-llama33` | Groq LLAMA 3.3 | Groq Cloud | 128,000 | 8,192 | — | — | — |
| Chat Completions | `groq-llama4-scout` | Groq LLAMA 4-Scout | Groq Cloud | 128,000 | 8,192 | — | — | — |
| Chat Completions | `kimi-2.6-com` | Moonshot Kimi K2.6 | Direct | 200,000 | 16,384 | ✅ | — | — |
| Chat Completions | `mistral-large-3` | Mistral Large 3 | Azure OpenAI (Commercial) | 128,000 | 32,000 | ✅ | — | — |
| Responses | `gpt-6-astra` | Azure OpenAI GPT-6 Astra | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.6-sol` | Azure OpenAI GPT-5.6 Sol | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.6-terra` | Azure OpenAI GPT-5.6 Terra | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.6-luna` | Azure OpenAI GPT-5.6 Luna | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5` | Azure OpenAI GPT-5 | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5-mini` | Azure OpenAI GPT-5-mini | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5-nano` | Azure OpenAI GPT-5-nano | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.1` | Azure OpenAI GPT-5.1 | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.2` | Azure OpenAI GPT-5.2 | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.4` | Azure OpenAI GPT-5.4 | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.4-nano` | Azure OpenAI GPT-5.4-nano | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-o1` | Azure OpenAI GPT-o1 | Azure OpenAI (Commercial) | 200,000 | 100,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-o3` | Azure OpenAI GPT-o3 | Azure OpenAI (Commercial) | 200,000 | 100,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-o3-mini` | Azure OpenAI GPT-o3-mini | Azure OpenAI (Commercial) | 200,000 | 100,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-o4-mini` | Azure OpenAI GPT-o4-mini | Azure OpenAI (Commercial) | 200,000 | 100,000 | ✅ | ✅ | ✅ |

### Gov Tenants (FedRAMP / IL2&ndash;IL4)

Profile when the tenant has `force_gov_models=true`. Superset of the commercial-equivalent models with `-gov` variants for partner models that are not yet generally available in commercial.

### Gov &mdash; 44 chat / reasoning models
| API Shape | Public ID | Display Name | Provider / Hosting | Input Ctx | Output Ctx | Tools | Vision | Reasoning |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic Messages | `claude-fable-5-1` alias: `aws-bedrock-claude-fable-5-1-gov` | Anthropic Claude Fable 5.1 | AWS Bedrock GovCloud | 1,000,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-haiku-4-5` alias: `google-claude-45-haiku` | Google Anthropic Claude 4.5 Haiku | Google Vertex AI | 200,000 | 32,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-5` alias: `google-claude-45-opus` | Google Anthropic Claude 4.5 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-6` alias: `google-claude-46-opus` | Google Anthropic Claude 4.6 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-7` alias: `google-claude-47-opus` | Google Anthropic Claude 4.7 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-8` alias: `google-claude-48-opus` | Google Anthropic Claude 4.8 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-sonnet-4-5` alias: `aws-bedrock-claude-45-sonnet-gov` | AWS Gov Bedrock Claude 4.5 Sonnet | AWS Bedrock GovCloud | 200,000 | 32,768 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-sonnet-4-5-vertex` alias: `google-claude-45-sonnet` | Google Anthropic Claude 4.5 Sonnet | Google Vertex AI | 200,000 | 32,768 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-sonnet-4-6` alias: `google-claude-46-sonnet` | Google Anthropic Claude 4.6 Sonnet | Google Vertex AI | 200,000 | 32,768 | ✅ | ✅ | ✅ |
| Chat Completions | `aws-bedrock-gpt-oss-120b-gov` | OpenAI GPT-OSS 120B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | ✅ |
| Chat Completions | `aws-bedrock-gpt-oss-20b-gov` | OpenAI GPT-OSS 20B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | ✅ |
| Chat Completions | `aws-bedrock-nemotron-12b-vl-gov` | NVIDIA Nemotron Nano 12B v2 VL | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `aws-bedrock-nemotron-30b-gov` | NVIDIA Nemotron Nano 3 30B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nemotron-9b-gov` | NVIDIA Nemotron Nano 9B v2 | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nemotron-super-3-120b-gov` | NVIDIA Nemotron Super 3 120B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nova-lite-gov` | AWS Gov Bedrock Nova Lite | AWS Bedrock GovCloud | 128,000 | 5,000 | ✅ | ✅ | — |
| Chat Completions | `aws-bedrock-nova-micro-gov` | AWS Gov Bedrock Nova Micro | AWS Bedrock GovCloud | 128,000 | 5,000 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nova-pro-gov` | AWS Gov Bedrock Nova Pro | AWS Bedrock GovCloud | 300,000 | 5,000 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-2.5-flash` | Google Gemini 2.5 Flash | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-2.5-pro` | Google Gemini 2.5 Pro | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-3.1-flash-lite-gov` | Google Gemini 3.1 Flash Lite Gov | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-3.5-flash-gov` | Google Gemini 3.5 Flash Gov | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `gpt-4.1` | Azure OpenAI GPT-4.1 | Azure OpenAI (Commercial) | 128,000 | 32,768 | ✅ | ✅ | — |
| Chat Completions | `gpt-4.1-mini` | Azure OpenAI GPT-4.1-mini | Azure OpenAI (Commercial) | 128,000 | 32,768 | ✅ | ✅ | — |
| Chat Completions | `gpt-4.1-nano` | Azure OpenAI GPT-4.1-nano | Azure OpenAI (Commercial) | 128,000 | 16,384 | ✅ | ✅ | — |
| Chat Completions | `grok-4-1-fast-non-reasoning` | X.AI Grok 4.1 Fast | Direct | 256,000 | 16,384 | ✅ | ✅ | — |
| Chat Completions | `grok-4-1-fast-reasoning` | X.AI Grok 4.1 Fast (Reasoning) | Direct | 256,000 | 16,384 | ✅ | ✅ | ✅ |
| Chat Completions | `grok-4-20-non-reasoning` | X.AI Grok 4.20 (Fast) | Direct | 256,000 | 16,384 | ✅ | ✅ | — |
| Chat Completions | `grok-4-20-reasoning` | X.AI Grok 4.20 (Reasoning) | Direct | 256,000 | 16,384 | ✅ | ✅ | ✅ |
| Chat Completions | `mistral-large-3` | Mistral Large 3 | Azure OpenAI (Commercial) | 128,000 | 32,000 | ✅ | — | — |
| Responses | `gpt-5.6-sol-gov` | Azure OpenAI GPT-5.6 Sol (Gov) | Azure OpenAI (Gov) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.6-terra-gov` | Azure OpenAI GPT-5.6 Terra (Gov) | Azure OpenAI (Gov) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.6-luna-gov` | Azure OpenAI GPT-5.6 Luna (Gov) | Azure OpenAI (Gov) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5` | Azure OpenAI GPT-5 | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5-mini` | Azure OpenAI GPT-5-mini | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5-nano` | Azure OpenAI GPT-5-nano | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.1` | Azure OpenAI GPT-5.1 | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.1-gov` | Azure Gov OpenAI GPT-5.1 | Azure OpenAI Gov | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.2` | Azure OpenAI GPT-5.2 | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.4` | Azure OpenAI GPT-5.4 | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-5.4-nano` | Azure OpenAI GPT-5.4-nano | Azure OpenAI (Commercial) | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-o1` | Azure OpenAI GPT-o1 | Azure OpenAI (Commercial) | 200,000 | 100,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-o3-mini` | Azure OpenAI GPT-o3-mini | Azure OpenAI (Commercial) | 200,000 | 100,000 | ✅ | ✅ | ✅ |

### DoD Tenants (IL5 / IL6)

**DoD operators:** only the models in this table are approved in the DoD-locked profile (`force_dod_models=true`). Calling any other model ID will return `403 model_not_allowed`. This list mirrors the canonical allow-list in Ask Sage Client `src/config.js` and is the safe set to publish in a DoD environment.

### DoD-Approved &mdash; 26 chat / reasoning models
| API Shape | Public ID | Display Name | Provider / Hosting | Input Ctx | Output Ctx | Tools | Vision | Reasoning |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic Messages | `claude-fable-5-1` alias: `aws-bedrock-claude-fable-5-1-gov` | Anthropic Claude Fable 5.1 | AWS Bedrock GovCloud | 1,000,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-haiku-4-5` alias: `google-claude-45-haiku` | Google Anthropic Claude 4.5 Haiku | Google Vertex AI | 200,000 | 32,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-5` alias: `google-claude-45-opus` | Google Anthropic Claude 4.5 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-6` alias: `google-claude-46-opus` | Google Anthropic Claude 4.6 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-7` alias: `google-claude-47-opus` | Google Anthropic Claude 4.7 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-opus-4-8` alias: `google-claude-48-opus` | Google Anthropic Claude 4.8 Opus | Google Vertex AI | 200,000 | 64,000 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-sonnet-4-5-vertex` alias: `google-claude-45-sonnet` | Google Anthropic Claude 4.5 Sonnet | Google Vertex AI | 200,000 | 32,768 | ✅ | ✅ | ✅ |
| Anthropic Messages | `claude-sonnet-4-6` alias: `google-claude-46-sonnet` | Google Anthropic Claude 4.6 Sonnet | Google Vertex AI | 200,000 | 32,768 | ✅ | ✅ | ✅ |
| Chat Completions | `aws-bedrock-gpt-oss-120b-gov` | OpenAI GPT-OSS 120B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | ✅ |
| Chat Completions | `aws-bedrock-gpt-oss-20b-gov` | OpenAI GPT-OSS 20B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | ✅ |
| Chat Completions | `aws-bedrock-nemotron-12b-vl-gov` | NVIDIA Nemotron Nano 12B v2 VL | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `aws-bedrock-nemotron-30b-gov` | NVIDIA Nemotron Nano 3 30B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nemotron-9b-gov` | NVIDIA Nemotron Nano 9B v2 | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nemotron-super-3-120b-gov` | NVIDIA Nemotron Super 3 120B | AWS Bedrock GovCloud | 131,000 | 8,192 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nova-lite-gov` | AWS Gov Bedrock Nova Lite | AWS Bedrock GovCloud | 128,000 | 5,000 | ✅ | ✅ | — |
| Chat Completions | `aws-bedrock-nova-micro-gov` | AWS Gov Bedrock Nova Micro | AWS Bedrock GovCloud | 128,000 | 5,000 | ✅ | — | — |
| Chat Completions | `aws-bedrock-nova-pro-gov` | AWS Gov Bedrock Nova Pro | AWS Bedrock GovCloud | 300,000 | 5,000 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-2.5-flash` | Google Gemini 2.5 Flash | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-2.5-pro` | Google Gemini 2.5 Pro | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-3.1-flash-lite-gov` | Google Gemini 3.1 Flash Lite Gov | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `google-gemini-3.5-flash-gov` | Google Gemini 3.5 Flash Gov | Google Vertex AI | 1,000,000 | 8,192 | ✅ | ✅ | — |
| Chat Completions | `gpt-4.1-gov` | Azure Gov OpenAI GPT-4.1 | Azure OpenAI Gov | 128,000 | 32,768 | ✅ | ✅ | — |
| Chat Completions | `gpt-4.1-mini-gov` | Azure Gov OpenAI GPT-4.1-mini | Azure OpenAI Gov | 128,000 | 32,768 | ✅ | ✅ | — |
| Responses | `gpt-5.1-gov` | Azure Gov OpenAI GPT-5.1 | Azure OpenAI Gov | 272,000 | 128,000 | ✅ | ✅ | ✅ |
| Responses | `gpt-o3-mini-gov` | Azure Gov OpenAI GPT-o3-mini | Azure OpenAI Gov | 200,000 | 100,000 | ✅ | ✅ | ✅ |

---


[... drop-in JSON omitted ...]


### DoD Drop-in

**Replace the base URL:** The `url` values below use a `YOUR-DOD-TENANT` placeholder. Before pasting this configuration into VS Code, swap that placeholder for the base URL your DoD Ask Sage tenant issued when you generated your API key. Do not point a DoD workload at the commercial endpoint.

**DoD-only:** The Claude IDs in this snippet (`claude-sonnet-4-6`, `claude-opus-4-7`) resolve to Google Vertex AI deployed inside an IL5 Assured Workloads folder &mdash; not commercial Vertex. `claude-sonnet-4-5` (which routes to AWS Bedrock GovCloud) is *not* in the `force_dod_models` allow-list, so it is omitted here.

