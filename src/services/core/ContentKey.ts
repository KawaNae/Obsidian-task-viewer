/**
 * The name of a file's state: which lines it reads, in order.
 *
 * The whole content is the only evidence that says which state a file is in —
 * task rows alone cannot tell two states apart when only the lines between
 * them differ. So a read records the key of what it read, and "is this what
 * was read last" becomes one comparison.
 *
 * The key carries the line count and the length next to a 64-bit hash, so two
 * contents share one only when they have the same number of lines, the same
 * length and the same hash.
 *
 * Lines are joined with LF whatever the file is written in, because a read
 * sees them with the CR already taken off (`splitLines`). Two states that
 * differ only in their terminators therefore share a key: they read as the
 * same lines, and every row stands on the same line in both.
 *
 * The line count is the array's, not the joined text's. An element with a
 * line break inside is two lines in the file; joined, the two arrays make the
 * same string, counted, they do not.
 */
export type ContentKey = string;

/** The key of the content these lines make. */
export function contentKeyOf(lines: readonly string[]): ContentKey {
    const text = lines.join('\n');
    return `${lines.length}:${text.length}:${mix(text)}`;
}

/**
 * The hash of one line, whole — its indentation and its trailing spaces
 * included — as 16 hexadecimal digits: the same two mixes as
 * {@link contentKeyOf}, over the line alone.
 */
export function lineKey(line: string): string {
    return mix(line);
}

/**
 * Two independent 32-bit mixes (FNV-1a and a multiply-rotate), 64 bits in
 * all. Synchronous on purpose: a write computes this inside the
 * `vault.process` callback, where nothing may be awaited.
 */
function mix(text: string): string {
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193);
        b = Math.imul(b ^ c, 0x85ebca6b);
        b = (b << 13) | (b >>> 19);
    }
    b = Math.imul(b ^ (b >>> 16), 0xc2b2ae35);
    b ^= b >>> 13;

    const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
    return hex(a) + hex(b);
}
