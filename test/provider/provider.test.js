// @ts-check
'use strict';

// End-to-end (within node:test): drives src/extension.js's provider through a CC and an R
// request with an injected fetch, matching PLAN.md §9 Phase 1 accept criteria: GPT-5.x through R
// and a non-GPT^H^Hnon-reasoning model through CC stream in Ask mode; every request lands in
// the ledger with a normalized, estimated cost. No real network access.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStub, loadWithStub, createContext, parts } = require('../helpers/vscode-stub');
const { readAll } = require('../../src/ledger/reader');
const { SECRET_KEY } = require('../../src/auth/credentials');

const EXT = path.join(__dirname, '../../src/extension.js');
const text = (/** @type {string} */ v) => new parts.LanguageModelTextPart(v);
const token = () => ({ isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });

/** @param {unknown} body */
function jsonResponse(body) {
  return { status: 200, headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}

/** @param {number} v */
function numResponse(v) {
  return jsonResponse({ response: v });
}

/** @param {string} sseText */
function sseResponse(sseText) {
  return {
    status: 200,
    headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseText));
        controller.close();
      },
    }),
  };
}

const CC_MODEL = { id: 'gpt-4.1-nano', cui_capable: true, limits: { max_context: 128000, max_output: 4096 } };
const R_MODEL = { id: 'gpt-5.4-nano', cui_capable: true, limits: { max_context: 128000, max_output: 4096 } };
const M_MODEL = { id: 'google-claude-sonnet-5', cui_capable: true, limits: { max_context: 200000, max_output: 8192 } };

const CC_SSE =
  'data: {"id":"1","model":"gpt-4.1-nano-2026-01-01","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
  'data: {"choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":50,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}}\n\n' +
  'data: [DONE]\n\n';

const R_SSE =
  'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
  'data: {"type":"response.completed","response":{"model":"gpt-5.4-nano-2026-01-01","status":"completed","usage":{"input_tokens":40,"input_tokens_details":{"cached_tokens":0},"output_tokens":3,"output_tokens_details":{"reasoning_tokens":0}}}}\n\n' +
  'data: [DONE]\n\n';

// Real gpt-5.6-luna traffic (2026-09-27 live ledger) reports a cache write with no 5m/1h split;
// normalize() puts it in cacheWriteUnsplit, which the ledger must not silently drop.
const R_SSE_CACHE_WRITE =
  'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
  'data: {"type":"response.completed","response":{"model":"gpt-5.6-luna","status":"completed","usage":{"input_tokens":3,"input_tokens_details":{"cached_tokens":0,"cache_write_tokens":10000},"output_tokens":41,"output_tokens_details":{"reasoning_tokens":19}}}}\n\n' +
  'data: [DONE]\n\n';

const M_SSE =
  'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-5-2026-01-01","usage":{"input_tokens":60,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n\n' +
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi there"}}\n\n' +
  'data: {"type":"content_block_stop","index":0}\n\n' +
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n' +
  'data: {"type":"message_stop"}\n\n';

/** @param {string} message */
function openaiErrorResponse(message) {
  return {
    status: 400,
    headers: { get: (/** @type {string} */ h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify({ error: { message, type: 'invalid_request_error' } }),
  };
}

/** @param {{ models: unknown[], cc?: string, r?: string, m?: string, rSequence?: unknown[], forceModels?: unknown }} o */
function createFakeFetch(o) {
  const calls = /** @type {{ url: string, body: any }[]} */ ([]);
  const rQueue = o.rSequence ? [...o.rSequence] : null;
  const fn = async (/** @type {string} */ url, /** @type {any} */ init) => {
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (url.endsWith('/server/get-models?format=full')) return jsonResponse({ response: o.models }); // real tenants wrap the array (2026-09-27 live finding)
    if (url.endsWith('/user/get-token-with-api-key')) return jsonResponse({ response: { access_token: 'jwt-1' } });
    if (url.endsWith('/user/validate_token_with_full_user')) return jsonResponse({ response: { max_tokens: 200000, force_models: o.forceModels ?? [] } });
    if (url.endsWith('/server/count-monthly-tokens-left-with-org')) return jsonResponse({ response: 150000 });
    if (url.endsWith('/server/count-monthly-tokens')) return jsonResponse({ response: 50000 });
    if (url.endsWith('/server/tokenizer')) {
      const isOne = body.content === 'x';
      if (!body.convert_to_asksage) return numResponse(isOne ? 1 : 2000);
      if (body.completion_estimate) return numResponse(250000.06);
      return numResponse(isOne ? 0.06 : 100.01); // prompt rate 0.05, completion rate 0.25
    }
    if (url.endsWith('/server/openai/v1/chat/completions') && o.cc) return sseResponse(o.cc);
    if (url.endsWith('/server/openai/v1/responses')) {
      if (rQueue && rQueue.length) return rQueue.shift();
      if (o.r) return sseResponse(o.r);
    }
    if (url.endsWith('/server/anthropic/v1/messages') && o.m) return sseResponse(o.m);
    throw new Error(`unexpected fetch in test: ${url}`);
  };
  return Object.assign(fn, { calls });
}

/**
 * @param {ReturnType<typeof createFakeFetch>} fetchImpl
 * @param {Record<string, unknown>} [configOverrides]
 */
function setup(fetchImpl, configOverrides = {}) {
  const { vscode, registered, config } = createStub();
  vscode.window.showInputBox = async () => undefined; // not exercised: key is set directly below
  config['asksage.tenant'] = 'custom';
  config['asksage.host'] = 'asksage.test.invalid';
  config['asksage.email'] = 'tester@asksage.test.invalid';
  Object.assign(config, configOverrides);
  // Every fetch in the provider's path goes through globalThis.fetch; scope the fake to this test.
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  const ext = loadWithStub(EXT, vscode);
  const context = createContext();
  ext.activate(context);
  context.secrets.store(SECRET_KEY, 'test-api-key');
  const provider = registered.providers.asksage;
  /**
   * Looks the model up through provideLanguageModelChatInformation first, the way VS Code
   * actually does, so provideLanguageModelChatResponse gets the same maxOutputTokens etc. that
   * were advertised in the picker (PLAN.md §3.5: always send an explicit output cap).
   * @param {string} modelId
   * @param {any[]} messages
   */
  async function send(modelId, messages) {
    const models = await provider.provideLanguageModelChatInformation({}, token());
    const model = models.find((/** @type {any} */ m) => m.id === modelId);
    assert.ok(model, `${modelId} not offered by provideLanguageModelChatInformation`);
    /** @type {any[]} */
    const out = [];
    await provider.provideLanguageModelChatResponse(model, messages, { toolMode: 1 }, { report: (/** @type {any} */ p) => out.push(p) }, token());
    return out;
  }
  function restore() {
    globalThis.fetch = realFetch;
  }
  return { vscode, registered, config, provider, send, fetchImpl, context, restore };
}

test('GPT-5.x streams through R and lands a normalized, estimated-cost ledger record', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL, R_MODEL], r: R_SSE });
  const { send, context, restore } = setup(fetchImpl);
  try {
    const out = await send('gpt-5.4-nano', [{ role: 1, content: [text('hi')] }]);
    const textOut = out.filter((p) => p instanceof parts.LanguageModelTextPart).map((p) => p.value).join('');
    assert.equal(textOut, 'Hi');

    const records = readAll(path.join(context.globalStorageUri.fsPath, 'ledger'));
    assert.equal(records.length, 1);
    const r = records[0];
    assert.equal(r.flavor, 'R');
    assert.equal(r.model, 'gpt-5.4-nano');
    assert.equal(r.resolvedModel, 'gpt-5.4-nano-2026-01-01');
    assert.equal(r.inputUncached, 40);
    assert.equal(r.visibleOutput, 3);
    assert.equal(r.estAsCost, 2.75); // 40*0.05 + 3*0.25
    assert.equal(r.status, 'ok');
    assert.ok(!('messages' in r) && !('prompt' in r), 'no prompt text in the ledger');
  } finally {
    restore();
  }
});

test('a non-reasoning model streams through CC and lands a normalized, estimated-cost ledger record', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL, R_MODEL], cc: CC_SSE });
  const { send, context, restore } = setup(fetchImpl);
  try {
    const out = await send('gpt-4.1-nano', [{ role: 1, content: [text('hi')] }]);
    const textOut = out.filter((p) => p instanceof parts.LanguageModelTextPart).map((p) => p.value).join('');
    assert.equal(textOut, 'Hello world');

    const records = readAll(path.join(context.globalStorageUri.fsPath, 'ledger'));
    assert.equal(records.length, 1);
    const r = records[0];
    assert.equal(r.flavor, 'CC');
    assert.equal(r.resolvedModel, 'gpt-4.1-nano-2026-01-01');
    assert.equal(r.inputUncached, 50);
    assert.equal(r.visibleOutput, 5);
    assert.equal(r.estAsCost, 3.75); // 50*0.05 + 5*0.25
  } finally {
    restore();
  }
});

test('Claude streams through M and lands a normalized, estimated-cost ledger record (Phase 2)', async () => {
  const fetchImpl = createFakeFetch({ models: [M_MODEL], m: M_SSE });
  const { send, context, restore } = setup(fetchImpl);
  try {
    const out = await send('google-claude-sonnet-5', [{ role: 1, content: [text('hi')] }]);
    const textOut = out.filter((p) => p instanceof parts.LanguageModelTextPart).map((p) => p.value).join('');
    assert.equal(textOut, 'Hi there');

    const records = readAll(path.join(context.globalStorageUri.fsPath, 'ledger'));
    assert.equal(records.length, 1);
    const r = records[0];
    assert.equal(r.flavor, 'M');
    assert.equal(r.model, 'google-claude-sonnet-5');
    assert.equal(r.resolvedModel, 'claude-sonnet-5-2026-01-01');
    assert.equal(r.inputUncached, 60);
    assert.equal(r.visibleOutput, 4);
    assert.ok(r.toolSetHash, 'toolSetHash must be recorded (PLAN §3.4)');
    assert.ok(r.thinkingConfigHash, 'thinkingConfigHash must be recorded for M (PLAN §3.4)');

    const mCall = fetchImpl.calls.find((c) => c.url.endsWith('/server/anthropic/v1/messages'));
    assert.equal(mCall?.body.max_tokens, 8192);
    assert.ok(mCall?.body.thinking, 'a thinking shape must be sent for a non-opus-5.5/fable model');
  } finally {
    restore();
  }
});

test('the tool list is pinned per conversation (PLAN §4.3): a tool added mid-conversation is held back', async () => {
  const fetchImpl = createFakeFetch({ models: [M_MODEL], m: M_SSE });
  const { provider, restore } = setup(fetchImpl);
  try {
    const models = await provider.provideLanguageModelChatInformation({}, token());
    const model = models.find((/** @type {any} */ m) => m.id === 'google-claude-sonnet-5');
    const messages = [{ role: 1, content: [text('hi')] }];
    const opts1 = { toolMode: 1, tools: [{ name: 'readFile', inputSchema: {} }], modelOptions: { _conversationId: 'conv-fixed' } };
    await provider.provideLanguageModelChatResponse(model, messages, opts1, { report() {} }, token());
    const opts2 = { toolMode: 1, tools: [{ name: 'readFile', inputSchema: {} }, { name: 'newTool', inputSchema: {} }], modelOptions: { _conversationId: 'conv-fixed' } };
    await provider.provideLanguageModelChatResponse(model, messages, opts2, { report() {} }, token());

    const mCalls = fetchImpl.calls.filter((c) => c.url.endsWith('/server/anthropic/v1/messages'));
    assert.equal(mCalls.length, 2);
    assert.deepEqual(mCalls[0].body.tools.map((/** @type {any} */ t) => t.name), ['readFile']);
    assert.deepEqual(mCalls[1].body.tools.map((/** @type {any} */ t) => t.name), ['readFile'], 'newTool must be held back until a new conversation');
  } finally {
    restore();
  }
});

test('asksage.interceptUtilityRequests (opt-in): a title-generation call is answered locally, no network call', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL] });
  const { send, context, restore } = setup(fetchImpl, { 'asksage.interceptUtilityRequests': true });
  try {
    const titleSystem =
      'You are an expert in crafting ultra-compact titles for chatbot conversations. You are presented with a chat request, and you reply with only a brief title.';
    const titleUser = 'Please write a brief title for the following request:\n\nFix the login bug';
    const out = await send('gpt-4.1-nano', [{ role: 1, content: [text(titleSystem)] }, { role: 1, content: [text(titleUser)] }]);
    const textOut = out.filter((p) => p instanceof parts.LanguageModelTextPart).map((p) => p.value).join('');
    assert.ok(textOut.length > 0);

    const modelCalls = fetchImpl.calls.filter((c) => c.url.includes('/chat/completions') || c.url.includes('/responses') || c.url.includes('/messages'));
    assert.equal(modelCalls.length, 0, 'an intercepted request must never reach the network');

    const records = readAll(path.join(context.globalStorageUri.fsPath, 'ledger'));
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'intercepted');
    assert.equal(records[0].estAsCost, 0);
  } finally {
    restore();
  }
});

test('asksage.interceptUtilityRequests off by default: the same title-shaped call goes through as a normal request', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL], cc: CC_SSE });
  const { send, restore } = setup(fetchImpl);
  try {
    const titleSystem = 'You are an expert in crafting ultra-compact titles for chatbot conversations.';
    await send('gpt-4.1-nano', [{ role: 1, content: [text(titleSystem)] }]);
    const modelCalls = fetchImpl.calls.filter((c) => c.url.endsWith('/server/openai/v1/chat/completions'));
    assert.equal(modelCalls.length, 1, 'off by default: must go through to Ask Sage like any other request');
  } finally {
    restore();
  }
});

test('a bogus catalog max_output is corrected from the server\'s rejection and remembered (live finding, 2026-09-27)', async () => {
  // gpt-5.6-luna's real catalog reports limits.max_output: 900000; a real server rejected that
  // with "supports at most 32768 completion tokens". First call must send the catalog value,
  // get rejected, retry once with the corrected value, and a second request to the same model
  // must go straight to the corrected value without hitting the error again.
  const bogusModel = { id: 'gpt-5.6-luna', cui_capable: true, limits: { max_context: 1000000, max_output: 900000 } };
  const rSequence = [openaiErrorResponse('max_tokens is too large: 900000. This model supports at most 32768 completion tokens, whereas you provided 900000.'), sseResponse(R_SSE)];
  const fetchImpl = createFakeFetch({ models: [bogusModel], rSequence, r: R_SSE });
  const { send, restore } = setup(fetchImpl);
  try {
    const out = await send('gpt-5.6-luna', [{ role: 1, content: [text('hi')] }]);
    assert.ok(out.some((p) => p instanceof parts.LanguageModelTextPart), 'the retried request must still produce a reply');

    const rCalls = fetchImpl.calls.filter((c) => c.url.endsWith('/server/openai/v1/responses'));
    assert.equal(rCalls.length, 2, 'one rejected attempt, one corrected retry');
    assert.equal(rCalls[0].body.max_output_tokens, 900000);
    assert.equal(rCalls[1].body.max_output_tokens, 32768);

    // A second request to the same model must use the learned cap from the first call, with no error.
    const out2 = await send('gpt-5.6-luna', [{ role: 1, content: [text('hi again')] }]);
    assert.ok(out2.some((p) => p instanceof parts.LanguageModelTextPart));
    const rCallsAfter = fetchImpl.calls.filter((c) => c.url.endsWith('/server/openai/v1/responses'));
    assert.equal(rCallsAfter.length, 3, 'the second request must not re-hit the rejection');
    assert.equal(rCallsAfter[2].body.max_output_tokens, 32768);
  } finally {
    restore();
  }
});

test('a cache write reported without a TTL split (R/CC) still lands in the ledger, not silently dropped', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL, R_MODEL], r: R_SSE_CACHE_WRITE });
  const { send, context, restore } = setup(fetchImpl);
  try {
    await send('gpt-5.4-nano', [{ role: 1, content: [text('hi')] }]);
    const records = readAll(path.join(context.globalStorageUri.fsPath, 'ledger'));
    assert.equal(records.length, 1);
    // Real ledger data (2026-09-27) showed this as inputUncached:3, cacheWrite5m:0 -- indistinguishable
    // from no cache activity at all -- while a later round's cacheRead proved a write must have happened.
    assert.equal(records[0].cacheWrite5m, 10000, 'the unsplit cache write must be visible in the ledger, folded into cacheWrite5m');
  } finally {
    restore();
  }
});

test('sends the model\'s maxOutputTokens as an explicit output cap on both flavors (PLAN §3.5)', async () => {
  const ccFetch = createFakeFetch({ models: [CC_MODEL, R_MODEL], cc: CC_SSE });
  const { send: sendCC, restore: restoreCC } = setup(ccFetch);
  try {
    await sendCC('gpt-4.1-nano', [{ role: 1, content: [text('hi')] }]);
    const ccCall = ccFetch.calls.find((c) => c.url.endsWith('/server/openai/v1/chat/completions'));
    assert.equal(ccCall?.body.max_completion_tokens, 4096);
  } finally {
    restoreCC();
  }

  const rFetch = createFakeFetch({ models: [CC_MODEL, R_MODEL], r: R_SSE });
  const { send: sendR, restore: restoreR } = setup(rFetch);
  try {
    await sendR('gpt-5.4-nano', [{ role: 1, content: [text('hi')] }]);
    const rCall = rFetch.calls.find((c) => c.url.endsWith('/server/openai/v1/responses'));
    assert.equal(rCall?.body.max_output_tokens, 4096);
  } finally {
    restoreR();
  }
});

test('provideLanguageModelChatInformation lists M/CC/R models (Gemini still excluded, Phase 4)', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL, R_MODEL, { id: 'google-claude-45-haiku', cui_capable: true }, { id: 'google-gemini-3.5-flash', cui_capable: true }] });
  const { provider, restore } = setup(fetchImpl);
  try {
    const models = await provider.provideLanguageModelChatInformation({}, token());
    assert.deepEqual(models.map((/** @type {any} */ m) => m.id).sort(), ['google-claude-45-haiku', 'gpt-4.1-nano', 'gpt-5.4-nano']);
  } finally {
    restore();
  }
});

test('provideLanguageModelChatInformation intersects the catalog with the org force_models (PLAN §2.3)', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL, R_MODEL], forceModels: 'gpt-4.1-nano' }); // the spec's comma-separated form
  const { provider, restore } = setup(fetchImpl);
  try {
    const models = await provider.provideLanguageModelChatInformation({}, token());
    assert.deepEqual(models.map((/** @type {any} */ m) => m.id), ['gpt-4.1-nano']);
    await assert.rejects(
      provider.provideLanguageModelChatResponse({ id: 'gpt-5.4-nano' }, [], { toolMode: 1 }, { report() {} }, token()),
      /not in this tenant's catalog/
    );
  } finally {
    restore();
  }
});

test('the model list is unrestricted when force_models cannot be read (no email set)', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL, R_MODEL], forceModels: 'gpt-4.1-nano' });
  const { provider, restore } = setup(fetchImpl, { 'asksage.email': '' });
  try {
    const models = await provider.provideLanguageModelChatInformation({}, token());
    assert.deepEqual(models.map((/** @type {any} */ m) => m.id).sort(), ['gpt-4.1-nano', 'gpt-5.4-nano']);
  } finally {
    restore();
  }
});

test('asksage.showStatus reports the budget and updates the status bar; setApiKey/clearApiKey round-trip through SecretStorage', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL] });
  const { vscode, registered, context, restore } = setup(fetchImpl);
  try {
    await registered.commands['asksage.showStatus']();
    assert.equal(registered.messages.length, 1);
    assert.match(registered.messages[0], /150000 of 200000 tokens remaining/);

    vscode.window.showInputBox = async () => 'a-new-key';
    await registered.commands['asksage.setApiKey']();
    assert.equal(await context.secrets.get(SECRET_KEY), 'a-new-key');
    await registered.commands['asksage.clearApiKey']();
    assert.equal(await context.secrets.get(SECRET_KEY), undefined);
  } finally {
    restore();
  }
});

test('the spend cap stops a synthetic runaway loop wired through the real request path', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL], cc: CC_SSE });
  // A tiny session cap (3 AS tokens): the first request (~3.75 AS tokens) is let through (the
  // cap only blocks *before* sending, per PLAN §3.5), but it pushes the conversation over the
  // cap, so a second request in the same conversation must be refused before any bytes go out.
  const { send, context, restore } = setup(fetchImpl, { 'asksage.budget.sessionCapTokens': 3 });
  try {
    const messages = [{ role: 1, content: [text('hi')] }]; // same first message -> same conversationId
    const first = await send('gpt-4.1-nano', messages);
    assert.ok(first.some((p) => p instanceof parts.LanguageModelTextPart));

    await assert.rejects(() => send('gpt-4.1-nano', messages), /spend cap reached/);

    const records = readAll(path.join(context.globalStorageUri.fsPath, 'ledger'));
    assert.equal(records.length, 1, 'the blocked second request never reached the transport or the ledger');
  } finally {
    restore();
  }
});

test('a session cap lowered after activation applies to the next request (live finding, 2026-09-27)', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL], cc: CC_SSE });
  // Activated with the default cap (50000); the user then lowers it in Settings without a reload.
  const { send, config, context, restore } = setup(fetchImpl);
  try {
    const messages = [{ role: 1, content: [text('hi')] }];
    await send('gpt-4.1-nano', messages);
    config['asksage.budget.sessionCapTokens'] = 3;
    await assert.rejects(() => send('gpt-4.1-nano', messages), /spend cap reached/);
    assert.equal(readAll(path.join(context.globalStorageUri.fsPath, 'ledger')).length, 1);
  } finally {
    restore();
  }
});

test('the folder commands linked from the settings reveal the newest ledger file, or the folder when empty', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL], cc: CC_SSE });
  const { send, registered, context, restore } = setup(fetchImpl);
  try {
    await registered.commands['asksage.openDebugLogFolder']();
    assert.deepEqual(registered.executed.at(-1), { id: 'revealFileInOS', args: [{ scheme: 'file', fsPath: path.join(context.globalStorageUri.fsPath, 'debug') }] });
    await send('gpt-4.1-nano', [{ role: 1, content: [text('hi')] }]);
    await registered.commands['asksage.openLedgerFolder']();
    const revealed = registered.executed.at(-1)?.args[0].fsPath;
    assert.equal(path.dirname(revealed), path.join(context.globalStorageUri.fsPath, 'ledger'));
    assert.match(path.basename(revealed), /\.jsonl$/);
  } finally {
    restore();
  }
});

test('asksage.debug.logRequests is off by default, and writes the real request/response when turned on', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL], cc: CC_SSE });
  const off = setup(fetchImpl);
  try {
    await off.send('gpt-4.1-nano', [{ role: 1, content: [text('hi')] }]);
    assert.equal(fs.existsSync(path.join(off.context.globalStorageUri.fsPath, 'debug')), false, 'no debug directory at all when the setting is off');
  } finally {
    off.restore();
  }

  const fetchImpl2 = createFakeFetch({ models: [CC_MODEL], cc: CC_SSE });
  const on = setup(fetchImpl2, { 'asksage.debug.logRequests': true });
  try {
    await on.send('gpt-4.1-nano', [{ role: 1, content: [text('hi')] }]);
    const records = readAll(path.join(on.context.globalStorageUri.fsPath, 'debug'));
    assert.equal(records.length, 1);
    const r = /** @type {any} */ (records[0]);
    assert.equal(r.model, 'gpt-4.1-nano');
    assert.equal(r.request.messages[0].content, 'hi');
    assert.equal(r.responseText, 'Hello world');
  } finally {
    on.restore();
  }
});
