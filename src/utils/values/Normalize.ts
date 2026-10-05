/**
 * How typed text is made plain before it is read.
 *
 * Applied to text that carries a structured value (a number, a date, a
 * time, a word from a fixed set), never to free text such as a task's name:
 * there the characters a person wrote are the value.
 */

/**
 * NFKC and the surrounding space removed: full-width digits, letters and
 * punctuation (`２０２６`, `：`, `－`) read as their ASCII forms, and an
 * ideographic space is space.
 */
export function typed(text: string): string {
    return text.normalize('NFKC').trim();
}

/**
 * Characters that look like a hyphen, read as `-`. NFKC leaves these alone:
 * the long vowel mark `ー` (what a Japanese IME types for `-`, also the
 * half-width `ｰ` once NFKC has run), the hyphen `‐` and the non-breaking
 * hyphen `‑`, the minus sign `−`, and the en and em dashes. For dates, where
 * a hyphen is the only one of these that can stand.
 */
const HYPHEN_LIKE = /[ー‐‑−–—]/g;

export function dashed(text: string): string {
    return text.replace(HYPHEN_LIKE, '-');
}
