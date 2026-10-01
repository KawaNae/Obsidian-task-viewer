/**
 * What reading a piece of typed text gives: the value, or why there is none.
 *
 * Every input codec in this folder answers with a `Read<T>`. The reason is
 * data, not a sentence: the API and the CLI turn it into English with
 * `issueText`, and a form can tell it in the user's language from the same
 * value.
 */

/** The kinds of value whose shape a reading can miss. */
export type ShapeKind = 'date' | 'time' | 'dateTime' | 'int' | 'number' | 'bool';

export type Issue =
    /** Nothing was given (only space, once normalized). */
    | { readonly code: 'empty' }
    /** The text is not written as a value of this kind. */
    | { readonly code: 'shape'; readonly kind: ShapeKind }
    /** A date of the right shape that names no day (Feb 30, Apr 31). */
    | { readonly code: 'noSuchDay' }
    /** A number outside the bounds it may take. */
    | { readonly code: 'range'; readonly min?: number; readonly max?: number }
    /** A word that is none of the ones accepted. */
    | { readonly code: 'oneOf'; readonly allowed: readonly string[] }
    /** A time given where a date must come with it. */
    | { readonly code: 'dateRequired' };

export type Read<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly issue: Issue };

export function readOk<T>(value: T): Read<T> {
    return { ok: true, value };
}

export function readFail<T = never>(issue: Issue): Read<T> {
    return { ok: false, issue };
}

/** The value of a reading, or undefined when there is none. */
export function valueOf<T>(read: Read<T>): T | undefined {
    return read.ok ? read.value : undefined;
}
