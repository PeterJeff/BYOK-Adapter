// @ts-check
'use strict';

// Remaining budget and the last request's cost (PLAN.md §3.3/§3.4), feature-detected so a
// stub or older VS Code without createStatusBarItem degrades silently.

/**
 * @param {import('vscode')} vscode
 */
function createStatusBar(vscode) {
  const canCreate = typeof (/** @type {any} */ (vscode).window).createStatusBarItem === 'function';
  const item = canCreate ? vscode.window.createStatusBarItem(/** @type {any} */ (vscode).StatusBarAlignment?.Right, 100) : null;
  if (item) {
    item.name = 'Ask Sage';
    item.text = '$(sparkle) Ask Sage';
    item.show();
  }
  return {
    item,
    /** @param {{ remaining?: number | null, lastCostAs?: number | null }} status */
    update(status) {
      if (!item) return;
      const remainingText = typeof status.remaining === 'number' ? status.remaining.toLocaleString() : '?';
      item.text = `$(sparkle) Ask Sage: ${remainingText} left`;
      item.tooltip = typeof status.lastCostAs === 'number' ? `Last request: ~${status.lastCostAs} Ask Sage tokens` : 'Ask Sage';
    },
    dispose() {
      if (item) item.dispose();
    },
  };
}

module.exports = { createStatusBar };
