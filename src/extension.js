// @ts-check
'use strict';

// Phase 1 skeleton (PLAN.md §9): CC and R transports, the usage ledger, and the session spend
// cap. M (Claude) and G (Gemini) transports, cache breakpoints and reasoning-state round-trip
// are later phases (§7's state/, cache/, policy/, tools/ do not exist yet).

const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');

const { readSettings } = require('./config/settings');
const { createCredentials, registerCommands: registerCredentialCommands } = require('./auth/credentials');
const { createAccessTokenService } = require('./auth/accessToken');
const { createUserInfoService } = require('./auth/userInfo');
const { createCatalog } = require('./catalog');
const { createTokenizerRates } = require('./rates/tokenizer');
const { createOutputCaps } = require('./rates/outputCaps');
const { cacheRule } = require('./rates/cacheRules');
const { expectedBill } = require('./rates/formula');
const { normalize } = require('./normalize');
const { streamChatCompletions } = require('./transport/openaiChat');
const { streamResponses } = require('./transport/openaiResponses');
const { textOf, roleName } = require('./convert/messages');
const { createLedgerWriter } = require('./ledger/writer');
const { createSpendCap } = require('./budget/spendCap');
const { createBudgetService } = require('./budget/budgetService');
const { createStatusBar } = require('./ui/statusBar');
const { createLog } = require('./log');
const { toLanguageModelError, parseOutputCapTooLarge } = require('./errors');

const VENDOR = 'asksage';

/** @type {any} vscode, with optional/proposed members looked up without type errors */
const vs = vscode;

/** @type {vscode.ExtensionContext} */
let ctx;
/** @type {ReturnType<typeof createLog>} */
let log;
/** @type {ReturnType<typeof createStatusBar>} */
let statusBar;
/** @type {ReturnType<typeof createSpendCap>} */
let spendCap;
/** @type {ReturnType<typeof createLedgerWriter>} */
let ledger;

/** @type {string | null} */
let servicesKey = null;
/** @type {{ credentials: ReturnType<typeof createCredentials>, accessToken: ReturnType<typeof createAccessTokenService>,
 *   userInfo: ReturnType<typeof createUserInfoService>, catalog: ReturnType<typeof createCatalog>,
 *   tokenizerRates: ReturnType<typeof createTokenizerRates>, outputCaps: ReturnType<typeof createOutputCaps>,
 *   budgetService: ReturnType<typeof createBudgetService> } | null} */
let services = null;

function partCtors() {
  return { TextPart: vs.LanguageModelTextPart, ToolCallPart: vs.LanguageModelToolCallPart, ToolResultPart: vs.LanguageModelToolResultPart };
}

function roleEnum() {
  return vs.LanguageModelChatMessageRole || { User: 1, Assistant: 2 };
}

/**
 * Rebuilds the auth/catalog/rates stack when the tenant/host/email settings change; the JWT and
 * rate caches inside it are otherwise kept across requests.
 * @param {ReturnType<typeof readSettings>} settings
 */
function getServices(settings) {
  const key = `${settings.apiBase}::${settings.email}`;
  if (services && servicesKey === key) return services;
  const credentials = createCredentials(ctx);
  const accessToken = createAccessTokenService({ apiBase: settings.apiBase, getApiKey: credentials.getApiKey, email: settings.email });
  const userInfo = createUserInfoService({ apiBase: settings.apiBase, accessToken });
  const catalog = createCatalog({ apiBase: settings.apiBase });
  const tokenizerRates = createTokenizerRates({
    apiBase: settings.apiBase,
    accessToken,
    store: {
      get: () => ctx.globalState.get(`asksage.rates.${settings.apiBase}`),
      set: (v) => ctx.globalState.update(`asksage.rates.${settings.apiBase}`, v),
    },
  });
  const outputCaps = createOutputCaps({
    get: () => ctx.globalState.get(`asksage.outputCaps.${settings.apiBase}`),
    set: (v) => ctx.globalState.update(`asksage.outputCaps.${settings.apiBase}`, v),
  });
  const budgetService = createBudgetService({ apiBase: settings.apiBase, accessToken, userInfo });
  services = { credentials, accessToken, userInfo, catalog, tokenizerRates, outputCaps, budgetService };
  servicesKey = key;
  return services;
}

/** @param {string} text */
function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** Conversation identity for the ledger and spend cap (PLAN.md §3.4), in-memory per process. */
const conversationIds = new Map();

/**
 * @param {readonly any[]} messages
 * @param {ReturnType<typeof partCtors>} ctors
 * @param {Record<string, unknown> | undefined} modelOptions
 * @param {string} toolSetHash
 */
function conversationIdFor(messages, ctors, modelOptions, toolSetHash) {
  if (modelOptions && '_conversationId' in modelOptions) return String(modelOptions._conversationId);
  const first = messages.find((m) => roleName(m.role, roleEnum()) === 'user');
  const text = first ? textOf(first, ctors) : '';
  const key = hash(`${text}::${toolSetHash}`);
  let id = conversationIds.get(key);
  if (!id) {
    id = `${key}-${Date.now()}`;
    conversationIds.set(key, id);
  }
  return id;
}

/** @type {vscode.LanguageModelChatProvider} */
const provider = {
  async provideLanguageModelChatInformation(_options, _token) {
    const settings = readSettings(vscode);
    const { catalog } = getServices(settings);
    try {
      const models = await catalog.list();
      return models.map((m) => ({
        id: m.id,
        name: m.id,
        family: 'asksage',
        version: '0.1.0',
        tooltip: `Ask Sage: ${m.id} (${m.flavor === 'R' ? 'Responses' : 'Chat Completions'})`,
        maxInputTokens: m.limits?.max_context || 128000,
        maxOutputTokens: m.limits?.max_output || 8000,
        capabilities: { toolCalling: true, imageInput: false },
        isUserSelectable: true,
      }));
    } catch (e) {
      log.error(`provideLanguageModelChatInformation failed: ${/** @type {Error} */ (e).message}`);
      return [];
    }
  },

  async provideTokenCount(_model, text, _token) {
    const ctors = partCtors();
    const body = typeof text === 'string' ? text : textOf(text, ctors);
    return Math.ceil(body.length / 3.7); // local, fast estimate only (PLAN.md §3.5): never a remote call
  },

  async provideLanguageModelChatResponse(model, messages, options, progress, token) {
    const ctors = partCtors();
    const settings = readSettings(vscode);
    const svc = getServices(settings);
    const models = await svc.catalog.list();
    const entry = models.find((m) => m.id === model.id);
    if (!entry) throw toLanguageModelError(vscode, new Error(`Ask Sage: ${model.id} is not in this tenant's catalog`));
    const apiKey = await svc.credentials.getApiKey();
    if (!apiKey) throw toLanguageModelError(vscode, new Error('Ask Sage: no API key set (run "Ask Sage: Set API Key")'));

    const tools = options.tools || [];
    const toolSetHash = hash([...tools].map((t) => t.name).sort().join(','));
    const conversationId = conversationIdFor(messages, ctors, options.modelOptions, toolSetHash);

    try {
      spendCap.check(conversationId);
    } catch (e) {
      throw toLanguageModelError(vscode, /** @type {Error} */ (e));
    }

    /** @param {number | undefined} maxOutputTokens */
    async function runOnce(maxOutputTokens) {
      let streamedAnything = false;
      const streamOpts = {
        apiBase: settings.apiBase,
        apiKey,
        model: model.id,
        messages,
        ctors,
        roleEnum: roleEnum(),
        tools,
        maxOutputTokens,
        onText: (/** @type {string} */ text) => {
          streamedAnything = true;
          progress.report(new vs.LanguageModelTextPart(text));
        },
        onToolCall: (/** @type {{ callId: string, name: string, input: unknown }} */ call) => {
          streamedAnything = true;
          progress.report(new vs.LanguageModelToolCallPart(call.callId, call.name, call.input));
        },
        token,
      };
      const result = entry.flavor === 'R' ? await streamResponses(streamOpts) : await streamChatCompletions(streamOpts);
      return { result, streamedAnything };
    }

    const started = Date.now();
    // PLAN.md §3.5: always send an explicit output cap, never rely on the server default. But
    // the catalog's limits.max_output can't be trusted (77 of 105 models on the public catalog
    // report one within 70% of max_context, and gpt-5.6-luna's 900000 was rejected outright by a
    // server that actually caps at 32768) -- start from it, but learn and remember the real cap
    // from a rejection instead of failing every request to that model forever.
    let maxOutputTokens = svc.outputCaps.get(model.id, model.maxOutputTokens);
    let { result, streamedAnything } = await runOnce(maxOutputTokens);
    if (result.error && !streamedAnything) {
      const corrected = parseOutputCapTooLarge(result.error);
      if (corrected && corrected !== maxOutputTokens) {
        log.warn(`Ask Sage: ${model.id} rejected max output ${maxOutputTokens}; retrying once at ${corrected} (its catalog limits.max_output is wrong)`);
        svc.outputCaps.correct(model.id, corrected);
        maxOutputTokens = corrected;
        ({ result, streamedAnything } = await runOnce(maxOutputTokens));
      }
    }
    const latencyMs = Date.now() - started;
    const cancelled = !!token.isCancellationRequested;

    if (result.transportError && !cancelled) throw toLanguageModelError(vscode, result.transportError);
    if (result.error) throw toLanguageModelError(vscode, new Error(result.error.message));

    const norm = normalize(entry.flavor, result.usage);
    /** @type {number | null} */
    let estAsCost = null;
    let rateSource = 'none';
    if (norm) {
      try {
        const rate = await svc.tokenizerRates.rateFor(entry);
        rateSource = rate.source;
        estAsCost = expectedBill(norm, rate, cacheRule(entry.flavor, model.id));
      } catch (e) {
        log.warn(`rate lookup failed for ${model.id}: ${/** @type {Error} */ (e).message}`);
      }
    }
    if (typeof estAsCost === 'number') spendCap.record(conversationId, estAsCost);

    ledger.append({
      ts: new Date().toISOString(),
      conversationId,
      tenant: settings.tenant,
      model: model.id,
      resolvedModel: result.resolvedModel,
      flavor: entry.flavor,
      inputUncached: norm?.inputUncached ?? 0,
      cacheRead: norm?.cacheRead ?? 0,
      // CC/R report an unsplit write (no 5m/1h distinction, unlike M's TTL split) into
      // cacheWriteUnsplit; fold it into cacheWrite5m for the ledger since expectedBill() already
      // prices it at the write5m multiplier (src/rates/formula.js). Dropping it here previously
      // made real cache writes invisible in the ledger even though they were billed correctly.
      cacheWrite5m: (norm?.cacheWrite5m ?? 0) + (norm?.cacheWriteUnsplit ?? 0),
      cacheWrite1h: norm?.cacheWrite1h ?? 0,
      visibleOutput: norm?.visibleOutput ?? 0,
      thinking: norm?.thinking ?? 0,
      thinkingUnknown: norm?.thinkingUnknown ?? false,
      estAsCost,
      rateSource,
      latencyMs,
      status: cancelled ? 'cancelled' : 'ok',
      errorClass: null,
      cancelled,
      toolCallCount: 0,
    });

    if (typeof vs.LanguageModelDataPart?.json === 'function' && norm) {
      const promptTokens = norm.inputUncached + norm.cacheRead + norm.cacheWrite5m + norm.cacheWrite1h;
      const completionTokens = norm.visibleOutput + norm.thinking;
      try {
        // Internal Copilot convention (undocumented shape), feature-detected; failure is silent (PLAN.md §3.4).
        progress.report(vs.LanguageModelDataPart.json({ prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }, 'usage'));
      } catch {
        // ignore
      }
    }

    statusBar.update({ lastCostAs: estAsCost });
  },
};

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  ctx = context;
  log = createLog(vscode);
  context.subscriptions.push(log.channel);
  statusBar = createStatusBar(vscode);
  const settings = readSettings(vscode);
  spendCap = createSpendCap({ sessionCapTokens: settings.sessionCapTokens, hourlyCapTokens: settings.hourlyCapTokens });
  ledger = createLedgerWriter(path.join(context.globalStorageUri.fsPath, 'ledger'));

  if (typeof vs.lm?.registerLanguageModelChatProvider !== 'function') {
    log.error('vscode.lm.registerLanguageModelChatProvider is missing: this VS Code is older than the stable provider API (needs 1.104 or later)');
    vscode.window.showErrorMessage('Ask Sage: this VS Code has no language-model provider API (needs 1.104 or later).');
  } else {
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));
  }

  const credentials = createCredentials(context);
  context.subscriptions.push(...registerCredentialCommands(vscode, credentials));
  context.subscriptions.push(
    vscode.commands.registerCommand('asksage.showStatus', async () => {
      try {
        const svc = getServices(readSettings(vscode));
        const status = await svc.budgetService.getStatus();
        statusBar.update({ remaining: status.remaining });
        vscode.window.showInformationMessage(`Ask Sage: ${status.remaining ?? '?'} of ${status.maxTokens ?? '?'} tokens remaining this month.`);
      } catch (e) {
        vscode.window.showErrorMessage(`Ask Sage: ${/** @type {Error} */ (e).message}`);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate, VENDOR };
