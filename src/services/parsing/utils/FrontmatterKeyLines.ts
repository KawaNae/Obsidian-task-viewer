import { PropertyKey } from './PropertyKey';

/** A line of the frontmatter that opens a top-level key (`frontmatterKeyLine`). */
export interface FrontmatterKeyLine {
    /** The key as YAML reads it: a quoted key without its quotes, a plain one trimmed. */
    key: string;
    /** The key as the line spells it, quotes included: what a rewrite of the line keeps. */
    written: string;
    /** Where the value begins: past the key, its colon and the spaces and tabs after them. */
    valueStart: number;
}

/**
 * The top-level key `line` opens, as YAML reads a block mapping's key: a
 * double-quoted key (`"my key": 1`), a single-quoted one (`'a: b': 1`), or
 * a plain one, which may hold spaces and a colon not followed by a space
 * (`two words: 2`, `a:b: 3`). The key's colon is the first followed by a
 * space, a tab or the line's end. Null for a line that opens no key: an
 * indented line, which goes on the value above, an item (`- a`), a comment,
 * and a line with no such colon.
 */
export function frontmatterKeyLine(line: string): FrontmatterKeyLine | null {
    const match = line.match(KEY_LINE);
    if (!match) return null;
    const [whole, double, single, plain] = match;
    const key = double !== undefined ? unescapeDouble(double)
        : single !== undefined ? single.replace(/''/g, "'")
            : plain.trim();
    // A plain key ends at a comment: ` #` opens one.
    if (plain !== undefined && /\s#/.test(plain)) return null;
    const written = whole.replace(/[ \t]*:[ \t]*$/, '');
    return { key, written, valueStart: whole.length };
}

/**
 * Where the frontmatter writes the top-level key `key`, its case aside
 * (`PropertyKey`): the range [start, end) of the key's line and the lines
 * that go on with its value (a list's items, a block scalar), up to the
 * next key's line. `fmEnd` is the line of the closing `---`. Null when no
 * line writes the key; the first such line when more than one does.
 *
 * The one answer to which lines say a frontmatter key: the resolution
 * records the key's line as the source of the value it gives
 * (`ValueSource`), and a write edits the same lines
 * (`FrontmatterLineEditor.findKeyRange`).
 */
export function frontmatterKeyRange(lines: readonly string[], fmEnd: number, key: string): [number, number] | null {
    for (let i = 1; i < fmEnd; i++) {
        const keyLine = frontmatterKeyLine(lines[i]);
        if (keyLine && PropertyKey.same(keyLine.key, key)) {
            let end = i + 1;
            while (end < fmEnd && frontmatterKeyLine(lines[end]) === null) end++;
            return [i, end];
        }
    }
    return null;
}

/**
 * A key at the line's start: double-quoted, single-quoted, or plain. A
 * plain key opens with no space and none of YAML's indicators but `-`, `?`
 * and `:` followed by a character that is no space (`-x`), and runs to the
 * first colon followed by a space, a tab or the line's end.
 */
const KEY_LINE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|((?:[^\s#'"[\]{},&*!|>%@`?:-]|[?:-](?=\S))[^\n]*?))[ \t]*:(?:[ \t]+|$)/;

/** A double-quoted key's text: its escapes read as JSON reads them, which YAML's are a superset of. */
function unescapeDouble(inner: string): string {
    try {
        return JSON.parse(`"${inner}"`) as string;
    } catch {
        return inner;
    }
}
