# BYOK-Adapter

An Ask Sage model provider for VS Code chat: Copilot Chat talks to Ask Sage's API endpoints through a language-model provider extension instead of the built-in Custom Endpoint (BYOK) route, with working prompt caching, per-model endpoint choice, and budget and cost visibility.

The extension is plain JavaScript with no dependencies and no build step, because the machine it runs on has VS Code and nothing else. It is loaded manually.

## Status

| Phase | State |
|---|---|
| 0a Environment smoke test (E1–E5) | Passed on the dev machine: [`phase0/smoke-extension`](phase0/smoke-extension/README.md), results in [`research/live/test-tenant/`](research/live/test-tenant/phase0a-report.md). |
| 0b API probes (T0–T21) | Built: [`api-probe.mjs`](phase0/probe/README.md) (needs a key; not yet run) and [`catalog-audit.mjs`](phase0/probe/README.md), a public model-catalog audit. Findings so far: [`research/model-catalog-findings.md`](research/model-catalog-findings.md). |
| 1+ | Not started |

See [`PLAN.md`](PLAN.md) for the design and the full phase plan, [`CLAUDE.md`](CLAUDE.md) for the working rules, and [`requirements/REQUIREMENTS.md`](requirements/REQUIREMENTS.md) for expectations vs. what's actually built and verified.

## Tools

- `scripts/pack-vsix.mjs <extension folder>` builds a `.vsix` with no npm, using any Node 18+ including the one inside VS Code:
  `ELECTRON_RUN_AS_NODE=1 <path to Code executable> scripts/pack-vsix.mjs phase0/smoke-extension`
- `scripts/run-tests.mjs` runs the `node:test` suite the same way.
