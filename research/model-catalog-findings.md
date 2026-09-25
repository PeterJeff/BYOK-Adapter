# Ask Sage model catalogs: naming, per-instance rules, and mismatches

Findings from 2026-09-25, gathered from public, unauthenticated sources only (no API key, nothing billed). The evidence is in this repo:

- `research/live/chat.asksage.ai/catalog/2026-09-25/` and `research/live/chat.asksage.com/catalog/2026-09-25/`: snapshots and audit reports from `phase0/probe/catalog-audit.mjs`
- `research/sources/asksage-docs/2026-09-25/`: extracts of the doc pages quoted below, plus the published OpenAPI specs

Re-run the audit to refresh the evidence (`phase0/probe/README.md`). Other instances were not reachable from the environment where this was written. Run the audit from a machine that can reach them.

**The key caveat:** everything here shows what instances *declare and list*. None of it shows what an authenticated account can actually call. The server may still restrict models per account or organization. Confirming that takes an authenticated request, and for a non-CUI model on a CUI instance that request is itself the thing to avoid. That decision belongs to the account owner or the Ask Sage administrator.

## 1. Model naming

No Ask Sage page defines the naming scheme. What the docs support:

| Part | Meaning | Source |
|---|---|---|
| `google-` | Hosted on Google Vertex AI (including Claude: `google-claude-48-opus`) | BYOK "Available Models by Environment", Provider / Hosting column |
| `aws-bedrock-` | AWS Bedrock; GovCloud when the name ends in `-gov` | same |
| `groq-` | Groq Cloud | same |
| plain `gpt-*` | Azure OpenAI (Commercial) | same |
| `-gov` | Government infrastructure (Azure Gov, AWS GovCloud, Vertex gov) | same; Gemini guide: "commercial hosting (`-gov` variant on government infrastructure)" |
| `-com` | Commercial hosting. "Direct" (the provider's own API) for Claude, DeepSeek and Kimi; commercial Vertex for Gemini | same |
| Sol / Terra / Luna / Astra | OpenAI's own model names, not Ask Sage tiers | Model System Cards page |
| `-ts`, `-sec` | **Not defined anywhere.** `gpt-5.4-sec` is described only as a "Security-focused variant" | - |

**Public IDs resolve differently per environment.** A public ID such as `claude-opus-4-7` goes to `claude-opus-4-7-com` (Anthropic direct) for Commercial accounts, but to `google-claude-47-opus` (Vertex) for Gov and DoD accounts. The DoD note adds that on the DoD tenant those Vertex models run "inside an IL5 Assured Workloads folder". So one ID can mean a different backend per instance. These bare public IDs are not IDs or aliases in `get-models`. The server resolves them, and public data cannot tell you which backend you get.

## 2. Where the per-instance rules are exposed

| Source | What it exposes |
|---|---|
| `POST /server/get-models?format=full` (public server spec) | Per model: `cui_capable`, `vendor`, `aliases`, `limits`, `deprecation`, `paid_only`, `token_conversion_rate` (prompt and completion) |
| `https://chat.<instance>/vars.js` | The deployment profile (`window.RUNTIME_VARS`): `REACT_APP_deployment_type`, `REACT_APP_classification_level`, `REACT_APP_allowed_models`, `REACT_APP_force_gov_models`, `REACT_APP_force_dod_models`, service URLs |
| Chat web app bundle (`/assets/index-*.js`) | Three hardcoded allow-lists: **default** (79 IDs), **gov** (73), **DoD** (49). A non-empty `allowed_models` wins, then DoD, then gov, otherwise default |
| User API spec | Organization-level `force_models`: "Comma-separated string of model names the organization is restricted to". One schema mistypes it as a boolean. **`force_gov_models` and `force_dod_models` do not appear in the public API specs.** |
| BYOK docs | Per-environment tables that cite internal sources (`Ask Sage Client src/config.js`, CoreUI `models.ts` on `ask-sage.ghe.com`). They state that `/openai/v1/models` and `/anthropic/v1/models` "return a static catalog that does not yet enforce per-environment filtering" |

## 3. What the two public SaaS instances show

The Instances page says `chat.asksage.com` is Commercial ("Not FedRAMP"), `chat.asksage.ai` is Government ("FedRAMP (Class D)") and `chat.asksage.mil` is DoD (IL5). Yet the API docs use `api.asksage.ai` as the "commercial" example throughout.

### `chat.asksage.ai` (Government, FedRAMP Class D)
- `vars.js`: `deployment_type = government`, government banner on, and **no** `force_gov_models`, `force_dod_models` or `allowed_models`. The web app therefore offers its **default** list, not the gov list.
- **The default list includes 5 models the API flags `cui_capable: false`:** `gpt-o3`, `gpt-o4-mini`, `groq-70b`, `groq-llama33` and `groq-llama4-scout`.
- **`get-models` serves 12 `cui_capable: false` models:** `deepseek-v3.2-com`, `deepseek-v4-flash`, `deepseek-v4-pro`, `google-claude-fable-5`, `gpt-o3`, `gpt-o4-mini`, `groq-70b`, `groq-deepseek`, `groq-llama33`, `groq-llama4-scout`, `kimi-2.6-com` and `kimi-2.7-code-com`. The docs say non-CUI models "are not found on all instances... If you are on a CUI-compliant instance, these models will not be available."
- **It serves 34 models outside the web app's own gov list.** These include all 11 `-com` models, the six undocumented `-ts` models, `gpt-5.4-sec`, and the non-CUI models above.
- **`openai/v1/models` lists two non-CUI models** (`gpt-o3`, `gpt-o4-mini`).

### `chat.asksage.com` (Commercial, "Not FedRAMP")
- `vars.js`: `deployment_type = commercial`, but also `classification_level = cui`.
- It serves 16 `-gov` and 6 `-ts` models, and the same 12 non-CUI models as `.ai`. That the non-CUI set is identical on both hosts suggests the catalog is not filtered per instance.

### Both
- **The alias `default` maps to two models:** `aws-bedrock-claude-45-sonnet-gov` and `google-gemini-2.5-flash`.
- **10 models have no `token_conversion_rate`:** the image and video models, `llma3`, and the Azure Gov `gpt-4.1-gov`, `gpt-4.1-mini-gov`, `gpt-5.1-gov` and `gpt-o3-mini-gov`.
- **The docs contradict themselves on limits.** The OpenClaw guide gives `gpt-5.4` 170K context / 32,768 output; the BYOK guide gives 272K / 128K. The OpenClaw gov section says "FedRAMP Class D & DoD IL5/IL6"; the BYOK Gov table is headed "IL2–IL4".

## 4. What this means for the extension (PLAN.md)

- **§2.3 / §6 catalog:** never build the model picker from `get-models` alone.
  - Key the catalog by instance host plus account profile.
  - Intersect it with the organization's `force_models`.
  - On a government-like instance (per `vars.js`), hide `cui_capable: false` models by default.
  - Treat `-ts`, `-sec` and anything unflagged as unknown data handling, and hide them in restricted workspaces.
  - Show vendor, hosting and CUI status in the picker.
- **Always send exact `get-models` IDs.** Never send bare public IDs like `claude-opus-4-7` or aliases like `default`: the server resolves those per environment, which the extension cannot see.
- **§3.1 rates:** `get-models?format=full` does serve `token_conversion_rate` for prompt and completion, so the "no API endpoint serves them" line is outdated. Cache, thinking and long-context rates still come only from the web app's table.
- **T0:** record whether `validate_token_with_full_user` returns `force_models`, `force_gov_models` or `force_dod_models` for the account.
- **Run the audit** on every tenant the extension will target, including any dedicated instances, before choosing that tenant's defaults.

## 5. Questions for Ask Sage support

1. Should `chat.asksage.ai` (FedRAMP Class D) set `force_gov_models`? Are `cui_capable: false` models callable there by default?
2. What do `-ts` and `-sec` mean, and where are those models hosted?
3. Is there a supported, per-environment, machine-readable catalog that reflects what an account can actually call, including cache, thinking and long-context rates?
4. Which limits are correct where the guides disagree? Is the `default` alias collision intended?
