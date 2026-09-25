# Phase 0 probes

## `catalog-audit.mjs`: model catalog audit

For one Ask Sage instance, the audit compares:
1. what the instance **declares**, from `https://<chat host>/vars.js`
2. what its **web app offers**, from the default / gov / DoD allow-lists hardcoded in the chat bundle
3. what its **API serves**, from `POST /server/get-models?format=full` plus the static `openai` and `anthropic` `/v1/models` catalogs

It then reports the mismatches: non-CUI models on a government or CUI instance, models outside the instance's allow-list, `-com` models on government instances, undocumented suffixes, alias collisions, and unpriced models.

**It only makes public, unauthenticated requests.** No API key is read or sent, and nothing is billed. It shows what an instance *lists*, not what an account can *call*. See `research/model-catalog-findings.md` for the background and caveats.

### Run it

Windows, with VS Code's bundled Node:

```powershell
$code = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
$env:ELECTRON_RUN_AS_NODE = "1"
& $code phase0\probe\catalog-audit.mjs chat.asksage.mil --alias dod
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

Anywhere with Node 22:

```sh
node phase0/probe/catalog-audit.mjs chat.asksage.ai
node phase0/probe/catalog-audit.mjs chat.<your-tenant> --alias tenant-a   # dedicated instance
node phase0/probe/catalog-audit.mjs --from research/live/tenant-a/catalog/2026-09-25   # re-audit saved snapshots
```

The markdown report goes to stdout. Snapshots and `audit.md` / `audit.json` are saved to `research/live/<alias or host>/catalog/<date>/`.

| Option | Effect |
|---|---|
| `--alias <name>` | Names the output folder and replaces the real host names in everything saved (PLAN.md §6). Use it for any non-public instance. |
| `--api <host>` | API host, when it can't be derived from `vars.js` or `chat.* → api.*` |
| `--out <dir>` | Output folder |
| `--no-save` | Print only |
| `--json` | Print the audit as JSON |
| `--from <dir>` | Re-audit saved snapshots offline |

Only the profile-related `vars.js` keys are saved. The 12 MB web app bundle is not saved; its path and SHA-256 are recorded in `meta.json`.

### Network behind a proxy or TLS inspection

Node's `fetch` ignores the system proxy unless told otherwise:
- **Proxy:** set `HTTPS_PROXY=http://proxy:port` and `NODE_USE_ENV_PROXY=1`. This needs Node 22.21 or later; check with `& $code -p process.versions.node` (with `ELECTRON_RUN_AS_NODE=1` set). On older builds, run the audit from a machine with direct access, or run it inside the extension later, which uses VS Code's proxy support.
- **TLS inspection:** set `NODE_EXTRA_CA_CERTS=<path to your org's CA bundle (PEM)>`, or run node with `--use-system-ca`.

The script prints these hints when a request fails with a matching error.

### When the web app changes

The allow-list extractor looks for the `REACT_APP_force_gov_models`, `REACT_APP_force_dod_models` and `REACT_APP_allowed_models` names, not the minified variable names, so it survives rebuilds. If Ask Sage changes the code shape, the affected list reports "not found" rather than a guess, and the checks that depend on it are skipped.
