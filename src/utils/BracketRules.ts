/**
 * Bracket rules for plain text inputs that pair brackets and complete links,
 * matched to Obsidian's editor (CodeMirror 6 closeBrackets). A leaf utility:
 * the pairing widget (modals/form/bracketPairing) and the link completion
 * (suggest/LinkTagCandidates) both read it, so the two agree on what a closer
 * after the caret means.
 */

export const BRACKET_PAIRS: Readonly<Record<string, string>> = {
    '(': ')', '[': ']',
    '（': '）', '［': '］',
    '「': '」', '『': '』', '【': '】',
    '｛': '｝', '〈': '〉', '《': '》',
};

export const BRACKET_CLOSERS: ReadonlySet<string> = new Set(Object.values(BRACKET_PAIRS));

/**
 * Whether an opener just typed gets its closer, judged by the character now
 * after the caret. As CodeMirror does: only at the end, before whitespace, or
 * before a closer (so `[` inside `[]` makes `[[]]`). Before a word the opener
 * stays alone, since the user is wrapping or linking that word.
 */
export function shouldAutoClose(nextChar: string | undefined): boolean {
    return nextChar === undefined || nextChar === ''
        || /\s/.test(nextChar)
        || BRACKET_CLOSERS.has(nextChar);
}

/**
 * How many characters after the caret close the `[[` a link completion
 * writes over: the `]]` pairing left (`[[|]]`), or a `]` alone. The
 * completion writes a whole link of its own (`[[note]]`, or `[note](note.md)`
 * with Markdown links), so it takes them over and leaves any other text.
 */
export function linkClosersAfter(afterCaret: string): number {
    if (afterCaret.startsWith(']]')) return 2;
    return afterCaret.startsWith(']') ? 1 : 0;
}
