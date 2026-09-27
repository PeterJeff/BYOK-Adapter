# BYOK-Adapter

An Ask Sage model provider for VS Code chat: Copilot Chat talks to Ask Sage's API endpoints through a language-model provider extension instead of the built-in Custom Endpoint (BYOK) route, with working prompt caching, per-model endpoint choice, and budget and cost visibility.

The extension is plain JavaScript with no dependencies and no build step, because the machine it runs on has VS Code and nothing else. It is loaded manually.

## Status

| Phase | State |
|---|---|
| 0a Environment smoke test (E1–E5) | Passed on the dev machine: [`phase0/smoke-extension`](phase0/smoke-extension/README.md), results in [`research/live/test-tenant/`](research/live/test-tenant/phase0a-report.md). |
| 0b API probes (T0–T22) | Done on the test tenant: [`research/live/FINDINGS.md`](research/live/FINDINGS.md) (its "Still open" table is the probe queue). Tools: [`api-probe.mjs`](phase0/probe/README.md), [`catalog-audit.mjs`](phase0/probe/README.md), [`rate-sources.mjs` and `billing-probe.mjs`](research/rate-sources-investigation.md). |
| 1 CC/R skeleton, ledger, spend cap | Built (branch `claude/phase1-skeleton`). Live on the dev machine (2026-09-27): R streams with ledger costs, and the spend cap trips. Still open: a non-GPT model on CC, `force_models`, `restrictedConfigurations`. See [`requirements/REQUIREMENTS.md`](requirements/REQUIREMENTS.md) §5. |
| 2+ | Not started. |

See [`PLAN.md`](PLAN.md) for the design and the full phase plan, [`CLAUDE.md`](CLAUDE.md) for the working rules, and [`requirements/REQUIREMENTS.md`](requirements/REQUIREMENTS.md) for expectations vs. what's actually built and verified.

## Tools

- `scripts/pack-vsix.mjs <extension folder>` builds a `.vsix` with no npm, using Node 22 or newer, including the one inside VS Code:
  `ELECTRON_RUN_AS_NODE=1 <path to Code executable> scripts/pack-vsix.mjs phase0/smoke-extension`
- `scripts/run-tests.mjs` runs the `node:test` suite the same way.
