// @ts-check
'use strict';

// Just enough of the `vscode` module to activate the smoke extension and drive its
// provider under node:test. Only members the extension touches are modelled.

const Module = require('module');

class LanguageModelTextPart {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }
}
class LanguageModelToolCallPart {
  /** @param {string} callId @param {string} name @param {object} input */
  constructor(callId, name, input) {
    this.callId = callId;
    this.name = name;
    this.input = input;
  }
}
class LanguageModelToolResultPart {
  /** @param {string} callId @param {unknown[]} content */
  constructor(callId, content) {
    this.callId = callId;
    this.content = content;
  }
}
class LanguageModelDataPart {
  /** @param {Uint8Array} data @param {string} mimeType */
  constructor(data, mimeType) {
    this.data = data;
    this.mimeType = mimeType;
  }
  /** @param {unknown} value @param {string} [mime] */
  static json(value, mime = 'text/x-json') {
    return new LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(value)), mime);
  }
}
class LanguageModelThinkingPart {
  /** @param {string | string[]} value @param {string} [id] @param {object} [metadata] */
  constructor(value, id, metadata) {
    this.value = value;
    this.id = id;
    this.metadata = metadata;
  }
}
class LanguageModelError extends Error {
  /** @param {string} [m] */
  static Blocked(m) {
    const e = new LanguageModelError(m);
    e.code = 'Blocked';
    return e;
  }
  code = '';
}

/**
 * @param {{ thinking?: boolean }} [opts] thinking:false simulates a VS Code without the proposed class
 */
function createStub(opts = {}) {
  const registered = { providers: /** @type {Record<string, any>} */ ({}), commands: /** @type {Record<string, Function>} */ ({}), documents: /** @type {string[]} */ ([]), messages: /** @type {string[]} */ ([]) };
  /** @type {Record<string, unknown>} */
  const config = {};
  const disposable = { dispose() {} };
  const vscode = {
    version: '1.999.0-stub',
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelDataPart,
    LanguageModelThinkingPart: opts.thinking === false ? undefined : LanguageModelThinkingPart,
    LanguageModelError,
    LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
    LanguageModelChatToolMode: { Auto: 1, Required: 2 },
    LanguageModelChatMessage: { User: (/** @type {string} */ t) => ({ role: 1, content: [new LanguageModelTextPart(t)] }) },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    ExtensionKind: { UI: 1, Workspace: 2 },
    UIKind: { Desktop: 1, Web: 2 },
    ProgressLocation: { Notification: 15 },
    CancellationTokenSource: class {
      token = { isCancellationRequested: false, onCancellationRequested: () => disposable };
      cancel() {
        this.token.isCancellationRequested = true;
      }
      dispose() {}
    },
    env: { appName: 'Stub Code', appHost: 'desktop', remoteName: undefined, uiKind: 1 },
    lm: {
      /** @param {string} vendor @param {any} provider */
      registerLanguageModelChatProvider(vendor, provider) {
        registered.providers[vendor] = provider;
        return disposable;
      },
      async selectChatModels() {
        return [];
      },
    },
    commands: {
      /** @param {string} id @param {Function} fn */
      registerCommand(id, fn) {
        registered.commands[id] = fn;
        return disposable;
      },
    },
    window: {
      createOutputChannel() {
        const noop = () => {};
        return { info: noop, debug: noop, warn: noop, error: noop, appendLine: noop, dispose: noop };
      },
      async showTextDocument() {},
      /** @param {string} m */
      async showInformationMessage(m) {
        registered.messages.push(m);
        return undefined;
      },
      async showWarningMessage() {
        return undefined;
      },
      /** @param {string} m */
      async showErrorMessage(m) {
        registered.messages.push(m);
        return undefined;
      },
      async showInputBox() {
        return undefined;
      },
      /** @param {any} _o @param {Function} task */
      withProgress(_o, task) {
        return task();
      },
    },
    workspace: {
      isTrusted: true,
      /** @param {string} [section] */
      getConfiguration(section) {
        return {
          /** @param {string} key @param {unknown} [def] */
          get(key, def) {
            const full = section ? `${section}.${key}` : key;
            return full in config ? config[full] : def;
          },
        };
      },
      /** @param {{ content: string }} o */
      async openTextDocument(o) {
        registered.documents.push(o.content);
        return {};
      },
    },
    extensions: { getExtension: () => undefined },
  };
  return { vscode, registered, config };
}

/**
 * Loads a module with `require('vscode')` answered by the stub.
 * @param {string} modulePath
 * @param {any} vscode
 */
function loadWithStub(modulePath, vscode) {
  const resolved = require.resolve(modulePath);
  // Fresh copies of the extension and its libs for every test.
  for (const key of Object.keys(require.cache)) if (key.includes('smoke-extension')) delete require.cache[key];
  const M = /** @type {any} */ (Module);
  const original = M._load;
  M._load = function (/** @type {string} */ request, /** @type {any[]} */ ...rest) {
    if (request === 'vscode') return vscode;
    return original.call(this, request, ...rest);
  };
  try {
    return require(resolved);
  } finally {
    M._load = original;
  }
}

function createContext() {
  /** @type {Map<string, unknown>} */
  const store = new Map();
  return {
    subscriptions: /** @type {any[]} */ ([]),
    extensionMode: 1,
    globalState: {
      /** @param {string} k */
      get: (k) => store.get(k),
      /** @param {string} k @param {unknown} v */
      update: (k, v) => {
        store.set(k, JSON.parse(JSON.stringify(v)));
        return Promise.resolve();
      },
    },
    extension: {
      id: 'byok-adapter.asksage-smoke',
      extensionPath: '/home/tester/.vscode/extensions/byok-adapter.asksage-smoke-0.1.0',
      extensionKind: 2,
      packageJSON: { version: '0.1.0', __metadata: { source: 'vsix' } },
    },
    store,
  };
}

module.exports = {
  createStub,
  loadWithStub,
  createContext,
  parts: { LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelToolResultPart, LanguageModelDataPart, LanguageModelThinkingPart },
};
