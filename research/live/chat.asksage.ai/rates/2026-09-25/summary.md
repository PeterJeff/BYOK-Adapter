# Rate sources: chat.asksage.ai

Fetched 2026-09-25T17:41:55.551Z by `phase0/probe/rate-sources.mjs`. Ratios only; absolute rates are in `raw/` (gitignored).

Web app bundle: `/assets/index-DcmfUYyN.js` (sha256 1853efb2a2bb2cb5…); rate table 108 rows, legacy list 130 rows.

Every ratio below is source A ÷ source B, both as Ask Sage tokens per model token (prompt / completion). 1.000 means the same price.

## API ÷ web app table (105 models; 0 API-only, 3 table-only)

| ratio | models | which |
|---|---|---|
| 0.769 / 0.769 | 75 | (many) |
| - / - | 10 | `llma3`, `google-imagen-3`, `google-imagen-4`, `google-veo-3.1-generate`, `google-veo-3.1-fast`, `google-veo-3.1-lite`, `gpt-4.1-gov`, `gpt-4.1-mini-gov`, `gpt-o3-mini-gov`, `gpt-5.1-gov` |
| 1.538 / 1.154 | 5 | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-sol`, `gpt-5.4-gov` |
| 1.538 / 1.200 | 2 | `google-claude-46-sonnet`, `claude-sonnet-4-6-com` |
| 1.538 / 1.538 | 2 | `gpt-5.4`, `gpt-5.4-sec` |
| 0.769 / - | 2 | `gpt-image-2-com`, `flux-2-pro` |
| 1.539 / 1.154 | 2 | `gpt-6-astra`, `gpt-6-luna` |
| 2.031 / 1.523 | 2 | `aws-bedrock-gpt-5-6-luna-gov`, `aws-bedrock-gpt-5-6-terra-gov` |
| 0.277 / 0.466 | 1 | `aws-bedrock-claude-45-sonnet-gov` |
| 1.923 / 1.442 | 1 | `gpt-5.6-sol-gov` |
| 1.923 / 1.443 | 1 | `gpt-5.6-terra-gov` |
| 1.923 / 1.446 | 1 | `gpt-5.6-luna-gov` |
| 1.538 / 1.192 | 1 | `claude-opus-4-7-com` |

## API ÷ legacy list (103 models)

| ratio | models | which |
|---|---|---|
| 1.000 / 1.000 | 25 | (many) |
| - / - | 14 | (many) |
| 2.000 / 1.500 | 6 | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` |
| 1.100 / 1.100 | 5 | `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning` |
| 0.500 / 0.667 | 4 | `google-claude-46-opus`, `google-claude-47-opus`, `google-claude-48-opus`, `google-claude-opus-5` |
| 0.600 / 0.900 | 2 | `aws-bedrock-nemotron-12b-vl-ts`, `aws-bedrock-nemotron-12b-vl-gov` |
| 0.234 / 0.462 | 2 | `aws-bedrock-nemotron-9b-ts`, `aws-bedrock-nemotron-9b-gov` |
| 0.087 / 0.181 | 2 | `aws-bedrock-nemotron-30b-ts`, `aws-bedrock-nemotron-30b-gov` |
| 0.090 / 0.195 | 2 | `aws-bedrock-nemotron-super-3-120b-ts`, `aws-bedrock-nemotron-super-3-120b-gov` |
| 0.090 / 0.180 | 2 | `aws-bedrock-gpt-oss-120b-ts`, `aws-bedrock-gpt-oss-120b-gov` |
| 0.132 / 0.297 | 2 | `aws-bedrock-gpt-oss-20b-ts`, `aws-bedrock-gpt-oss-20b-gov` |
| 0.990 / 1.000 | 2 | `google-gemini-2.5-flash`, `google-gemini-3-flash-com` |
| 1.000 / 0.999 | 2 | `google-gemini-3-1-flash-image`, `google-gemini-3.5-flash-com` |
| 2.500 / 1.875 | 2 | `gpt-5.6-sol-gov`, `gpt-5.6-terra-gov` |
| 0.974 / 0.988 | 2 | `groq-llama33`, `groq-deepseek` |
| 3.160 / 2.360 | 2 | `gpt-5.4`, `gpt-5.4-sec` |
| 1.439 / 1.454 | 2 | `kimi-2.6-com`, `kimi-2.7-code-com` |
| 0.733 / 0.440 | 2 | `grok-4-20-reasoning`, `grok-4-20-non-reasoning` |
| 2.640 / 1.980 | 2 | `aws-bedrock-gpt-5-6-luna-gov`, `aws-bedrock-gpt-5-6-terra-gov` |
| 1.001 / 0.994 | 1 | `aws-bedrock-nova-lite-gov` |
| 0.990 / 12.000 | 1 | `google-gemini-2.5-flash-image` |
| 1.000 / 0.996 | 1 | `google-gemini-3-pro-image` |
| 0.333 / 0.427 | 1 | `google-claude-sonnet-5` |
| 2.500 / 1.879 | 1 | `gpt-5.6-luna-gov` |
| 0.996 / 0.986 | 1 | `groq-llama4-scout` |
| 0.998 / 0.990 | 1 | `gpt-o1` |
| 0.605 / 0.968 | 1 | `gpt-o3-mini` |
| 0.220 / 0.220 | 1 | `gpt-o3` |
| 1.089 / 1.089 | 1 | `gpt-o4-mini` |
| 1.104 / 1.100 | 1 | `gpt-5` |
| 1.120 / 1.100 | 1 | `gpt-5-mini` |
| 1.200 / 1.100 | 1 | `gpt-5-nano` |
| 1.109 / 1.108 | 1 | `gpt-5.2` |
| 1.100 / 0.859 | 1 | `gpt-5.4-nano` |
| 6.319 / 4.719 | 1 | `gpt-5.5` |
| 0.727 / 0.727 | 1 | `claude-haiku-4-5-com` |
| 1.091 / 1.128 | 1 | `claude-opus-4-7-com` |
| 1.609 / 2.227 | 1 | `deepseek-v4-flash` |
| 0.080 / 0.078 | 1 | `mistral-large-3` |
| 3.160 / 1.770 | 1 | `gpt-5.4-gov` |

## Tokenizer ÷ web app table (105 models)

| ratio | models | which |
|---|---|---|
| 1.000 / 1.000 | 72 | (many) |
| 0.999 / 1.000 | 10 | `aws-bedrock-nemotron-12b-vl-ts`, `google-gemini-3.1-flash-lite-com`, `groq-70b`, `gpt-4.1-mini`, `gpt-5-mini`, `kimi-2.6-com`, `kimi-2.7-code-com`, `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`, `aws-bedrock-nemotron-12b-vl-gov` |
| 0.997 / 1.000 | 6 | `aws-bedrock-gpt-oss-20b-ts`, `gpt-4.1-nano`, `gpt-5.4-nano`, `gpt-5.6-luna`, `gpt-6-luna`, `aws-bedrock-gpt-oss-20b-gov` |
| 0.988 / 1.000 | 4 | `aws-bedrock-nemotron-9b-ts`, `aws-bedrock-nemotron-30b-ts`, `aws-bedrock-nemotron-9b-gov`, `aws-bedrock-nemotron-30b-gov` |
| 1.001 / 1.000 | 2 | `google-claude-45-haiku`, `gpt-4.1-mini-gov` |
| 0.993 / 1.000 | 1 | `aws-bedrock-nova-lite-gov` |
| 0.991 / 1.000 | 1 | `aws-bedrock-nova-micro-gov` |
| 1.500 / 1.500 | 1 | `google-claude-sonnet-5` |
| 1.251 / 1.250 | 1 | `gpt-5.6-sol-gov` |
| 2.500 / 1.876 | 1 | `gpt-5.6-terra-gov` |
| 1.271 / 1.250 | 1 | `gpt-5.6-luna-gov` |
| 0.997 / 0.999 | 1 | `groq-llama4-scout` |
| 0.987 / 1.000 | 1 | `gpt-5-nano` |
| 0.985 / 1.000 | 1 | `aws-bedrock-gemma-4-e2b-gov` |
| 1.319 / 1.320 | 1 | `aws-bedrock-gpt-5-6-luna-gov` |
| 1.320 / 1.320 | 1 | `aws-bedrock-gpt-5-6-terra-gov` |

## Tokenizer ÷ API (105 models)

| ratio | models | which |
|---|---|---|
| 1.300 / 1.300 | 45 | (many) |
| 1.299 / 1.300 | 12 | `aws-bedrock-nova-pro-gov`, `aws-bedrock-nemotron-12b-vl-ts`, `google-gemini-3.1-flash-lite-com`, `groq-70b`, `groq-llama33`, `groq-deepseek`, `gpt-4.1-mini`, `claude-haiku-4-5-com`, `deepseek-v4-flash`, `grok-4-1-fast-reasoning`, `grok-4-1-fast-non-reasoning`, `aws-bedrock-nemotron-12b-vl-gov` |
| - / - | 10 | `llma3`, `google-imagen-3`, `google-imagen-4`, `google-veo-3.1-generate`, `google-veo-3.1-fast`, `google-veo-3.1-lite`, `gpt-4.1-gov`, `gpt-4.1-mini-gov`, `gpt-o3-mini-gov`, `gpt-5.1-gov` |
| 0.650 / 0.867 | 7 | `gpt-5.6-sol-gov`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-sol`, `gpt-5.4-gov`, `aws-bedrock-gpt-5-6-terra-gov` |
| 1.296 / 1.300 | 5 | `aws-bedrock-gpt-oss-20b-ts`, `groq-llama4-scout`, `gpt-4.1-nano`, `gpt-5.4-nano`, `aws-bedrock-gpt-oss-20b-gov` |
| 1.285 / 1.300 | 4 | `aws-bedrock-nemotron-9b-ts`, `aws-bedrock-nemotron-30b-ts`, `aws-bedrock-nemotron-9b-gov`, `aws-bedrock-nemotron-30b-gov` |
| 1.301 / 1.300 | 4 | `llma3-8b`, `google-gemini-2.5-flash`, `google-gemini-2.5-flash-image`, `google-gemini-3-flash-com` |
| 0.650 / 0.833 | 2 | `google-claude-46-sonnet`, `claude-sonnet-4-6-com` |
| 0.650 / 0.650 | 2 | `gpt-5.4`, `gpt-5.4-sec` |
| 1.300 / - | 2 | `gpt-image-2-com`, `flux-2-pro` |
| 0.648 / 0.867 | 2 | `gpt-5.6-luna`, `gpt-6-luna` |
| 3.611 / 2.146 | 1 | `aws-bedrock-claude-45-sonnet-gov` |
| 1.291 / 1.300 | 1 | `aws-bedrock-nova-lite-gov` |
| 1.288 / 1.300 | 1 | `aws-bedrock-nova-micro-gov` |
| 1.950 / 1.950 | 1 | `google-claude-sonnet-5` |
| 0.661 / 0.865 | 1 | `gpt-5.6-luna-gov` |
| 1.298 / 1.300 | 1 | `gpt-5-mini` |
| 1.283 / 1.300 | 1 | `gpt-5-nano` |
| 0.650 / 0.839 | 1 | `claude-opus-4-7-com` |
| 1.280 / 1.300 | 1 | `aws-bedrock-gemma-4-e2b-gov` |
| 0.649 / 0.867 | 1 | `aws-bedrock-gpt-5-6-luna-gov` |

## Cache multipliers in the web app table (30 rows; read / 5-minute write, × prompt price)

| read / write5m | rows | which |
|---|---|---|
| 0.100 / 1.250 | 25 | (many) |
| 0.050 / 1.250 | 2 | `google-claude-opus-5-5`, `aws-bedrock-claude-opus-5-5-gov` |
| 0.100 / 1.249 | 1 | `google-claude-fable-5` |
| 0.025 / 1.249 | 1 | `aws-bedrock-claude-fable-5-1-gov` |
| 0.250 / - | 1 | `aws-bedrock-grok-4-6-gov` |
