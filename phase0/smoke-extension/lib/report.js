// @ts-check
'use strict';

// Findings bookkeeping and the markdown report for Phase 0a (E1–E5).
// Pure: the extension passes in the environment facts it collected.

const MAX_EMITTED = 50;
const MAX_ERRORS = 20;
const MAX_TOKEN_REQUESTS = 20;

/**
 * @typedef {'ok' | 'unavailable' | 'disabled' | string} EmitResult
 * @typedef {{ text: boolean, thinking: boolean, thinkingId: boolean, thinkingMetadata: boolean, data: boolean }} BackFlags
 * @typedef {{ nonce: string, at: string, model: string, emit: { thinking: EmitResult, data: EmitResult, usage: EmitResult }, back: BackFlags }} EmittedRecord
 */

function createFindings() {
  return {
    version: 1,
    activations: 0,
    firstActivatedAt: /** @type {string | null} */ (null),
    lastActivatedAt: /** @type {string | null} */ (null),
    infoCalls: 0,
    infoSilentCalls: 0,
    tokenCountCalls: 0,
    // What provideTokenCount is asked to measure. No text is kept, only sizes and counts.
    tokenCount: {
      chars: 0,
      maxChars: 0,
      strings: 0,
      messages: 0,
      distinct: 0,
      startMark: 0,
      endMark: 0,
      /** `before`: calls since the previous reply finished (rendering this prompt, plus idle). `during`: calls while this reply was produced. */
      requests: /** @type {{ n: number, before: number, during: number }[]} */ ([]),
    },
    requests: 0,
    requestsByModel: /** @type {Record<string, number>} */ ({}),
    cancellations: 0,
    optionKeys: /** @type {string[]} */ ([]),
    modelOptionKeys: /** @type {string[]} */ ([]),
    conversationIdSeen: false,
    maxPromptChars: 0,
    lastRequest: /** @type {any} */ (null),
    e2: {
      requestsWithTools: 0,
      maxTools: 0,
      toolModes: /** @type {string[]} */ ([]),
      toolNames: /** @type {string[]} */ ([]),
      toolCallsEmitted: 0,
      toolResultsReceived: 0,
      lastToolResult: /** @type {null | { callId: string, chars: number, parts: string }} */ (null),
    },
    e4: {
      emitted: /** @type {EmittedRecord[]} */ ([]),
      usagePartsSeen: 0,
    },
    e5: /** @type {null | { at: string, url: string, results: any[] }} */ (null),
    selfTest: /** @type {null | { at: string, models: number, ok: boolean, detail: string }} */ (null),
    errors: /** @type {{ at: string, where: string, message: string }[]} */ ([]),
  };
}

/** @typedef {ReturnType<typeof createFindings>} Findings */

/**
 * Restores findings saved by an earlier version or session, keeping defaults
 * for anything missing.
 * @param {unknown} stored
 * @returns {Findings}
 */
function restoreFindings(stored) {
  const fresh = createFindings();
  if (!stored || typeof stored !== 'object' || /** @type {any} */ (stored).version !== fresh.version) return fresh;
  const s = /** @type {any} */ (stored);
  return { ...fresh, ...s, tokenCount: { ...fresh.tokenCount, ...s.tokenCount }, e2: { ...fresh.e2, ...s.e2 }, e4: { ...fresh.e4, ...s.e4 } };
}

/**
 * Records one provideTokenCount call.
 * @param {Findings} f
 * @param {{ chars: number, isMessage: boolean, isNew: boolean }} call `isNew`: this text was not measured before in this session
 */
function noteTokenCount(f, call) {
  const t = f.tokenCount;
  f.tokenCountCalls++;
  t.chars += call.chars;
  t.maxChars = Math.max(t.maxChars, call.chars);
  if (call.isMessage) t.messages++;
  else t.strings++;
  if (call.isNew) t.distinct++;
}

/**
 * Call when a chat request starts; returns the calls made since the previous reply finished.
 * @param {Findings} f
 */
function markRequestStart(f) {
  f.tokenCount.startMark = f.tokenCountCalls;
  return f.tokenCountCalls - f.tokenCount.endMark;
}

/**
 * Call when a chat request ends.
 * @param {Findings} f
 * @param {number} n request number
 * @param {number} before what markRequestStart returned
 */
function markRequestEnd(f, n, before) {
  const t = f.tokenCount;
  t.requests.push({ n, before, during: f.tokenCountCalls - t.startMark });
  if (t.requests.length > MAX_TOKEN_REQUESTS) t.requests.splice(0, t.requests.length - MAX_TOKEN_REQUESTS);
  t.endMark = f.tokenCountCalls;
}

/**
 * @param {Findings} f
 * @param {EmittedRecord} record
 */
function addEmitted(f, record) {
  f.e4.emitted.push(record);
  if (f.e4.emitted.length > MAX_EMITTED) f.e4.emitted.splice(0, f.e4.emitted.length - MAX_EMITTED);
}

/**
 * Merges round-trip observations into the matching emitted records (OR-wise).
 * @param {Findings} f
 * @param {Array<{ nonce: string } & BackFlags>} roundTrips
 */
function mergeRoundTrips(f, roundTrips) {
  for (const rt of roundTrips) {
    const rec = f.e4.emitted.find((r) => r.nonce === rt.nonce);
    if (!rec) continue;
    for (const k of /** @type {(keyof BackFlags)[]} */ (['text', 'thinking', 'thinkingId', 'thinkingMetadata', 'data'])) {
      if (rt[k]) rec.back[k] = true;
    }
  }
}

/**
 * @param {Findings} f
 * @param {string} where
 * @param {unknown} err
 */
function addError(f, where, err) {
  f.errors.push({ at: new Date().toISOString(), where, message: String((/** @type {any} */ (err))?.message ?? err).slice(0, 300) });
  if (f.errors.length > MAX_ERRORS) f.errors.splice(0, f.errors.length - MAX_ERRORS);
}

/**
 * @param {string[]} list
 * @param {string[]} items
 */
function addUnique(list, items) {
  for (const i of items) if (!list.includes(i)) list.push(i);
  list.sort();
}

/**
 * @typedef {'PASS' | 'PARTIAL' | 'FAIL' | 'NOT RUN'} Status
 * @typedef {{ status: Status, detail: string }} Verdict
 */

/**
 * @param {Findings} f
 * @param {{ installSource?: string }} env
 * @returns {Record<'E1' | 'E2' | 'E3' | 'E4' | 'E5', Verdict>}
 */
function deriveStatus(f, env) {
  /** @type {Verdict} */
  let e1;
  if (f.requests > 0) e1 = { status: 'PASS', detail: `A smoke model was selected and answered ${f.requests} request(s).` };
  else if (f.infoCalls > 0) e1 = { status: 'PARTIAL', detail: `VS Code asked for the model list ${f.infoCalls} time(s), but no chat request has reached the provider yet. Pick "Ask Sage Smoke Echo" in the chat model picker and send a message.` };
  else e1 = { status: 'NOT RUN', detail: 'VS Code has not asked this provider for models yet. Open the Chat view and its model picker.' };

  /** @type {Verdict} */
  let e2;
  if (f.e2.toolResultsReceived > 0) e2 = { status: 'PASS', detail: `Agent mode passed up to ${f.e2.maxTools} tools, ran a tool call emitted by the provider and returned its result.` };
  else if (f.e2.requestsWithTools > 0) e2 = { status: 'PARTIAL', detail: `Agent mode passed up to ${f.e2.maxTools} tools. Run \`smoke:tool <name> {json}\` to check the tool-call round trip.` };
  else e2 = { status: 'NOT RUN', detail: 'No request has carried tools yet. Switch the chat to Agent mode.' };

  // E3 asks whether side-loading is permitted. A local install counts (a .vsix, "Install Extension from
  // Location...", a copied folder): if VS Code policy blocked it, the extension would not be running.
  // The extension development host skips the install path, and a marketplace install is not a side-load.
  const source = env.installSource || 'unknown';
  const notInstalled = source === 'unknown' || source === 'gallery' || source.startsWith('extension development host');
  /** @type {Verdict} */
  const e3 = notInstalled
    ? { status: 'PARTIAL', detail: `The extension is loaded (install source: ${source}), but not from a local install, so this does not show that side-loading is allowed. Install it from a folder ("Developer: Install Extension from Location...") or a .vsix and rerun.` }
    : { status: 'PASS', detail: `The extension is installed and running (install source: ${source}).` };

  /** @type {Verdict} */
  let e4;
  const checked = f.e4.emitted.filter((r) => r.back.text);
  if (checked.length === 0) {
    e4 = { status: 'NOT RUN', detail: 'No earlier smoke response has come back in a later request yet. Send a second message in the same chat.' };
  } else {
    const count = (/** @type {(r: EmittedRecord) => boolean} */ pred) => checked.filter(pred).length;
    const thinkingEmitted = count((r) => r.emit.thinking === 'ok');
    const dataEmitted = count((r) => r.emit.data === 'ok');
    const thinkingBack = count((r) => r.back.thinking);
    const thinkingMeta = count((r) => r.back.thinkingMetadata);
    const dataBack = count((r) => r.back.data);
    const detail = `Of ${checked.length} earlier response(s) seen again in history: thinking part back ${thinkingBack}/${thinkingEmitted} (metadata intact ${thinkingMeta}), private data part back ${dataBack}/${dataEmitted}.`;
    if (thinkingMeta > 0 || dataBack > 0) e4 = { status: 'PASS', detail };
    else if (thinkingEmitted + dataEmitted === 0) e4 = { status: 'FAIL', detail: `${detail} Neither part type could be emitted in this VS Code; see "Emit results".` };
    else if (thinkingBack > 0) e4 = { status: 'PARTIAL', detail: `${detail} Thinking text survives but its metadata does not, so signatures cannot ride on it.` };
    else e4 = { status: 'FAIL', detail: `${detail} Reasoning state needs the side cache (plan §5 fallback).` };
  }

  /** @type {Verdict} */
  let e5;
  if (!f.e5) e5 = { status: 'NOT RUN', detail: 'Run "Ask Sage Smoke: Test Connectivity (E5)".' };
  else {
    const ok = f.e5.results.filter((r) => r.ok);
    const parts = f.e5.results.map((r) => (r.ok ? `${r.method}: HTTP ${r.status} (${r.bodyClass})` : `${r.method}: ${r.error?.map((/** @type {any} */ e) => e.code || e.name).join(' <- ')}`));
    const status = ok.length === f.e5.results.length ? 'PASS' : ok.length > 0 ? 'PARTIAL' : 'FAIL';
    e5 = { status, detail: `${f.e5.url}: ${parts.join('; ')}.` };
  }

  return { E1: e1, E2: e2, E3: e3, E4: e4, E5: e5 };
}

/** @param {unknown} v */
function cell(v) {
  return String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** @param {unknown} v */
function fmt(v) {
  if (v === undefined) return '(unset)';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/**
 * Removes local paths and proxy credentials from report text.
 * @param {string} text
 * @param {string[]} homeDirs
 */
function redactText(text, homeDirs) {
  let out = text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(:[^\s/@]*)?@/gi, '$1***@');
  for (const home of homeDirs.filter((h) => h && h.length > 3)) {
    out = out.split(home).join('~');
    out = out.split(home.replace(/\\/g, '/')).join('~');
  }
  return out;
}

/**
 * @param {Findings} f
 * @param {Record<string, any> & { installSource?: string, homeDirs?: string[], api?: Record<string, boolean>, settings?: Record<string, unknown> }} env
 */
function renderReport(f, env) {
  const v = deriveStatus(f, env);
  const L = [];
  L.push('# Ask Sage Phase 0a smoke report', '');
  L.push(`Generated ${new Date().toISOString()} by ${env.extensionId || 'the smoke extension'} ${env.extensionVersion || ''}.`, '');
  L.push('| Test | Status | Detail |', '|---|---|---|');
  const names = { E1: 'Models in picker', E2: 'Agent mode + tools', E3: 'Side-loading', E4: 'Parts round-trip', E5: 'Network reach' };
  for (const k of /** @type {(keyof typeof names)[]} */ (Object.keys(names))) {
    L.push(`| ${k} ${names[k]} | **${v[k].status}** | ${cell(v[k].detail)} |`);
  }
  L.push('', 'E1 also needs your eyes: confirm the models appear in the picker under your account and org policy, not only in this report.', '');

  L.push('## Environment', '', '| Key | Value |', '|---|---|');
  for (const [k, val] of Object.entries(env)) {
    if (['api', 'settings', 'homeDirs'].includes(k)) continue;
    L.push(`| ${cell(k)} | ${cell(fmt(val))} |`);
  }
  L.push('', '### API surface (feature detection)', '', '| API | Present |', '|---|---|');
  for (const [k, present] of Object.entries(env.api || {})) L.push(`| \`${k}\` | ${present ? 'yes' : 'no'} |`);
  L.push('', '### Relevant settings (effective values)', '', '| Setting | Value |', '|---|---|');
  for (const [k, val] of Object.entries(env.settings || {})) L.push(`| \`${k}\` | ${cell(fmt(val))} |`);

  L.push('', '## Requests seen by the provider', '');
  L.push(`- Activations: ${f.activations} (first ${f.firstActivatedAt || '-'}, last ${f.lastActivatedAt || '-'})`);
  L.push(`- Model list requests: ${f.infoCalls} (${f.infoSilentCalls} silent)`);
  L.push(`- Token count calls: ${f.tokenCountCalls}`);
  {
    const t = f.tokenCount;
    const calls = f.tokenCountCalls;
    L.push(`  - measured ${t.strings} strings and ${t.messages} message objects, ${t.chars} chars in total (largest ${t.maxChars}); ${t.distinct} distinct texts this session, so ${calls ? Math.round((1 - Math.min(t.distinct, calls) / calls) * 100) : 0}% of calls repeat a text already measured`);
    if (t.requests.length) L.push(`  - per chat request (calls before it, while it ran): ${t.requests.map((r) => `#${r.n} ${r.before}/${r.during}`).join(', ')}`);
  }
  L.push(`- Chat requests: ${f.requests} ${JSON.stringify(f.requestsByModel)}; cancelled: ${f.cancellations}`);
  L.push(`- Largest prompt: ${f.maxPromptChars} chars (about ${Math.ceil(f.maxPromptChars / 4)} tokens)`);
  L.push(`- Request option keys seen: ${f.optionKeys.join(', ') || '-'}`);
  L.push(`- \`modelOptions\` keys seen: ${f.modelOptionKeys.join(', ') || '-'}`);
  L.push(`- \`modelOptions._conversationId\` seen (plan §3.4): ${f.conversationIdSeen ? 'yes' : 'no'}`);
  if (f.lastRequest) {
    L.push(`- Last request: ${f.lastRequest.at}, model \`${f.lastRequest.model}\`, ${f.lastRequest.messages} messages, roles ${JSON.stringify(f.lastRequest.roleCounts)}, chars by role ${JSON.stringify(f.lastRequest.charsByRole)}, parts ${JSON.stringify(f.lastRequest.partCounts)}`);
  }

  L.push('', '## E2: tools', '');
  L.push(`- Requests with tools: ${f.e2.requestsWithTools}; most tools in one request: ${f.e2.maxTools}; tool modes: ${f.e2.toolModes.join(', ') || '-'}`);
  L.push(`- Tool calls emitted by the provider: ${f.e2.toolCallsEmitted}; tool results received back: ${f.e2.toolResultsReceived}`);
  if (f.e2.lastToolResult) L.push(`- Last tool result: call \`${f.e2.lastToolResult.callId}\`, ${f.e2.lastToolResult.chars} chars, parts [${f.e2.lastToolResult.parts}]`);
  if (f.e2.toolNames.length) L.push(`- Tool names seen (${f.e2.toolNames.length}): ${f.e2.toolNames.map((n) => `\`${n}\``).join(', ')}`);

  L.push('', '## E4: parts round-trip', '');
  L.push(`- \`usage\` data parts seen in history: ${f.e4.usagePartsSeen}`);
  L.push('', '| Nonce | Model | Emit thinking | Emit data | Emit usage | Text back | Thinking back | Thinking id | Thinking metadata | Data back |', '|---|---|---|---|---|---|---|---|---|---|');
  const yn = (/** @type {boolean} */ b) => (b ? 'yes' : 'no');
  for (const r of f.e4.emitted.slice(-15)) {
    L.push(`| ${r.nonce} | ${cell(r.model)} | ${cell(r.emit.thinking)} | ${cell(r.emit.data)} | ${cell(r.emit.usage)} | ${yn(r.back.text)} | ${yn(r.back.thinking)} | ${yn(r.back.thinkingId)} | ${yn(r.back.thinkingMetadata)} | ${yn(r.back.data)} |`);
  }

  L.push('', '## E5: network', '');
  if (f.e5) {
    L.push(`Probe at ${f.e5.at}: unauthenticated \`POST ${f.e5.url}\`. An HTTP 200 with "Token is invalid" means Ask Sage was reached.`, '');
    for (const r of f.e5.results) {
      if (r.ok) L.push(`- **${r.method}**: HTTP ${r.status}, ${r.contentType || 'no content-type'}, ${r.ms} ms, body class \`${r.bodyClass}\`: \`${cell(r.bodySnippet).slice(0, 200)}\``);
      else L.push(`- **${r.method}**: failed after ${r.ms} ms: ${(r.error || []).map((/** @type {any} */ e) => `${e.name}${e.code ? ` [${e.code}]` : ''}: ${cell(e.message)}`).join(' <- caused by ')}`);
    }
  } else L.push('Not run.');

  if (f.selfTest) {
    L.push('', '## Self-test through `vscode.lm`', '', `- ${f.selfTest.at}: ${f.selfTest.models} smoke model(s) visible to \`selectChatModels\`; request ${f.selfTest.ok ? 'succeeded' : 'failed'}: ${cell(f.selfTest.detail)}`);
  }

  if (f.errors.length) {
    L.push('', '## Errors', '');
    for (const e of f.errors) L.push(`- ${e.at} ${e.where}: ${cell(e.message)}`);
  }

  L.push('', '---', 'No prompt text is recorded. The report does list tool names, setting values and host names: review it before sharing, and replace the tenant host with its alias when saving it under `research/live/<tenant>/`.');
  return redactText(L.join('\n') + '\n', env.homeDirs || []);
}

module.exports = { createFindings, restoreFindings, noteTokenCount, markRequestStart, markRequestEnd, addEmitted, mergeRoundTrips, addError, addUnique, deriveStatus, redactText, renderReport };
