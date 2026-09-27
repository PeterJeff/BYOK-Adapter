// @ts-check
'use strict';

// End-to-end (within node:test): drives src/extension.js's provider through a CC and an R
// request with an injected fetch, matching PLAN.md §9 Phase 1 accept criteria: GPT-5.x through R
// and a non-GPT^H^Hnon-reasoning model through CC stream in Ask mode; every request lands in
// the ledger with a normalized, estimated cost. No real network access.

const test = require('node:test');
const assert = require('node:assert/strict');
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

const CC_MODEL = { id: 'gpt-4.1-nano', cui_capable: true };
const R_MODEL = { id: 'gpt-5.4-nano', cui_capable: true };

const CC_SSE =
  'data: {"id":"1","model":"gpt-4.1-nano-2026-01-01","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
  'data: {"choices":[{"index":0,"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":50,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":0}}}\n\n' +
  'data: [DONE]\n\n';

const R_SSE =
  'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n' +
  'data: {"type":"response.completed","response":{"model":"gpt-5.4-nano-2026-01-01","status":"completed","usage":{"input_tokens":40,"input_tokens_details":{"cached_tokens":0},"output_tokens":3,"output_tokens_details":{"reasoning_tokens":0}}}}\n\n' +
  'data: [DONE]\n\n';

/** @param {{ models: unknown[], cc?: string, r?: string }} o */
function createFakeFetch(o) {
  const calls = /** @type {string[]} */ ([]);
  const fn = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push(url);
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    if (url.endsWith('/server/get-models?format=full')) return jsonResponse(o.models);
    if (url.endsWith('/user/get-token-with-api-key')) return jsonResponse({ response: { access_token: 'jwt-1' } });
    if (url.endsWith('/user/validate_token_with_full_user')) return jsonResponse({ response: { max_tokens: 200000 } });
    if (url.endsWith('/server/count-monthly-tokens-left-with-org')) return jsonResponse({ response: 150000 });
    if (url.endsWith('/server/count-monthly-tokens')) return jsonResponse({ response: 50000 });
    if (url.endsWith('/server/tokenizer')) {
      const isOne = body.content === 'x';
      if (!body.convert_to_asksage) return numResponse(isOne ? 1 : 2000);
      if (body.completion_estimate) return numResponse(250000.06);
      return numResponse(isOne ? 0.06 : 100.01); // prompt rate 0.05, completion rate 0.25
    }
    if (url.endsWith('/server/openai/v1/chat/completions') && o.cc) return sseResponse(o.cc);
    if (url.endsWith('/server/openai/v1/responses') && o.r) return sseResponse(o.r);
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
   * @param {string} modelId
   * @param {any[]} messages
   */
  async function send(modelId, messages) {
    /** @type {any[]} */
    const out = [];
    await provider.provideLanguageModelChatResponse({ id: modelId }, messages, { toolMode: 1 }, { report: (/** @type {any} */ p) => out.push(p) }, token());
    return out;
  }
  function restore() {
    globalThis.fetch = realFetch;
  }
  return { vscode, registered, provider, send, context, restore };
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

test('provideLanguageModelChatInformation only lists CC/R models (Claude/Gemini excluded, Phase 1)', async () => {
  const fetchImpl = createFakeFetch({ models: [CC_MODEL, R_MODEL, { id: 'google-claude-45-haiku', cui_capable: true }] });
  const { provider, restore } = setup(fetchImpl);
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
