// @ts-check
'use strict';

// Phase 2 (PLAN.md §9): adds the M (Claude/Anthropic Messages) transport, cache breakpoints,
// pinned tool lists and thinking config, and the reasoning-state round-trip on top of Phase 1's
// CC/R transports, usage ledger, and session spend cap.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { readSettings } = require('./config/settings');
const { createCredentials, registerCommands: registerCredentialCommands } = require('./auth/credentials');
const { createAccessTokenService } = require('./auth/accessToken');
const { createUserInfoService } = require('./auth/userInfo');
const { createPromptLogService } = require('./auth/promptLog');
const { createCatalog } = require('./catalog');
const { createTokenizerRates } = require('./rates/tokenizer');
const { createOutputCaps } = require('./rates/outputCaps');
const { createThinkingShapes, isThinkingShapeUnsupported, ADAPTIVE_FALLBACK } = require('./convert/thinking');
const { cacheRule } = require('./rates/cacheRules');
const { expectedBill, verdict } = require('./rates/formula');
const { normalize } = require('./normalize');
const { streamChatCompletions } = require('./transport/openaiChat');
const { streamResponses } = require('./transport/openaiResponses');
const { streamMessages } = require('./transport/anthropicMessages');
const { textOf, roleName, sortedTools } = require('./convert/messages');
const { classifyUtilityRequest, synthesizeProgressMessages, synthesizeTitle } = require('./convert/utilityRequest');
const { createToolPinning } = require('./cache/toolPinning');
const { createReasoningCache } = require('./state/reasoningCache');
const { createLedgerWriter } = require('./ledger/writer');
const { readAll: readLedger } = require('./ledger/reader');
const { reconcile } = require('./ledger/reconcile');
const { createRequestLog } = require('./debug/requestLog');
const { createSpendCap } = require('./budget/spendCap');
const { charsOfRequest, estimatePreflightCost, checkPreflight } = require('./budget/preflight');
const { forecastBurnRate } = require('./budget/forecast');
const { createBudgetService } = require('./budget/budgetService');
const { createStatusBar } = require('./ui/statusBar');
const { checkCacheHealth } = require('./ui/cacheHealth');
const { createLog } = require('./log');
const { toLanguageModelError, parseOutputCapTooLarge, isThinkingBoundRejection } = require('./errors');

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
/** @type {ReturnType<typeof createRequestLog> | null} */
let debugLog = null;

/** Lazily created only when asksage.debug.logRequests is actually turned on. */
function getDebugLog() {
  if (!debugLog) {
    debugLog = createRequestLog(path.join(ctx.globalStorageUri.fsPath, 'debug'));
    log.warn(`Ask Sage: request/response logging is ON (asksage.debug.logRequests) -- writing prompt text to ${debugLog.filePath}`);
  }
  return debugLog;
}

/** @type {Promise<void> | null} */
let balanceRefresh = null;
let balanceRefreshedAt = 0;

/**
 * PLAN.md §3.3: refresh the remaining balance on activation and after each completed turn,
 * debounced. Free calls (JWT exchange + counters); failures only leave the last known value.
 * @param {{ force?: boolean }} [o]
 */
function refreshBalance(o = {}) {
  if (balanceRefresh || (!o.force && Date.now() - balanceRefreshedAt < 30000)) return balanceRefresh;
  balanceRefresh = (async () => {
    try {
      const svc = getServices(readSettings(vscode));
      if (!(await svc.credentials.getApiKey())) return;
      const status = await svc.budgetService.getStatus();
      balanceRefreshedAt = Date.now();
      if (typeof status.remaining === 'number') {
        // PLAN.md §3.5 burn-rate forecast: this week's spend rate from the ledger against the
        // freshly-fetched remaining balance, shown in the status bar tooltip.
        const records = readLedger(path.join(ctx.globalStorageUri.fsPath, 'ledger'));
        const forecast = forecastBurnRate(records, status.remaining);
        statusBar.update({ remaining: status.remaining, forecast });
      }
    } catch (e) {
      log.debug(`balance refresh failed: ${/** @type {Error} */ (e).message}`);
    } finally {
      balanceRefresh = null;
    }
  })();
  return balanceRefresh;
}

/** @type {string | null} */
let servicesKey = null;
/** @type {{ credentials: ReturnType<typeof createCredentials>, accessToken: ReturnType<typeof createAccessTokenService>,
 *   userInfo: ReturnType<typeof createUserInfoService>, catalog: ReturnType<typeof createCatalog>,
 *   tokenizerRates: ReturnType<typeof createTokenizerRates>, outputCaps: ReturnType<typeof createOutputCaps>,
 *   thinkingShapes: ReturnType<typeof createThinkingShapes>, budgetService: ReturnType<typeof createBudgetService>,
 *   promptLog: ReturnType<typeof createPromptLogService> } | null} */
let services = null;

// PLAN.md §4.3/§5/TODO.md "pin the tool list per conversation": module-scoped, like
// conversationIds below, so state survives across requests in the same extension host process.
const toolPinning = createToolPinning();
const reasoningCache = createReasoningCache();
/** Pins the first request's thinking shape for a conversation's life (PLAN.md §4.1). */
const thinkingConfigByConversation = new Map();
/** The most recent conversationId seen, so asksage.requestMoreTokens has a target without the
 *  command palette being able to pass one in. */
let lastConversationId = null;
/** Running per-conversation state (PLAN.md §3.5): cumulative cache stats for the pre-flight
 *  estimate's expected cache split, plus the cache-health alarm's consecutive-cold-round streak,
 *  last resolvedModel (a silent host failover) and last toolSetHash (informational). */
const conversationCacheState = new Map();

function partCtors() {
  return { TextPart: vs.LanguageModelTextPart, ToolCallPart: vs.LanguageModelToolCallPart, ToolResultPart: vs.LanguageModelToolResultPart, ThinkingPart: vs.LanguageModelThinkingPart };
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
  const catalog = createCatalog({ apiBase: settings.apiBase, warn: (m) => log.warn(m) });
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
  const thinkingShapes = createThinkingShapes({
    get: () => ctx.globalState.get(`asksage.thinkingShapes.${settings.apiBase}`),
    set: (v) => ctx.globalState.update(`asksage.thinkingShapes.${settings.apiBase}`, v),
  });
  const budgetService = createBudgetService({ apiBase: settings.apiBase, accessToken, userInfo });
  const promptLog = createPromptLogService({ apiBase: settings.apiBase, accessToken });
  services = { credentials, accessToken, userInfo, catalog, tokenizerRates, outputCaps, thinkingShapes, budgetService, promptLog };
  servicesKey = key;
  return services;
}

let forceModelsWarned = false;

/**
 * The org's force_models for the catalog (PLAN.md §2.3). Needs a JWT, so it fails without an
 * email or key; the picker then shows the unrestricted catalog (Ask Sage still enforces the
 * restriction) and the failure is logged once.
 * @param {NonNullable<typeof services>} svc
 * @returns {Promise<string[] | undefined>}
 */
async function forceModelsFor(svc) {
  try {
    const names = await svc.userInfo.getForceModels();
    forceModelsWarned = false;
    return names;
  } catch (e) {
    if (!forceModelsWarned) log.warn(`Ask Sage: could not read the organization's force_models, so the model list is unrestricted: ${/** @type {Error} */ (e).message}`);
    forceModelsWarned = true;
    return undefined;
  }
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
    const svc = getServices(settings);
    try {
      const models = await svc.catalog.list({ forceModels: await forceModelsFor(svc) });
      return models.map((m) => ({
        id: m.id,
        name: m.id,
        family: 'asksage',
        version: '0.1.0',
        tooltip: `Ask Sage: ${m.id} (${m.flavor === 'M' ? 'Anthropic Messages' : m.flavor === 'R' ? 'Responses' : 'Chat Completions'})`,
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

    // Copilot's own internal title/progress-message calls arrive as ordinary requests (PLAN.md
    // has no separate channel for them); asksage.interceptUtilityRequests answers them locally
    // for $0 instead of spending real tokens on cosmetic UI text (off by default: heuristic
    // detection, not yet seen against live traffic).
    if (settings.interceptUtilityRequests) {
      const classified = classifyUtilityRequest(messages, ctors, textOf, options.tools);
      if (classified) {
        const text = classified.kind === 'progress' ? synthesizeProgressMessages(classified.userText) : synthesizeTitle(classified.userText);
        progress.report(new vs.LanguageModelTextPart(text));
        ledger.append({
          ts: new Date().toISOString(),
          conversationId: 'n/a',
          tenant: settings.tenant,
          model: model.id,
          resolvedModel: null,
          flavor: 'n/a',
          inputUncached: 0,
          cacheRead: 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          visibleOutput: 0,
          thinking: 0,
          thinkingUnknown: false,
          estAsCost: 0,
          rateSource: 'intercepted',
          latencyMs: 0,
          status: 'intercepted',
          errorClass: null,
          cancelled: false,
          toolCallCount: 0,
        });
        log.info(`Ask Sage: intercepted a Copilot utility request (${classified.kind}) -- answered locally, no Ask Sage tokens spent`);
        return;
      }
    }

    const svc = getServices(settings);
    const models = await svc.catalog.list({ forceModels: await forceModelsFor(svc) });
    const entry = models.find((m) => m.id === model.id);
    if (!entry) throw toLanguageModelError(vscode, new Error(`Ask Sage: ${model.id} is not in this tenant's catalog`));
    const apiKey = await svc.credentials.getApiKey();
    if (!apiKey) throw toLanguageModelError(vscode, new Error('Ask Sage: no API key set (run "Ask Sage: Set API Key")'));

    const rawTools = options.tools || [];
    const rawToolSetHash = hash([...rawTools].map((t) => t.name).sort().join(','));
    const conversationId = conversationIdFor(messages, ctors, options.modelOptions, rawToolSetHash);
    lastConversationId = conversationId; // asksage.requestMoreTokens targets the most recent conversation

    // PLAN.md §4.3 / TODO.md "pin the tool list per conversation": send the first turn's tool
    // list for the conversation's life instead of whatever Copilot sends this turn, so tool
    // churn (an extension registering a tool mid-chat) doesn't bust the cached prefix every time.
    const tools = settings.pinToolList ? toolPinning.resolve(conversationId, sortedTools(rawTools), { warn: (m) => log.warn(m) }) : rawTools;
    const toolSetHash = hash([...tools].map((t) => t.name).sort().join(','));

    // PLAN.md §3.4: a hash of the deterministic cacheable prefix (first user message text + full
    // tool definitions, not just their names) -- lets the passive reconciliation mode
    // (src/ledger/reconcile.js) tell a prefix *content* change (a mutated instructions block,
    // server-side injection, a tool's schema changing) apart from tool-list churn or a
    // thinking-config change, which toolSetHash/thinkingConfigHash already cover.
    const firstUserMessage = messages.find((m) => roleName(m.role, roleEnum()) === 'user');
    const firstUserText = firstUserMessage ? textOf(firstUserMessage, ctors) : '';
    const prefixHash = hash(`${firstUserText}::${JSON.stringify(sortedTools(tools).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })))}`);

    // PLAN.md §4.1: the thinking config is pinned to the conversation's first request too --
    // M-only; other flavors just don't have one.
    let thinkingShape;
    let thinkingConfigHash = '';
    if (entry.flavor === 'M') {
      thinkingShape = thinkingConfigByConversation.get(conversationId);
      if (!thinkingShape) {
        thinkingShape = svc.thinkingShapes.get(model.id);
        thinkingConfigByConversation.set(conversationId, thinkingShape);
      }
      thinkingConfigHash = hash(JSON.stringify(thinkingShape));
    }

    // PLAN.md §3.5 pre-flight estimate: before anything is sent, estimate this request's cost
    // from a local char count and this conversation's own recent cache-read share, and warn or
    // hard-stop against the remaining session/hourly budget. Best-effort: a rate-lookup failure
    // just skips the estimate for this turn rather than blocking the request.
    /** @type {{ level: 'ok' | 'warn' | 'stop', message: string | null } | null} */
    let preflight = null;
    try {
      const rates = await svc.tokenizerRates.rateFor(entry);
      const stats = conversationCacheState.get(conversationId);
      const recentCacheReadRatio = stats && stats.cacheableTotal > 0 ? stats.cacheReadTotal / stats.cacheableTotal : 0;
      const chars = charsOfRequest(messages, tools, ctors);
      const estimatedCost = estimatePreflightCost(chars, rates, cacheRule(entry.flavor, model.id), recentCacheReadRatio);
      const effectiveSessionCap = settings.sessionCapTokens > 0 ? settings.sessionCapTokens + spendCap.bumpFor(conversationId) : settings.sessionCapTokens;
      preflight = checkPreflight({
        estimatedCost,
        spent: spendCap.snapshot(conversationId),
        limits: { sessionCapTokens: effectiveSessionCap, hourlyCapTokens: settings.hourlyCapTokens },
        warnFraction: settings.budgetWarnFraction,
        reserve: settings.budgetReserveTokens,
      });
    } catch (e) {
      log.debug(`Ask Sage: pre-flight estimate skipped for ${model.id}: ${/** @type {Error} */ (e).message}`);
    }
    if (preflight?.level === 'stop') {
      log.warn(/** @type {string} */ (preflight.message));
      throw toLanguageModelError(vscode, new Error(/** @type {string} */ (preflight.message)));
    }
    if (preflight?.level === 'warn') log.warn(/** @type {string} */ (preflight.message));

    try {
      spendCap.check(conversationId);
    } catch (e) {
      log.warn(/** @type {Error} */ (e).message);
      throw toLanguageModelError(vscode, /** @type {Error} */ (e));
    }

    const promptCacheKey = hash(`${conversationId}::${model.id}`);
    let reasoningStateLostThisTurn = false;
    /** @type {(toolCallId: string) => void} */
    const onReasoningStateLost = (toolCallId) => {
      reasoningStateLostThisTurn = true;
      log.debug(`Ask Sage: ${model.id} sent no reasoning state for tool call ${toolCallId} this round (dropped or never cached); the model will just re-reason`);
    };
    /** @type {(t: { toolCallId: string, value: string, signature: string }) => void} */
    const onThinking = (t) => {
      reasoningCache.set(t.toolCallId, { thinking: t.value, signature: t.signature });
      if (typeof vs.LanguageModelThinkingPart === 'function') {
        try {
          progress.report(new vs.LanguageModelThinkingPart(t.value || ' ', t.toolCallId, { signature: t.signature }));
        } catch {
          // proposed API, feature-detected above but still best-effort (PLAN.md §7)
        }
      }
    };

    let attempt = 0;
    let includeThinking = true;
    let maxOutputTokens = svc.outputCaps.get(model.id, model.maxOutputTokens);
    async function runOnce() {
      attempt++;
      let streamedAnything = false;
      let debugText = '';
      const streamOpts = {
        apiBase: settings.apiBase,
        apiKey,
        model: model.id,
        messages,
        ctors,
        roleEnum: roleEnum(),
        tools,
        maxOutputTokens,
        promptCacheKey,
        thinkingShape,
        includeThinking,
        includeReasoning: includeThinking,
        ttlMode: settings.cacheTtlMode,
        getReasoningState: (/** @type {string} */ id) => reasoningCache.get(id),
        onReasoningStateLost,
        onThinking,
        onText: (/** @type {string} */ text) => {
          streamedAnything = true;
          if (settings.debugLogRequests) debugText += text;
          progress.report(new vs.LanguageModelTextPart(text));
        },
        onToolCall: (/** @type {{ callId: string, name: string, input: unknown }} */ call) => {
          streamedAnything = true;
          progress.report(new vs.LanguageModelToolCallPart(call.callId, call.name, call.input));
        },
        token,
      };
      const result = entry.flavor === 'M' ? await streamMessages(streamOpts) : entry.flavor === 'R' ? await streamResponses(streamOpts) : await streamChatCompletions(streamOpts);
      if (settings.debugLogRequests) {
        getDebugLog().write({
          ts: new Date().toISOString(),
          conversationId,
          model: model.id,
          flavor: entry.flavor,
          attempt,
          request: result.requestBody,
          responseText: debugText,
          usage: result.usage,
          resolvedModel: result.resolvedModel,
          error: result.error,
        });
      }
      return { result, streamedAnything };
    }

    const started = Date.now();
    // PLAN.md §3.5: always send an explicit output cap, never rely on the server default. But
    // the catalog's limits.max_output can't be trusted (77 of 105 models on the public catalog
    // report one within 70% of max_context, and gpt-5.6-luna's 900000 was rejected outright by a
    // server that actually caps at 32768) -- start from it, but learn and remember the real cap
    // from a rejection instead of failing every request to that model forever.
    let { result, streamedAnything } = await runOnce();
    if (result.error && !streamedAnything) {
      const corrected = parseOutputCapTooLarge(result.error);
      if (corrected && corrected !== maxOutputTokens) {
        log.warn(`Ask Sage: ${model.id} rejected max output ${maxOutputTokens}; retrying once at ${corrected} (its catalog limits.max_output is wrong)`);
        svc.outputCaps.correct(model.id, corrected);
        maxOutputTokens = corrected;
        ({ result, streamedAnything } = await runOnce());
      }
    }
    if (entry.flavor === 'M' && result.error && !streamedAnything && isThinkingShapeUnsupported(result.error)) {
      // PLAN.md §4.1: the older enabled+budget_tokens shape is rejected on some Claude
      // generations (measured on Sonnet 5, T22); learn the adaptive shape from the rejection the
      // same way outputCaps learns a real max_output.
      log.warn(`Ask Sage: ${model.id} rejected its thinking shape; retrying once with the adaptive shape and remembering it`);
      svc.thinkingShapes.correct(model.id, ADAPTIVE_FALLBACK);
      thinkingShape = ADAPTIVE_FALLBACK;
      thinkingConfigByConversation.set(conversationId, thinkingShape);
      ({ result, streamedAnything } = await runOnce());
    }
    if (entry.flavor === 'M' && result.error && !streamedAnything && includeThinking && isThinkingBoundRejection(result.error)) {
      // PLAN.md §5: a resent signed-thinking block bound to a prefix that changed underneath it
      // (preserved thinking, Opus 5.5/Fable 5.1) -- unconfirmed through Ask Sage yet
      // (REQUIREMENTS.md §3), handled defensively: strip every thinking block and retry once.
      log.warn(`Ask Sage: ${model.id} rejected a resent thinking block (preserved-thinking check); retrying once with thinking stripped`);
      includeThinking = false;
      reasoningStateLostThisTurn = true;
      ({ result, streamedAnything } = await runOnce());
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
    {
      // No prompt text: ids and totals only, so a cap that doesn't trip can be diagnosed.
      const idSource = options.modelOptions && '_conversationId' in options.modelOptions ? '_conversationId' : 'hash fallback';
      const spent = spendCap.snapshot(conversationId);
      log.info(`${model.id} via ${entry.flavor}: est ${estAsCost ?? 'n/a'} AS; conversation ${conversationId} (${idSource}) at ${Math.round(spent.conversation * 100) / 100} AS, last hour ${Math.round(spent.hourly * 100) / 100} AS`);
    }

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
      toolSetHash,
      thinkingConfigHash: thinkingConfigHash || undefined,
      reasoningStateLost: reasoningStateLostThisTurn || undefined,
      prefixHash,
    });

    // PLAN.md §3.5 cache-health alarm: warn when a cache-capable model's cache-read share stays
    // under 50% for 2+ consecutive rounds, or when the host silently failed over to a different
    // resolved model mid-conversation (the cache is cold either way); note a tool-list change
    // informationally, since it's an expected, one-time cold turn rather than a problem.
    if (norm && !cancelled) {
      const state = conversationCacheState.get(conversationId) || { cacheableTotal: 0, cacheReadTotal: 0, coldStreak: 0, lastResolvedModel: null, lastToolSetHash: null };
      const roundTotal = norm.inputUncached + norm.cacheRead + norm.cacheWrite5m + norm.cacheWriteUnsplit + norm.cacheWrite1h;
      const hasCacheRule = !!cacheRule(entry.flavor, model.id);
      if (roundTotal > 0) {
        state.cacheableTotal += roundTotal;
        state.cacheReadTotal += norm.cacheRead;
        if (hasCacheRule) {
          const cold = norm.cacheRead / roundTotal < 0.5;
          state.coldStreak = cold ? state.coldStreak + 1 : 0;
          if (state.coldStreak >= 2) {
            log.warn(`Ask Sage: cache-health alarm -- ${model.id} (${entry.flavor}) has read under 50% of its cacheable input for ${state.coldStreak} consecutive rounds in this conversation (last round: ${Math.round((norm.cacheRead / roundTotal) * 100)}%).`);
          }
        }
      }
      if (state.lastResolvedModel && result.resolvedModel && state.lastResolvedModel !== result.resolvedModel) {
        log.warn(`Ask Sage: cache-health alarm -- ${model.id} failed over from ${state.lastResolvedModel} to ${result.resolvedModel} mid-conversation; the cache is cold for this conversation now.`);
      }
      if (result.resolvedModel) state.lastResolvedModel = result.resolvedModel;
      if (state.lastToolSetHash && state.lastToolSetHash !== toolSetHash) {
        log.info(`Ask Sage: the tool list changed this round for conversation ${conversationId} (cache-health, informational) -- one cold turn is expected.`);
      }
      state.lastToolSetHash = toolSetHash;
      conversationCacheState.set(conversationId, state);
    }

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
    void refreshBalance();
  },
};

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  ctx = context;
  log = createLog(vscode);
  context.subscriptions.push(log.channel);
  statusBar = createStatusBar(vscode);
  spendCap = createSpendCap(() => {
    const s = readSettings(vscode);
    return { sessionCapTokens: s.sessionCapTokens, hourlyCapTokens: s.hourlyCapTokens };
  });
  ledger = createLedgerWriter(path.join(context.globalStorageUri.fsPath, 'ledger'));

  if (typeof vs.lm?.registerLanguageModelChatProvider !== 'function') {
    log.error('vscode.lm.registerLanguageModelChatProvider is missing: this VS Code is older than the stable provider API (needs 1.104 or later)');
    vscode.window.showErrorMessage('Ask Sage: this VS Code has no language-model provider API (needs 1.104 or later).');
  } else {
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));
  }

  const credentials = createCredentials(context);
  context.subscriptions.push(...registerCredentialCommands(vscode, credentials));
  void refreshBalance({ force: true });
  context.subscriptions.push(
    vscode.commands.registerCommand('asksage.openDebugLogFolder', () => revealStorageFolder('debug')),
    vscode.commands.registerCommand('asksage.openLedgerFolder', () => revealStorageFolder('ledger')),
    vscode.commands.registerCommand('asksage.showStatus', async () => {
      try {
        const svc = getServices(readSettings(vscode));
        const status = await svc.budgetService.getStatus();
        statusBar.update({ remaining: status.remaining });
        vscode.window.showInformationMessage(`Ask Sage: ${status.remaining ?? '?'} of ${status.maxTokens ?? '?'} tokens remaining this month.`);
      } catch (e) {
        vscode.window.showErrorMessage(`Ask Sage: ${/** @type {Error} */ (e).message}`);
      }
    }),
    vscode.commands.registerCommand('asksage.checkCacheHealth', () => runCheckCacheHealth()),
    vscode.commands.registerCommand('asksage.reconcileCacheHealth', () => runReconcileCacheHealth()),
    vscode.commands.registerCommand('asksage.requestMoreTokens', () => runRequestMoreTokens())
  );
}

/**
 * PLAN.md §3.5: the pre-flight/session-cap hard stop's "request tokens" offer -- raises the
 * current conversation's effective session cap by a one-time amount without editing Settings.
 * In-memory only (src/budget/spendCap.js), like the caps themselves; it doesn't touch the
 * setting, so a reload or a new conversation goes back to the configured cap.
 */
async function runRequestMoreTokens() {
  if (!lastConversationId) {
    vscode.window.showInformationMessage('Ask Sage: no conversation has sent a request yet in this window.');
    return;
  }
  const settings = readSettings(vscode);
  const input = await vscode.window.showInputBox({
    title: 'Ask Sage: Request More Tokens',
    prompt: `Extra Ask Sage tokens to allow for the current conversation, on top of its session cap (${settings.sessionCapTokens || 'unlimited'})`,
    value: String(settings.sessionCapTokens || 10000),
    validateInput: (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? null : 'enter a positive number of AS tokens'),
  });
  if (!input) return;
  spendCap.bump(lastConversationId, Number(input));
  log.info(`Ask Sage: raised the session cap for conversation ${lastConversationId} by ${input} AS tokens (total bump now ${spendCap.bumpFor(lastConversationId)}).`);
  vscode.window.showInformationMessage(`Ask Sage: this conversation can spend ${input} more AS tokens before the session cap stops it again.`);
}

/**
 * PLAN.md §4.3: sends real, billed requests, so this asks first (CLAUDE.md: paid probes need the
 * owner's go-ahead) and is never invoked automatically -- only from the command palette.
 */
async function runCheckCacheHealth() {
  const settings = readSettings(vscode);
  const svc = getServices(settings);
  let models;
  try {
    models = await svc.catalog.list({ forceModels: await forceModelsFor(svc) });
  } catch (e) {
    vscode.window.showErrorMessage(`Ask Sage: could not load the model catalog: ${/** @type {Error} */ (e).message}`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    models.map((m) => ({ label: m.id, description: m.flavor, model: m })),
    { title: 'Ask Sage: Check Cache Health -- pick a model' }
  );
  if (!picked) return;
  const proceed = await vscode.window.showWarningMessage(
    `This sends four real requests to Ask Sage on ${picked.model.id} (a long, repeated prefix) and spends real tokens. Continue?`,
    { modal: true },
    'Send the requests'
  );
  if (proceed !== 'Send the requests') return;

  const apiKey = await svc.credentials.getApiKey();
  if (!apiKey) {
    vscode.window.showErrorMessage('Ask Sage: no API key set (run "Ask Sage: Set API Key")');
    return;
  }
  const ctors = partCtors();
  const entry = picked.model;
  const streamFn = entry.flavor === 'M' ? streamMessages : entry.flavor === 'R' ? streamResponses : streamChatCompletions;

  log.channel.show(true);
  log.info(`Ask Sage: Check Cache Health starting for ${entry.id} (${entry.flavor})`);
  try {
    const results = await checkCacheHealth({
      ctors,
      roleEnum: roleEnum(),
      flavor: entry.flavor,
      normalize,
      cacheRuleForModel: cacheRule(entry.flavor, entry.id),
      send: (msgs) => streamFn({ apiBase: settings.apiBase, apiKey, model: entry.id, messages: msgs, ctors, roleEnum: roleEnum(), maxOutputTokens: 16 }),
    });
    for (const r of results) log.info(`Ask Sage: Check Cache Health -- ${r.pass ? 'PASS' : 'FAIL'} ${r.name}: ${r.detail}`);
    const failed = results.filter((r) => !r.pass);
    if (failed.length) vscode.window.showWarningMessage(`Ask Sage: Check Cache Health found ${failed.length} problem(s) on ${entry.id} -- see the Ask Sage output channel.`);
    else vscode.window.showInformationMessage(`Ask Sage: Check Cache Health passed on ${entry.id}.`);
  } catch (e) {
    log.error(`Ask Sage: Check Cache Health failed: ${/** @type {Error} */ (e).message}`);
    vscode.window.showErrorMessage(`Ask Sage: Check Cache Health failed: ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * PLAN.md §4.3's passive analysis mode / §3.7's cold-turn attribution: reconciles this
 * extension's own ledger against Ask Sage's real prompt log for the same recent requests. Spends
 * no tokens (get-user-logs is a free read), so unlike runCheckCacheHealth this needs no
 * confirmation dialog and is safe to run any time.
 */
async function runReconcileCacheHealth() {
  const settings = readSettings(vscode);
  const svc = getServices(settings);
  log.channel.show(true);
  log.info('Ask Sage: reconciling the ledger against the Ask Sage prompt log (no tokens spent)...');
  try {
    const allRecords = readLedger(path.join(ctx.globalStorageUri.fsPath, 'ledger'));
    const recent = allRecords.filter((r) => r.status === 'ok').slice(-100);
    if (!recent.length) {
      vscode.window.showInformationMessage('Ask Sage: the ledger has no completed requests yet to reconcile.');
      return;
    }
    const logRows = await svc.promptLog.getRecent({ limit: 100 });
    const { rows, summary } = reconcile({ ledgerRecords: recent, logRows, verdict, ttlMode: settings.cacheTtlMode });
    for (const r of rows) {
      const billed = r.billed ?? 'unmatched';
      const cause = r.coldCause ? ` cold: ${r.coldCause}` : '';
      log.info(`Ask Sage: reconcile -- ${r.ledger.ts} ${r.ledger.model} est ${r.ledger.estAsCost ?? 'n/a'} vs billed ${billed} (${r.verdict})${cause}`);
    }
    const causes = Object.entries(summary.coldByCause).map(([k, n]) => `${k}=${n}`).join(', ') || 'none';
    log.info(`Ask Sage: reconcile summary -- ${summary.matched} matched, ${summary.unmatched} unmatched, ${summary.cacheReadPct}% of cacheable input tokens were cache reads, cold turns by cause: ${causes}`);
    vscode.window.showInformationMessage(`Ask Sage: reconciled ${summary.matched} of ${rows.length} recent requests against the prompt log (${summary.cacheReadPct}% cache reads) -- see the Ask Sage output channel.`);
  } catch (e) {
    log.error(`Ask Sage: reconcile failed: ${/** @type {Error} */ (e).message}`);
    vscode.window.showErrorMessage(`Ask Sage: reconcile failed: ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * Opens a folder under global storage in the OS file manager, with its newest file selected
 * (revealFileInOS on the folder itself would only select it inside its parent). The path is
 * per user and per install, so settings can't hold a static link; they link to these commands.
 * @param {string} sub
 */
async function revealStorageFolder(sub) {
  const dir = path.join(ctx.globalStorageUri.fsPath, sub);
  fs.mkdirSync(dir, { recursive: true });
  const newest = fs
    .readdirSync(dir)
    .map((name) => ({ name, at: fs.statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0];
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(newest ? path.join(dir, newest.name) : dir));
}

function deactivate() {}

module.exports = { activate, deactivate, VENDOR };
