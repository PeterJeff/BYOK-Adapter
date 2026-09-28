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
  /** @type {{ remaining?: number | null, lastCostAs?: number | null, forecast?: string | null }} */
  const state = {};
  return {
    item,
    /**
     * Merges into the last known state, so a cost-only update keeps the known balance.
     * @param {{ remaining?: number | null, lastCostAs?: number | null, forecast?: string | null }} status
     */
    update(status) {
      Object.assign(state, status);
      if (!item) return;
      const remainingText = typeof state.remaining === 'number' ? state.remaining.toLocaleString() : '?';
      item.text = `$(sparkle) Ask Sage: ${remainingText} left`;
      const lines = [];
      if (typeof state.lastCostAs === 'number') lines.push(`Last request: ~${state.lastCostAs} Ask Sage tokens`);
      if (state.forecast) lines.push(state.forecast); // PLAN.md §3.5 burn-rate forecast
      item.tooltip = lines.length ? lines.join('\n') : 'Ask Sage';
    },
    state,
    dispose() {
      if (item) item.dispose();
    },
  };
}

module.exports = { createStatusBar };
