// @ts-check
'use strict';

// Phase 0a environment smoke test (PLAN.md §9). Registers an echo language-model
// provider that calls no API, and records what VS Code does with it so E1–E5
// can be answered on the target machine before any real work depends on them.

const vscode = require('vscode');
const https = require('https');
const os = require('os');
const inspect = require('./lib/inspect');
const report = require('./lib/report');
const { probeAll, normalizeHost } = require('./lib/connectivity');

const VENDOR = 'asksage-smoke';
const STATE_KEY = 'asksageSmoke.findings';
const CONFIG = 'asksageSmoke';

/** @type {any} vscode, with proposed members looked up without type errors */
const vs = vscode;

const MODELS = [
  {
    id: 'asksage-smoke-echo',
    name: 'Ask Sage Smoke Echo',
    family: 'asksage-smoke',
    version: '0.1.0',
    tooltip: 'Phase 0a smoke test. Echoes what VS Code sends; calls no API and costs nothing.',
    detail: 'smoke test',
    maxInputTokens: 128000,
    maxOutputTokens: 16000,
    capabilities: { toolCalling: true, imageInput: true },
  },
  {
    id: 'asksage-smoke-echo-128',
    name: 'Ask Sage Smoke Echo (128-tool limit)',
    family: 'asksage-smoke',
    version: '0.1.0',
    tooltip: 'Same echo model, declaring a numeric tool limit (capabilities.toolCalling = 128).',
    detail: 'smoke test',
    maxInputTokens: 128000,
    maxOutputTokens: 16000,
    capabilities: { toolCalling: 128, imageInput: false },
  },
];

const HELP = [
  'Smoke commands (put them anywhere in your message):',
  '- `smoke:help` shows this list.',
  '- `smoke:tool` lists the tools this request carries (Agent mode passes them).',
  '- `smoke:tool <name> {"arg": "value"}` makes the model call that tool, to test the tool round trip (E2). Pick a read-only tool.',
  `- \`smoke:loop <rounds> <name> {"arg": "value"}\` calls it that many times in a row (1 to ${inspect.MAX_LOOP_ROUNDS}), each reply carrying thinking with a larger signature in its metadata (E4 in a tool loop).`,
  '- `smoke:slow` streams for about 15 seconds; press Stop to test cancellation.',
  '- `smoke:error` throws a LanguageModelError to show how VS Code displays provider errors.',
  'Any other message gets the echo report. Send a second message in the same chat to test E4.',
].join('\n');

/** @type {import('./lib/report').Findings} */
let findings = report.createFindings();
/** @type {vscode.ExtensionContext} */
let ctx;
/** @type {vscode.LogOutputChannel} */
let log;

function save() {
  ctx.globalState.update(STATE_KEY, findings).then(undefined, (e) => log.error(`saving findings failed: ${e}`));
}

function partCtors() {
  return {
    TextPart: vs.LanguageModelTextPart,
    ToolCallPart: vs.LanguageModelToolCallPart,
    ToolResultPart: vs.LanguageModelToolResultPart,
    DataPart: vs.LanguageModelDataPart,
    ThinkingPart: vs.LanguageModelThinkingPart,
    PromptTsxPart: vs.LanguageModelPromptTsxPart,
  };
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Streams text in small chunks. Returns false if cancelled.
 * @param {string} text
 * @param {vscode.Progress<any>} progress
 * @param {vscode.CancellationToken} token
 * @param {number} delayMs
 */
async function streamText(text, progress, token, delayMs) {
  for (const chunk of text.match(/[\s\S]{1,120}/g) || []) {
    if (token.isCancellationRequested) return false;
    progress.report(new vscode.LanguageModelTextPart(chunk));
    if (delayMs > 0) await sleep(delayMs);
  }
  return !token.isCancellationRequested;
}

/**
 * Emits one optional part and reports how it went.
 * @param {string} kind
 * @param {string[]} enabled
 * @param {() => unknown} make returns the part, or undefined if the API is missing
 * @param {vscode.Progress<any>} progress
 */
function tryEmit(kind, enabled, make, progress) {
  if (!enabled.includes(kind)) return 'disabled';
  try {
    const part = make();
    if (!part) return 'unavailable';
    progress.report(part);
    return 'ok';
  } catch (e) {
    return `error: ${/** @type {Error} */ (e).message}`.slice(0, 200);
  }
}

/**
 * @param {unknown} value
 * @param {string} mime
 */
function makeJsonDataPart(value, mime) {
  const DataPart = vs.LanguageModelDataPart;
  if (typeof DataPart !== 'function') return undefined;
  if (typeof DataPart.json === 'function') return DataPart.json(value, mime);
  return new DataPart(new TextEncoder().encode(JSON.stringify(value)), mime);
}

/** Hashes of the texts provideTokenCount has measured this session (memory only). */
const measuredTexts = new Set();

/** @type {vscode.LanguageModelChatProvider} */
const provider = {
  provideLanguageModelChatInformation(options, _token) {
    findings.infoCalls++;
    if (options && options.silent) findings.infoSilentCalls++;
    save();
    log.info(`provideLanguageModelChatInformation(silent=${options && options.silent})`);
    // isUserSelectable is not in the stable typings; older builds used it to show the model in the picker.
    return MODELS.map((m) => ({ ...m, isUserSelectable: true }));
  },

  async provideTokenCount(_model, text, _token) {
    // Count what VS Code asks us to measure, and how often it is a text already measured (sizes only, no text kept).
    const isMessage = typeof text !== 'string';
    const body = isMessage ? inspect.messageText(text, partCtors()) : text;
    const key = inspect.fnv1a(body);
    const isNew = !measuredTexts.has(key);
    if (isNew && measuredTexts.size < 200000) measuredTexts.add(key);
    report.noteTokenCount(findings, { chars: body.length, isMessage, isNew });
    return Math.ceil(body.length / 4);
  },

  async provideLanguageModelChatResponse(model, messages, options, progress, token) {
    const ctors = partCtors();
    const n = ++findings.requests;
    const tokenCallsBefore = report.markRequestStart(findings);
    const nonce = inspect.makeNonce(n);
    const cfg = vscode.workspace.getConfiguration(CONFIG);
    const emitKinds = /** @type {string[]} */ (cfg.get('emitParts', ['thinking', 'data', 'usage']));
    const delayMs = /** @type {number} */ (cfg.get('chunkDelayMs', 20));

    findings.requestsByModel[model.id] = (findings.requestsByModel[model.id] || 0) + 1;
    const summary = inspect.summarizeMessages(messages, ctors);
    const promptChars = Object.values(summary.charsByRole).reduce((a, b) => a + b, 0);
    findings.maxPromptChars = Math.max(findings.maxPromptChars, promptChars);
    const optionKeys = inspect.describeKeys(options);
    const modelOptionKeys = inspect.describeKeys(options.modelOptions);
    report.addUnique(findings.optionKeys, optionKeys.map((k) => k.split(':')[0]));
    report.addUnique(findings.modelOptionKeys, modelOptionKeys.map((k) => k.split(':')[0]));
    if (options.modelOptions && '_conversationId' in options.modelOptions) findings.conversationIdSeen = true;
    findings.lastRequest = {
      at: new Date().toISOString(),
      model: model.id,
      messages: summary.count,
      roleCounts: summary.roleCounts,
      charsByRole: summary.charsByRole,
      partCounts: summary.partCounts,
    };

    const tools = options.tools || [];
    const toolMode = vs.LanguageModelChatToolMode ? (options.toolMode === vs.LanguageModelChatToolMode.Required ? 'required' : 'auto') : String(options.toolMode);
    if (tools.length > 0) {
      findings.e2.requestsWithTools++;
      findings.e2.maxTools = Math.max(findings.e2.maxTools, tools.length);
      report.addUnique(findings.e2.toolModes, [toolMode]);
      report.addUnique(findings.e2.toolNames, tools.map((t) => t.name));
    }

    // E4: did parts from earlier responses come back?
    const { roundTrips, usageParts } = inspect.scanRoundTrips(messages, ctors);
    report.mergeRoundTrips(findings, roundTrips);
    findings.e4.usagePartsSeen = Math.max(findings.e4.usagePartsSeen, usageParts);

    log.info(`request #${n} model=${model.id} ${JSON.stringify({ roles: summary.roleCounts, parts: summary.partCounts, tools: tools.length, toolMode, optionKeys, modelOptionKeys })}`);
    for (const m of summary.perMessage) log.debug(`  [${m.index}] ${m.role}${m.name ? ` (${m.name})` : ''}: ${m.parts.map((p) => `${p.kind}${p.detail ? ` ${p.detail}` : ''}`).join('; ')}`);

    const last = messages[messages.length - 1];
    const lastUser = [...messages].reverse().find((m) => inspect.roleName(m.role) === 'user');
    const lastUserText = lastUser ? inspect.messageText(lastUser, ctors) : '';
    const toolResults = last ? (last.content || []).filter((p) => inspect.classifyPart(p, ctors) === 'toolResult') : [];
    // Act on commands in a fresh user message. On a tool-result turn the only command that continues is the
    // smoke:loop that started it, until its rounds are done; the round count comes from history, so it cannot run away.
    const loopState = inspect.loopProgress(messages, ctors);
    let command = toolResults.length === 0 ? inspect.parseCommand(lastUserText) : undefined;
    if (toolResults.length > 0) {
      const origin = inspect.parseCommand(loopState.originText);
      if (origin && origin.command === 'loop' && loopState.toolResultsSince < inspect.parseLoopArgs(origin.args).rounds) command = origin;
    }

    const emitThinking = (/** @type {object} */ extra = {}) =>
      tryEmit('thinking', emitKinds, () => (typeof vs.LanguageModelThinkingPart === 'function' ? new vs.LanguageModelThinkingPart(`Smoke-test thinking for ${nonce}.`, `think-${nonce}`, { smokeNonce: nonce, ...extra }) : undefined), progress);
    const emitData = () => tryEmit('data', emitKinds, () => makeJsonDataPart({ smokeNonce: nonce }, inspect.SMOKE_MIME), progress);

    try {
      if (command && command.command === 'error') {
        save();
        const msg = 'Ask Sage smoke test: simulated provider error (smoke:error).';
        throw vs.LanguageModelError && typeof vs.LanguageModelError.Blocked === 'function' ? vs.LanguageModelError.Blocked(msg) : new Error(msg);
      }

      if (command && ((command.command === 'tool' && command.args) || command.command === 'loop')) {
        const directive = `smoke:${command.command}`;
        const { rounds, name, input, error } = command.command === 'loop' ? inspect.parseLoopArgs(command.args) : { rounds: 1, ...inspect.parseToolArgs(command.args) };
        const tool = tools.find((t) => t.name === name);
        if (error || !tool) {
          const why = error || (tools.length ? `no tool named \`${name}\` in this request` : 'this request carries no tools (switch to Agent mode)');
          await streamText(`${directive} not run: ${why}. Use \`smoke:tool\` alone to list tools.\n\n\`nonce ${nonce}\``, progress, token, delayMs);
        } else {
          // The tool-loop shape of E4: thinking, tagged text, an opaque data part and a tool call in ONE
          // reply. The next request (carrying the tool result) shows which of them come back, which is what
          // a reasoning model's signed thinking block needs during a tool loop (plan §5). The thinking
          // metadata carries a fake signature that grows each round, to show whether large values survive.
          const round = loopState.toolResultsSince + 1;
          const signature = inspect.makeSignature(nonce, inspect.signatureBytesForRound(round));
          const emit = { thinking: emitThinking({ round, ...signature }), data: 'disabled', usage: 'disabled' };
          const prefix = rounds > 1 ? `Round ${round} of ${rounds}. ` : '';
          await streamText(`${prefix}Calling \`${tool.name}\` with ${JSON.stringify(input)}.\n\n\`nonce ${nonce}\``, progress, token, delayMs);
          emit.data = emitData();
          progress.report(new vscode.LanguageModelToolCallPart(`smoke-${nonce}`, tool.name, input));
          findings.e2.toolCallsEmitted++;
          report.addEmitted(findings, {
            nonce,
            at: new Date().toISOString(),
            model: model.id,
            emit,
            back: { text: false, thinking: false, thinkingId: false, thinkingMetadata: false, signatureIntact: false, data: false },
            loop: { round, of: rounds },
            signatureBytes: emit.thinking === 'ok' ? signature.signatureBytes : undefined,
          });
          log.info(`request #${n} emitted with a tool call (round ${round}/${rounds}) ${JSON.stringify(emit)}`);
        }
        return;
      }

      // Thinking comes first, as a reasoning model's would.
      const emit = { thinking: emitThinking(), data: 'disabled', usage: 'disabled' };

      let body;
      if (command && command.command === 'help') body = HELP;
      else if (command && command.command === 'tool') {
        body = tools.length
          ? `This request carries ${tools.length} tools (mode ${toolMode}):\n\n${tools.map((t) => `- \`${t.name}\``).join('\n')}`
          : 'This request carries no tools. Switch the chat to Agent mode.';
      } else if (command && command.command === 'slow') {
        body = '';
        for (let i = 1; i <= 60; i++) {
          if (!(await streamText(`tick ${i}/60\n`, progress, token, 0))) break;
          await sleep(250);
        }
      } else {
        body = renderEcho({ n, nonce, model, summary, tools, toolMode, optionKeys, modelOptionKeys, roundTrips, toolResults, ctors, lastUserText });
      }

      const completed = await streamText(`${body}\n\n\`nonce ${nonce}\``, progress, token, delayMs);
      if (!completed) {
        findings.cancellations++;
        log.info(`request #${n} cancelled`);
      }

      emit.data = emitData();
      const inTokens = Math.ceil(promptChars / 4);
      const outTokens = Math.ceil(body.length / 4);
      emit.usage = tryEmit('usage', emitKinds, () => makeJsonDataPart({ prompt_tokens: inTokens, completion_tokens: outTokens, total_tokens: inTokens + outTokens, prompt_tokens_details: { cached_tokens: 0 } }, inspect.USAGE_MIME), progress);

      report.addEmitted(findings, { nonce, at: new Date().toISOString(), model: model.id, emit, back: { text: false, thinking: false, thinkingId: false, thinkingMetadata: false, signatureIntact: false, data: false } });
      log.info(`request #${n} emitted ${JSON.stringify(emit)}`);
    } catch (e) {
      report.addError(findings, `request #${n}`, e);
      throw e;
    } finally {
      report.markRequestEnd(findings, n, tokenCallsBefore);
      save();
    }
  },
};

/**
 * @param {{ n: number, nonce: string, model: vscode.LanguageModelChatInformation, summary: ReturnType<typeof inspect.summarizeMessages>,
 *   tools: readonly vscode.LanguageModelChatTool[], toolMode: string, optionKeys: string[], modelOptionKeys: string[],
 *   roundTrips: ReturnType<typeof inspect.scanRoundTrips>['roundTrips'], toolResults: any[], ctors: inspect.PartCtors, lastUserText: string }} a
 */
function renderEcho(a) {
  const L = [];
  L.push(`**Ask Sage smoke echo**: request #${a.n}, model \`${a.model.id}\``, '');
  if (a.toolResults.length) {
    findings.e2.toolResultsReceived++;
    const r = a.toolResults[0];
    const text = inspect.messageText({ content: [r] }, a.ctors);
    const parts = (r.content || []).map((/** @type {unknown} */ p) => inspect.classifyPart(p, a.ctors)).join(', ');
    findings.e2.lastToolResult = { callId: r.callId, chars: text.length, parts };
    L.push(`Tool result received for \`${r.callId}\` (${text.length} chars, parts [${parts}]). **E2 tool round trip works.**`, '');
    L.push('```text', text.slice(0, 400).replace(/```/g, "'''"), '```', '');
  }
  L.push(`- Messages: ${a.summary.count}, roles ${JSON.stringify(a.summary.roleCounts)}, parts ${JSON.stringify(a.summary.partCounts)}`);
  L.push(`- Prompt size by role (chars): ${JSON.stringify(a.summary.charsByRole)}`);
  const shown = a.tools.slice(0, 12).map((t) => `\`${t.name}\``).join(', ');
  L.push(`- Tools: ${a.tools.length} (mode ${a.toolMode})${a.tools.length ? `: ${shown}${a.tools.length > 12 ? ', ...' : ''}` : ''}`);
  L.push(`- Request option keys: ${a.optionKeys.join(', ') || '-'}`);
  L.push(`- modelOptions keys: ${a.modelOptionKeys.join(', ') || '-'}`);
  if (a.roundTrips.length) {
    L.push('', '| Earlier nonce | Text | Thinking | Thinking id | Thinking metadata | Signature | Data part |', '|---|---|---|---|---|---|---|');
    const yn = (/** @type {boolean} */ b) => (b ? 'yes' : 'no');
    for (const r of a.roundTrips.slice(-8)) {
      const rec = findings.e4.emitted.find((e) => e.nonce === r.nonce);
      const sig = rec && rec.signatureBytes ? `${r.signatureIntact ? 'intact' : 'no'} (${rec.signatureBytes} B)` : '-';
      L.push(`| ${r.nonce} | ${yn(r.text)} | ${yn(r.thinking)} | ${yn(r.thinkingId)} | ${yn(r.thinkingMetadata)} | ${sig} | ${yn(r.data)} |`);
    }
  } else {
    L.push('- No earlier smoke responses in this history yet. Send another message in this chat to test E4.');
  }
  L.push('', `Last user message: ${a.lastUserText.length} chars. Type \`smoke:help\` for commands, or run "Ask Sage Smoke: Show Report".`);
  return L.join('\n');
}

/** Facts about this VS Code for the report. */
function gatherEnv() {
  const ext = ctx.extension;
  const pkg = ext.packageJSON || {};
  const meta = pkg.__metadata || {};
  const conf = vscode.workspace.getConfiguration();
  const copilot = vscode.extensions.getExtension('GitHub.copilot-chat');
  const proxyEnv = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'].filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]}`);
  return {
    extensionId: ext.id,
    extensionVersion: pkg.version,
    installSource: meta.source || (ctx.extensionMode === vscode.ExtensionMode.Development ? 'extension development host' : 'local install (no source metadata)'),
    extensionPath: ext.extensionPath,
    extensionKind: ext.extensionKind === vscode.ExtensionKind.UI ? 'ui' : 'workspace',
    vscodeVersion: vscode.version,
    appName: vscode.env.appName,
    appHost: vscode.env.appHost,
    remoteName: vscode.env.remoteName || '(local)',
    uiKind: vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop',
    platform: `${process.platform} ${process.arch}`,
    node: process.versions.node,
    electron: process.versions.electron || '-',
    copilotChat: copilot ? copilot.packageJSON.version : 'not installed',
    workspaceTrusted: vscode.workspace.isTrusted,
    proxyEnv: proxyEnv.join(' ') || '-',
    homeDirs: [os.homedir(), process.env.USERPROFILE || '', process.env.HOME || ''],
    api: {
      'lm.registerLanguageModelChatProvider': typeof vs.lm?.registerLanguageModelChatProvider === 'function',
      'lm.selectChatModels': typeof vs.lm?.selectChatModels === 'function',
      'lm.registerTool': typeof vs.lm?.registerTool === 'function',
      LanguageModelTextPart: typeof vs.LanguageModelTextPart === 'function',
      LanguageModelToolCallPart: typeof vs.LanguageModelToolCallPart === 'function',
      LanguageModelToolResultPart: typeof vs.LanguageModelToolResultPart === 'function',
      LanguageModelDataPart: typeof vs.LanguageModelDataPart === 'function',
      'LanguageModelDataPart.json': typeof vs.LanguageModelDataPart?.json === 'function',
      'LanguageModelThinkingPart (proposed)': typeof vs.LanguageModelThinkingPart === 'function',
      'LanguageModelChatMessageRole.System (proposed)': vs.LanguageModelChatMessageRole?.System !== undefined,
      LanguageModelError: typeof vs.LanguageModelError === 'function',
      'globalThis.fetch': typeof globalThis.fetch === 'function',
    },
    settings: Object.fromEntries(
      ['extensions.allowed', 'chat.agent.enabled', 'chat.extensionTools.enabled', 'http.proxy', 'http.proxySupport', 'http.systemCertificates', 'http.experimental.systemCertificatesV2', 'http.fetchAdditionalSupport', 'http.proxyStrictSSL']
        .map((k) => [k, conf.get(k)])
    ),
  };
}

async function showReport() {
  const md = report.renderReport(findings, gatherEnv());
  const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function testConnectivity() {
  const configured = vscode.workspace.getConfiguration(CONFIG).get('host', 'api.asksage.ai');
  const input = await vscode.window.showInputBox({
    title: 'Ask Sage Smoke: Test Connectivity (E5)',
    prompt: 'Tenant API host. An unauthenticated POST is sent; no key is used and nothing is billed.',
    value: String(configured),
    validateInput: (v) => {
      try {
        normalizeHost(v);
        return undefined;
      } catch (e) {
        return /** @type {Error} */ (e).message;
      }
    },
  });
  if (!input) return;
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Probing ${normalizeHost(input)}…` },
    () => probeAll(input, { fetch: globalThis.fetch, https })
  );
  findings.e5 = result;
  save();
  log.info(`E5 ${JSON.stringify(result)}`);
  const v = report.deriveStatus(findings, {}).E5;
  const choice = await vscode.window.showInformationMessage(`E5 ${v.status}: ${v.detail}`, 'Show Report');
  if (choice) await showReport();
}

async function selfTest() {
  const cts = new vscode.CancellationTokenSource();
  try {
    const models = await vscode.lm.selectChatModels({ vendor: VENDOR });
    if (!models.length) {
      findings.selfTest = { at: new Date().toISOString(), models: 0, ok: false, detail: 'selectChatModels returned no smoke models' };
    } else {
      const res = await models[0].sendRequest([vscode.LanguageModelChatMessage.User('Self-test from the smoke extension.')], { justification: 'Phase 0a smoke self-test' }, cts.token);
      let text = '';
      for await (const chunk of res.text) text += chunk;
      findings.selfTest = { at: new Date().toISOString(), models: models.length, ok: true, detail: `${text.length} chars from ${models[0].id}` };
    }
  } catch (e) {
    findings.selfTest = { at: new Date().toISOString(), models: -1, ok: false, detail: String(/** @type {Error} */ (e).message || e) };
  } finally {
    cts.dispose();
  }
  save();
  vscode.window.showInformationMessage(`Self-test: ${findings.selfTest.ok ? 'OK' : 'failed'}: ${findings.selfTest.detail}`);
}

async function resetFindings() {
  const answer = await vscode.window.showWarningMessage('Clear all recorded smoke-test findings?', { modal: true }, 'Clear');
  if (answer !== 'Clear') return;
  findings = report.createFindings();
  findings.activations = 1;
  findings.firstActivatedAt = findings.lastActivatedAt = new Date().toISOString();
  save();
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  ctx = context;
  log = vscode.window.createOutputChannel('Ask Sage Smoke', { log: true });
  context.subscriptions.push(log);

  findings = report.restoreFindings(context.globalState.get(STATE_KEY));
  const now = new Date().toISOString();
  findings.activations++;
  findings.firstActivatedAt = findings.firstActivatedAt || now;
  findings.lastActivatedAt = now;
  save();
  log.info(`activated: VS Code ${vscode.version}, ${process.platform}, extension ${context.extension.id}`);

  if (typeof vs.lm?.registerLanguageModelChatProvider !== 'function') {
    report.addError(findings, 'activate', 'vscode.lm.registerLanguageModelChatProvider is missing: this VS Code is older than the stable provider API');
    save();
    vscode.window.showErrorMessage('Ask Sage Smoke: this VS Code has no language-model provider API (needs 1.104 or later). Run "Ask Sage Smoke: Show Report".');
  } else {
    try {
      context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));
    } catch (e) {
      report.addError(findings, 'registerLanguageModelChatProvider', e);
      save();
      vscode.window.showErrorMessage(`Ask Sage Smoke: provider registration failed: ${/** @type {Error} */ (e).message}`);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('asksageSmoke.showReport', showReport),
    vscode.commands.registerCommand('asksageSmoke.testConnectivity', testConnectivity),
    vscode.commands.registerCommand('asksageSmoke.selfTest', selfTest),
    vscode.commands.registerCommand('asksageSmoke.reset', resetFindings)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
