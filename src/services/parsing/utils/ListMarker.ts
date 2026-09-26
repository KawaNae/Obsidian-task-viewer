/**
 * Shared bullet-marker fragment for markdown list items: `-`, `*`, `+`, or
 * an ordered marker of any number of digits (`1.`/`1)`). Obsidian 1.12.4
 * reads `1234567890. [ ] x` as a task in `listItems` and draws a checkbox for
 * it in the reading view, past CommonMark's nine digits (the L2 gate).
 * Interpolate into a larger regex rather than writing the pattern out again —
 * every parser that recognizes a list line, the outline's items included,
 * needs the same definition of "bullet".
 */
export const LIST_BULLET_SOURCE = '(?:[-*+]|\\d+[.)])';

/**
 * The two characters Markdown structure is spaced with, as a regex fragment:
 * a space and a tab. A no-break space, a full-width space, U+2028 and U+2029
 * are not among them — Obsidian neither indents with them nor reads them as
 * a checkbox's gap (R0, L1). Indentation (`Outline`) and the gap after a
 * checkbox are made of this one.
 */
export const SPACE_OR_TAB_SOURCE = '[ \\t]';

/**
 * What stands between a list marker and a checkbox's `[` for the line to be
 * a task, as a regex fragment: one to four spaces, or one tab. Obsidian
 * 1.12.4 reads `-[ ] x` as no list item at all; five spaces, a space and a
 * tab, or two tabs as a list item with no task (five spaces open indented
 * code); a no-break or a full-width space as no list item — in `listItems`
 * and in the reading view alike, for every marker, at the top level and
 * nested (L1). Live Preview draws a checkbox after anything at all, which is
 * Obsidian's own disagreement.
 */
export const MARKER_GAP_SOURCE = '(?: {1,4}|\\t)';

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

/**
 * What must follow a checkbox's `]` for the line to be a task, as a regex
 * fragment: a space or a tab. Obsidian 1.12.4 reads `- [ ]x`, `- [ ]` with
 * nothing after it, and `]` followed by a no-break space, a full-width space,
 * U+2028 or U+2029 as a list item with no task — in `listItems` and in the
 * reading view. `- [ ] ` with nothing but the space is a task with no content.
 */
export const CHECKBOX_GAP_SOURCE = SPACE_OR_TAB_SOURCE;
