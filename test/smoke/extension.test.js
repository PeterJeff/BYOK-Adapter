// @ts-check
'use strict';

// Drives the smoke provider through a Copilot-like conversation using the vscode stub.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createStub, loadWithStub, createContext, parts } = require('../helpers/vscode-stub');

const EXT = path.join(__dirname, '../../phase0/smoke-extension/extension.js');
const text = (/** @type {string} */ v) => new parts.LanguageModelTextPart(v);
const token = () => ({ isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) });

/** @param {{ thinking?: boolean }} [opts] */
function setup(opts) {
  const { vscode, registered, config } = createStub(opts);
  config['asksageSmoke.chunkDelayMs'] = 0;
  const ext = loadWithStub(EXT, vscode);
  const context = createContext();
  ext.activate(context);
  const provider = registered.providers['asksage-smoke'];
  /**
   * @param {any[]} messages
   * @param {any} [options]
   * @param {any} [tok]
   */
  async function send(messages, options = {}, tok = token()) {
    /** @type {any[]} */
    const out = [];
    await provider.provideLanguageModelChatResponse({ id: 'asksage-smoke-echo' }, messages, { toolMode: 1, ...options }, { report: (/** @type {any} */ p) => out.push(p) }, tok);
    return out;
  }
  async function reportText() {
    await registered.commands['asksageSmoke.showReport']();
    return registered.documents[registered.documents.length - 1];
  }
  return { vscode, registered, provider, send, reportText, context };
}

/** @param {any[]} out */
const joinedText = (out) => out.filter((p) => p instanceof parts.LanguageModelTextPart).map((p) => p.value).join('');

test('lists two models, one with a numeric tool limit', async () => {
  const { provider } = setup();
  const models = await provider.provideLanguageModelChatInformation({ silent: true }, token());
  assert.deepEqual(models.map((/** @type {any} */ m) => [m.id, m.capabilities.toolCalling]), [
    ['asksage-smoke-echo', true],
    ['asksage-smoke-echo-128', 128],
  ]);
  for (const m of models) for (const k of ['id', 'name', 'family', 'version', 'maxInputTokens', 'maxOutputTokens']) assert.ok(m[k], `${m.id} lacks ${k}`);
});

test('full conversation: echo, tool round trip and E4 round trip', async () => {
  const { send, reportText } = setup();

  // Turn 1, Ask mode.
  const out1 = await send([{ role: 1, content: [text('hello')] }], { modelOptions: { _conversationId: 'conv-1' } });
  assert.ok(out1[0] instanceof parts.LanguageModelThinkingPart, 'thinking comes first');
  const dataParts = out1.filter((p) => p instanceof parts.LanguageModelDataPart);
  assert.deepEqual(dataParts.map((p) => p.mimeType), ['application/vnd.asksage.smoke+json', 'usage']);
  const usage = JSON.parse(new TextDecoder().decode(dataParts[1].data));
  assert.equal(usage.total_tokens, usage.prompt_tokens + usage.completion_tokens);
  const t1 = joinedText(out1);
  assert.match(t1, /Ask Sage smoke echo\*\*: request #1/);
  const nonce1 = /smk-1-[a-z0-9]{6}/.exec(t1)?.[0];
  assert.ok(nonce1);

  // Turn 2, Agent mode: history carries turn 1's parts; ask for a tool call.
  const tools = [{ name: 'fake_read', description: 'reads', inputSchema: { type: 'object' } }];
  const history = [{ role: 1, content: [text('hello')] }, { role: 2, content: out1 }];
  const out2 = await send([...history, { role: 1, content: [text('<userRequest>smoke:tool fake_read {"path":"a.txt"}</userRequest>')] }], { tools });
  const call = out2.find((p) => p instanceof parts.LanguageModelToolCallPart);
  assert.ok(call, 'a tool call was emitted');
  assert.equal(call.name, 'fake_read');
  assert.deepEqual(call.input, { path: 'a.txt' });
  // The tool-call reply also carries thinking, a tagged text part and an opaque data part (E4 in a tool loop).
  const nonce2 = /smk-2-[a-z0-9]{6}/.exec(joinedText(out2))?.[0];
  assert.ok(nonce2, 'the tool-call reply is tagged with its nonce');
  assert.ok(out2.some((p) => p instanceof parts.LanguageModelThinkingPart), 'thinking accompanies the tool call');
  assert.deepEqual(out2.filter((p) => p instanceof parts.LanguageModelDataPart).map((p) => p.mimeType), ['application/vnd.asksage.smoke+json']);

  // Turn 3: tool result comes back; the provider must not call the tool again.
  const out3 = await send(
    [
      ...history,
      { role: 1, content: [text('smoke:tool fake_read {"path":"a.txt"}')] },
      { role: 2, content: out2 },
      { role: 1, content: [new parts.LanguageModelToolResultPart(call.callId, [text('file contents')])] },
    ],
    { tools }
  );
  assert.equal(out3.filter((p) => p instanceof parts.LanguageModelToolCallPart).length, 0);
  assert.match(joinedText(out3), /Tool result received .* \*\*E2 tool round trip works\.\*\*/);
  assert.match(joinedText(out3), new RegExp(`\\| ${nonce1} \\| yes \\| yes \\| yes \\| yes \\| yes \\|`));
  assert.match(joinedText(out3), new RegExp(`\\| ${nonce2} \\| yes \\| yes \\| yes \\| yes \\| yes \\|`), 'the tool-call reply is tracked through the tool loop');

  const md = await reportText();
  assert.match(md, /\| E1 Models in picker \| \*\*PASS\*\*/);
  assert.match(md, /\| E2 Agent mode \+ tools \| \*\*PASS\*\*/);
  assert.match(md, /\| E3 Side-loading \| \*\*PASS\*\* \| The extension is installed and running \(install source: vsix\)/);
  assert.match(md, /\| E4 Parts round-trip \| \*\*PASS\*\*/);
  assert.match(md, /\| E5 Network reach \| \*\*NOT RUN\*\*/);
  assert.match(md, /`modelOptions._conversationId` seen \(plan §3\.4\): yes/);
  assert.match(md, /Tool names seen \(1\): `fake_read`/);
  assert.doesNotMatch(md, /file contents|a\.txt|hello/, 'no prompt text in the report');
});

test('smoke:tool with an unknown tool explains instead of calling', async () => {
  const { send } = setup();
  const out = await send([{ role: 1, content: [text('smoke:tool nope')] }], { tools: [{ name: 'real', description: '', inputSchema: {} }] });
  assert.equal(out.filter((p) => p instanceof parts.LanguageModelToolCallPart).length, 0);
  assert.match(joinedText(out), /no tool named `nope`/);
});

test('smoke:tool alone lists tools; smoke:help lists commands', async () => {
  const { send } = setup();
  assert.match(joinedText(await send([{ role: 1, content: [text('smoke:tool')] }], { tools: [{ name: 'a', description: '', inputSchema: {} }] })), /carries 1 tools .*\n\n- `a`/);
  assert.match(joinedText(await send([{ role: 1, content: [text('smoke:help')] }])), /Smoke commands/);
});

test('smoke:error throws a LanguageModelError and records it', async () => {
  const { send, reportText } = setup();
  await assert.rejects(send([{ role: 1, content: [text('smoke:error')] }]), (/** @type {any} */ e) => e.code === 'Blocked');
  assert.match(await reportText(), /## Errors[\s\S]*simulated provider error/);
});

test('cancellation stops streaming and is counted', async () => {
  const { provider, reportText } = setup();
  const tok = token();
  /** @type {any[]} */
  const out = [];
  const progress = {
    report: (/** @type {any} */ p) => {
      out.push(p);
      // Press Stop as soon as the first text chunk arrives.
      if (p instanceof parts.LanguageModelTextPart) tok.isCancellationRequested = true;
    },
  };
  await provider.provideLanguageModelChatResponse({ id: 'asksage-smoke-echo' }, [{ role: 1, content: [text('hello')] }], { toolMode: 1 }, progress, tok);
  assert.equal(out.filter((p) => p instanceof parts.LanguageModelTextPart).length, 1);
  assert.match(await reportText(), /cancelled: 1/);
});

test('without the proposed thinking class, E4 still passes on the data part', async () => {
  const { send, reportText } = setup({ thinking: false });
  const out1 = await send([{ role: 1, content: [text('hello')] }]);
  assert.equal(out1.filter((p) => p instanceof parts.LanguageModelThinkingPart).length, 0);
  await send([{ role: 1, content: [text('hello')] }, { role: 2, content: out1 }, { role: 1, content: [text('again')] }]);
  const md = await reportText();
  assert.match(md, /\| E4 Parts round-trip \| \*\*PASS\*\* \| .*thinking part back 0\/0/);
  assert.match(md, /\| `LanguageModelThinkingPart \(proposed\)` \| no \|/);
});

test('provideTokenCount is local and counts calls', async () => {
  const { provider, reportText } = setup();
  assert.equal(await provider.provideTokenCount({}, 'abcdefgh', token()), 2);
  assert.equal(await provider.provideTokenCount({}, { role: 1, content: [text('abcd')] }, token()), 1);
  assert.match(await reportText(), /Token count calls: 2/);
});

test('activation survives a VS Code without the provider API', () => {
  const { vscode, registered } = createStub();
  // @ts-ignore simulate an old VS Code
  delete vscode.lm.registerLanguageModelChatProvider;
  const ext = loadWithStub(EXT, vscode);
  ext.activate(createContext());
  assert.equal(Object.keys(registered.providers).length, 0);
  assert.match(registered.messages.join('\n'), /needs 1\.104 or later/);
  assert.ok(registered.commands['asksageSmoke.showReport'], 'report command still registered');
});

test('findings persist across activations', async () => {
  const { vscode } = createStub();
  const ctx = createContext();
  loadWithStub(EXT, vscode).activate(ctx);
  const again = createStub();
  const ext2 = loadWithStub(EXT, again.vscode);
  const ctx2 = createContext();
  for (const [k, v] of ctx.store) ctx2.store.set(k, v);
  ext2.activate(ctx2);
  await again.registered.commands['asksageSmoke.showReport']();
  assert.match(again.registered.documents[0], /Activations: 2/);
});
