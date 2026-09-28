// @ts-check
'use strict';

// Detects Copilot's own internal "utility" LM calls -- generating a chat title, or a progress
// message shown in the sidebar while a real request runs -- which arrive through
// provideLanguageModelChatResponse exactly like a real chat turn (src/extension.js), with no
// distinct channel of their own. They're indistinguishable except by content: a fixed system
// prompt with exact wording Microsoft ships (two real examples pasted into this project
// 2026-09-27), no tools, and a short message list. Matching is deliberately narrow -- the literal
// phrasing, not a loose heuristic -- so it fails open: anything that doesn't match goes through as
// an ordinary request and is billed and answered normally. Pure: no vscode import.
//
// Gated behind asksage.interceptUtilityRequests (off by default until seen against real traffic,
// since this project can't currently verify it live without spending tokens the owner is
// conserving until the monthly reset).

const TITLE_SIGNATURE = 'ultra-compact titles for chatbot conversations';
const PROGRESS_SIGNATURE = 'progress messages for a coding assistant';

const TITLE_USER_RE = /write a brief title for the following request:\s*\n\s*\n([\s\S]*)/i;
const PROGRESS_COUNT_RE = /generate exactly (\d+)/i;

/**
 * @param {readonly any[]} messages
 * @param {{ TextPart: Function, ToolCallPart: Function, ToolResultPart: Function }} ctors
 * @param {(message: any, ctors: any) => string} textOf src/convert/messages.js's textOf, injected to avoid a require cycle
 * @param {readonly unknown[] | undefined} tools this turn's tools -- a real chat turn always carries Copilot's tool list; a utility call never does
 * @returns {{ kind: 'title' | 'progress', userText: string } | null}
 */
function classifyUtilityRequest(messages, ctors, textOf, tools) {
  if (tools && tools.length) return null;
  if (!messages.length) return null;
  const first = textOf(messages[0], ctors);
  if (first.includes(TITLE_SIGNATURE)) {
    const last = textOf(messages[messages.length - 1], ctors);
    const m = TITLE_USER_RE.exec(last);
    return { kind: 'title', userText: (m ? m[1] : last).trim() };
  }
  if (first.includes(PROGRESS_SIGNATURE)) {
    return { kind: 'progress', userText: textOf(messages[messages.length - 1], ctors) };
  }
  return null;
}

/** Generic, content-free progress phrases -- these were never the point of the real call: the UI
 *  just wants *some* short encouraging text to show while the real request streams. */
const GENERIC_PROGRESS_MESSAGES = [
  'Warming up the algorithms',
  'Brewing some fresh code',
  'Crafting your solution',
  'Thinking through the logic',
  'Untangling the details',
  'Piecing it together',
  'Sketching out the changes',
  'Polishing the approach',
  'Lining up the edits',
  'Almost there, hang tight',
];

/** @param {string} userText */
function synthesizeProgressMessages(userText) {
  const m = PROGRESS_COUNT_RE.exec(userText);
  const requested = m ? Number(m[1]) : 10;
  const count = Number.isFinite(requested) && requested > 0 ? Math.min(requested, GENERIC_PROGRESS_MESSAGES.length) : GENERIC_PROGRESS_MESSAGES.length;
  return JSON.stringify(GENERIC_PROGRESS_MESSAGES.slice(0, count));
}

/**
 * A short, offline title heuristic: the first sentence of the user's own request text, trimmed to
 * a handful of words, sentence case. Not as good as an LLM's, but free, and good enough for a
 * cosmetic sidebar label -- the same tradeoff PLAN.md §3.5's local token estimator makes.
 * @param {string} userText
 */
function synthesizeTitle(userText) {
  const firstLine =
    userText
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || userText.trim();
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0];
  const words = firstSentence.split(/\s+/).filter(Boolean);
  const trimmed = words
    .slice(0, 6)
    .join(' ')
    .replace(/[.!?:,;]+$/, '');
  if (!trimmed) return 'Chat';
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

module.exports = { classifyUtilityRequest, synthesizeProgressMessages, synthesizeTitle, TITLE_SIGNATURE, PROGRESS_SIGNATURE };
