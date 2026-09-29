/**
 * Bracket rules for plain text inputs that pair brackets and complete links,
 * matched to Obsidian's editor (CodeMirror 6 closeBrackets). A leaf utility:
 * the pairing widget (modals/form/bracketPairing) and the link/tag suggest
 * (suggest/TaskNameSuggest) both read it, so the two agree on what a closer
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
 * How many characters after the caret a completion takes over, when its
 * replacement ends with closers (`[[note]]`, `[[note#heading]]`). The
 * closers already after the caret, as pairing left them, are the leading
 * part of the replacement's closing run; the completion writes its own, so
 * it takes over that part (`]]`, or `]` alone) and leaves any other text.
 */
export function closersToTakeOver(replacement: string, afterCaret: string): number {
    let run = 0;
    while (run < replacement.length && BRACKET_CLOSERS.has(replacement[replacement.length - 1 - run])) run++;
    const closing = replacement.slice(replacement.length - run);
    let n = 0;
    while (n < closing.length && afterCaret[n] === closing[n]) n++;
    return n;
}
