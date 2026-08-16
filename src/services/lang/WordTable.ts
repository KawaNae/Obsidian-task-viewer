/**
 * Lookup for a table keyed by a word someone wrote.
 *
 * A table written as an object literal answers for twelve names it never
 * declared — `toString`, `constructor`, `valueOf` and the rest of what every
 * object inherits — and each of those answers is a function where an entry was
 * expected. What the readers here look up is always a word out of a file, so
 * the difference is reachable: `x.toString()` found a signature with no
 * `params` and threw, `state(...)`'s neighbour `toString(1)` was accepted as a
 * clause and then dropped by the printer, and a refusal table answered with a
 * diagnostic carrying no code.
 *
 * The tables stay literals — they are the written description of what this
 * language has, and a Map spells that worse. The bracket is what moves.
 */
export function lookupWord<T>(table: Record<string, T>, word: string): T | undefined {
    return Object.hasOwn(table, word) ? table[word] : undefined;
}
