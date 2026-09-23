/**
 * Shared bullet-marker fragment for markdown list items: `-`, `*`, `+`, or
 * an ordered marker (`1.`/`1)`). Interpolate into a larger regex rather than
 * writing the pattern out again — every parser that recognizes a list line
 * needs the same definition of "bullet".
 */
export const LIST_BULLET_SOURCE = '(?:[-*+]|\\d+[.)])';

/**
 * The one character inside a checkbox's brackets, as a regex fragment.
 *
 * Any character but a line terminator, and not U+2028 or U+2029 either:
 * Obsidian 1.12.4 reads `- [<U+2028>] x` as a list item with no task, in
 * `listItems`, Live Preview and the reading view alike, while every other
 * character it was tried with (tab, NBSP, a full-width space, a zero-width
 * space, a BOM) makes a task. The two stay part of a line's content — only
 * the status cannot be one of them.
 */
export const STATUS_CHAR_SOURCE = '[^\\r\\n\\u2028\\u2029]';
