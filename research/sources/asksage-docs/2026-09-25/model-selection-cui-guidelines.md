Source: https://docs.asksage.ai/llms-full.txt (sha256 2a2c34b05c184de2..., fetched 2026-09-25), lines 203-260

## Model

### Model Selection

Select the model you want to use for the prompt. Because the Ask Sage Platform is agnostic you will have access to the latest models available today. By default, we have an `Auto` mode which automatically selects the best model for the prompt you are utilizing.

**Auto Mode:** `Auto` is a great option for users who are unsure of which model to use, however, if you are familiar with the models and their capabilities, you can select the model you want to use for your prompt. Auto is marked **Recommended** in the model picker and routes to the newest model that fits your prompt's context window. An **Allow switching** toggle controls this behavior mid-conversation — when off, Auto stays on the model that answered your previous message instead of picking a new one for each reply.

![Ask Sage Model Selection Interface](/assets/images/asksage-platform-v2-model-selection.png)

Having the ability to choose the model you want to use for your use case is a powerful feature Ask Sage provides. If you don't see the model you want to use or have a custom model, you can always reach out to the Ask Sage team to have it added.

**Custom Models:** Enterprises/Users can request more models to be added, but additional charges may apply. Contact the Ask Sage team for more information at [support@asksage.ai](mailto:support@asksage.ai).

Click **See All Models** (or a specific model's dropdown) to open the **Browse Models** dialog, where you can search by name, sort results, and use the filter option to narrow models by the following categories:

![Browse Models dialog with search, Filters, Sort By, the Auto-route card, and model cards grouped by tier](/assets/images/asksage-platform-v2-browse-models.png)

**Capabilities**

- **Reasoning** - Models that are optimized for reasoning tasks
- **Vision** - Analyzes and understands images
- **MCP** - Models that can utilize tools (Model Context Protocol)
- **Image Generation** - Generates images based on text prompts
- **Video Generation** - Generates a video based on text prompts
- **CUI** - Sensitive-data compliant models (see [Model Security Guidelines](#model-security-guidelines))
- **Non-CUI** - Standard models not cleared for sensitive data

**Creator**

- OpenAI, Anthropic, Google, Meta, xAI, AWS, Mistral, NVIDIA, Black Forest Labs

**Model Cards:** Each model card in Browse Models also shows its provider, tier (`Flagship`, `Standard`, `Lightweight`, `Economy`, `Creative`, or `Heavy Thinking`), release date, and [context window](/asksage-platform/getting-started/conversation-context/) size, alongside its capability badges and CUI status.

-----

### Model Security Guidelines

### Security & Compliance

#### **Sensitive Data Compliant Models (CUI*)**

Models marked with an asterisk (*) are **CUI-compliant** and safe for sensitive data. The Ask Sage UI displays compliance status at the bottom of the prompt window.

**Key Features:**
- Your data is protected and never used for model training
- Available to all users (no special credentials required)
- Suitable for production use with sensitive information

**CAC/PIV Access:** While anyone can use these models, only users with CAC/PIV authentication can apply CUI labels to datasets. Or if you do not have a CAC/PIV Card, you can request activation for CUI classification by emailing [support@asksage.ai](mailto:support@asksage.ai). (Access is not granted automatically and follow on instructions will be provided to you via email.)

#### **Standard Models (Non-CUI)**

Models without the asterisk are designed for research and testing only. These models are not found on all instances of Ask Sage. If you are on a CUI-compliant instance, these models will not be available.

**Important Limitations:**
- Not recommended for sensitive data
- Data may be used for future model training
