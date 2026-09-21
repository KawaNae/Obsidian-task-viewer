/**
 * The name of a file's state: which lines it reads, in order.
 *
 * The whole content is the only evidence that says which state a file is in —
 * task rows alone cannot tell two states apart when only the lines between
 * them differ. So a scan records the key of what it read, a write the key of
 * what it wrote, and "is this the state that write described" becomes one
 * comparison.
 *
 * A key rather than the lines themselves, because the ledger keeps one per
 * scanned file for the whole session. The key carries the line count and the
 * length next to the hash, and nothing decides on the key alone: wherever it is
 * compared, the rows it vouches for are checked on their text as well (see
 * `reproduces` and `WriteClaims.baseFor`), so a collision would also have to
 * reproduce every row's text before it could decide anything.
 *
 * Lines are joined with LF whatever the file is written in, because a scan sees
 * them with the CR already taken off (`splitLines`). Two states that differ
 * only in their terminators therefore share a key. That is harmless: a write
 * that only unifies terminators carries every identity over from the state it
 * was built on, so the two candidates decide the same thing.
 *
 * The line count is the array's, not the joined text's. A write may hand over
 * an element with a line break inside, and the rows it vouches for are placed
 * by element: on the file the scan reads back, where that element is two
 * lines, every row below it sits one line lower. Joined, the two arrays make
 * the same string; counted, they do not, so such a write's key never matches
 * the file it wrote. What that costs is the claim, never a row placed on the
 * line above its own.
 */
export type ContentKey = string;

/** The key of the content these lines make. */
export function contentKeyOf(lines: readonly string[]): ContentKey {
    const text = lines.join('\n');

    // Two independent 32-bit mixes (FNV-1a and a multiply-rotate), 64 bits in
    // all. Synchronous on purpose: a write computes this inside the
    // `vault.process` callback, where nothing may be awaited.
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
    return `${lines.length}:${text.length}:${hex(a)}${hex(b)}`;
}
