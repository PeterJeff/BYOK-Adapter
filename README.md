# BYOK-Adapter

An Ask Sage model provider for VS Code chat. Copilot Chat talks to Ask Sage's API endpoints through a language-model provider extension instead of the built-in Custom Endpoint (BYOK) route, with working prompt caching, a per-model choice of endpoint, and visibility of budget and cost.

The extension is plain JavaScript with no dependencies and no build step, because the machine it runs on has VS Code and nothing else. It is loaded manually (`src/README.md`).

## Status

| Phase | State |
|---|---|
| 0a Environment smoke test (E1–E5) | Passed on the dev machine ([`phase0/smoke-extension`](phase0/smoke-extension/README.md)) |
| 0b API probes (T0–T22) | Done on the test tenant ([`research/live/FINDINGS.md`](research/live/FINDINGS.md)); T12 is partly run |
| 1 CC/R skeleton, ledger, spend cap | Built; acceptance passed live on 2026-09-27 |
| 2 M, caching, pinning, reasoning round-trip | Built, never run live; known blockers in [`DEFECTS.md`](DEFECTS.md) |
| 3 Budget guards | Partly built, never run live |
| On-machine health report (PLAN §14) | Designed, not built |
| 4+ | Not started |

Phases 2 and 3 are on branch `claude/phase2-m-and-caching`, not yet merged.

## Documents

| File | Holds |
|---|---|
| [`PLAN.md`](PLAN.md) | The design and the phase plan (no status) |
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | Status of every expectation: built, verified, or not |
| [`DEFECTS.md`](DEFECTS.md) | Known defects and problems, not yet fixed |
| [`TODO.md`](TODO.md) | Open work, in priority order |
| [`research/live/FINDINGS.md`](research/live/FINDINGS.md) | Measured evidence, and the probe queue |
| [`src/README.md`](src/README.md) | How to load, configure and troubleshoot the extension |
| [`CLAUDE.md`](CLAUDE.md) | Working rules for Claude sessions |

## Tools

- `scripts/pack-vsix.mjs <extension folder>` builds a `.vsix` with no npm, using Node 22 or newer, including the one inside VS Code:
  `ELECTRON_RUN_AS_NODE=1 <path to Code executable> scripts/pack-vsix.mjs src`
- `scripts/run-tests.mjs` runs the `node:test` suite the same way.
