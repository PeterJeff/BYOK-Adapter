// @ts-check
'use strict';

// The API key lives only in SecretStorage (CLAUDE.md security rule): never logged, printed,
// or written to a fixture.

const SECRET_KEY = 'asksage.apiKey';

/**
 * @param {import('vscode').ExtensionContext} context
 */
function createCredentials(context) {
  return {
    /** @returns {Promise<string | undefined>} */
    getApiKey: () => context.secrets.get(SECRET_KEY),
    /** @param {string} key */
    setApiKey: (key) => context.secrets.store(SECRET_KEY, key),
    clearApiKey: () => context.secrets.delete(SECRET_KEY),
  };
}

/**
 * @param {import('vscode')} vscode
 * @param {ReturnType<typeof createCredentials>} credentials
 */
function registerCommands(vscode, credentials) {
  return [
    vscode.commands.registerCommand('asksage.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'Ask Sage: Set API Key',
        prompt: 'Paste the Ask Sage API key. It is stored only in SecretStorage.',
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await credentials.setApiKey(key.trim());
      vscode.window.showInformationMessage('Ask Sage: API key saved.');
    }),
    vscode.commands.registerCommand('asksage.clearApiKey', async () => {
      await credentials.clearApiKey();
      vscode.window.showInformationMessage('Ask Sage: API key cleared.');
    }),
  ];
}

module.exports = { createCredentials, registerCommands, SECRET_KEY };
