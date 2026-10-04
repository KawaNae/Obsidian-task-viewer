/**
 * What reading a piece of typed text gives: the value, or why there is none.
 *
 * Every input codec in this folder answers with a `Read<T>`. The reason is
 * data, not a sentence: the API and the CLI turn it into English with
 * `issueText`, and a form can tell it in the user's language from the same
 * value.
 */

/**
 * The kinds of value whose shape a reading can miss. `dateTime` is a date
 * with or without a time; `dateTimeOrTime` also takes a time alone. `color`
 * is a hex color or a CSS color name. `statusChar` is one character a
 * checkbox can hold (`TaskLineClassifier.isStatusChar`). `text` is any
 * text: what a stored setting of text that is not one misses.
 */
export type ShapeKind = 'date' | 'time' | 'dateTime' | 'dateTimeOrTime' | 'int' | 'number' | 'bool' | 'color' | 'statusChar' | 'text';

/**
 * Notation a value cannot hold, because what it is written into reads it as
 * something else. Of a task's name, in its line: a date block
 * (`@2026-10-05`, `@10:00`), the command (`==>` and what follows), a
 * trailing block ID (`^id`). Of a heading's name: the heading's own mark
 * (`#`) before it, which the line writes itself.
 */
export type NotationKind = 'dateBlock' | 'command' | 'blockId' | 'headingMark';

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
    | { readonly code: 'dateRequired' }
    /** Text that holds notation the line would read as something else (a task's name). */
    | { readonly code: 'notation'; readonly kind: NotationKind }
    /** Characters the value cannot hold, each once, in the order they come. */
    | { readonly code: 'chars'; readonly chars: string }
    /** A name the plugin keeps for itself (a property key that is a scope key, `tags`). */
    | { readonly code: 'reserved' }
    /** A value that must differ from the others of its set and is one of them (a scope key, a status's character). */
    | { readonly code: 'duplicate' };

export type Read<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly issue: Issue };

export function readOk<T>(value: T): Read<T> {
    return { ok: true, value };
}

export function readFail<T = never>(issue: Issue): Read<T> {
    return { ok: false, issue };
}

/**
 * How a field's text reads, and how a value is shown back in it: a reading
 * of this folder with the form it writes once read. A field shows a value
 * it read in this form (`２０２６ー１０ー０５` becomes `2026-10-05`), so what
 * is shown is what is written.
 */
export interface FieldCodec<T> {
    read(text: string): Read<T>;
    show(value: T): string;
}

/**
 * `codec`, with an empty field (nothing but space) read as no value: a
 * field where leaving it empty takes the value away (a task's date, its
 * color), rather than one a value must be given in.
 */
export function optional<T>(codec: FieldCodec<T>): FieldCodec<T | undefined> {
    return {
        read: (text) => (text.trim() === '' ? readOk(undefined) : codec.read(text)),
        show: (value) => (value === undefined ? '' : codec.show(value)),
    };
}

/** The value of a reading, or undefined when there is none. */
export function valueOf<T>(read: Read<T>): T | undefined {
    return read.ok ? read.value : undefined;
}
