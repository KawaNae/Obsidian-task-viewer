/**
 * What ends a line of a note, and so what a line may hold.
 *
 * Read as Obsidian reads a note: its editor ends a line at CRLF, at LF and at
 * a CR on its own, and keeps U+2028 and U+2029 inside the line — a checkbox
 * line holding one is a checkbox (R0, Obsidian 1.12.4). `splitLines` cuts the
 * file here, a write refuses a line holding one of these, the parsers read a
 * line's content as anything but these, and the API and the flows refuse a
 * value holding one. One set, so that a line the plugin writes is the line it
 * reads back, and the line the editor numbers is the line the plugin numbers.
 *
 * No imports: the parsers and the write layer both read it.
 */

/** A line terminator: CRLF, LF, or a CR on its own. */
export const LINE_BREAK = /\r\n|\r|\n/;

/**
 * One character of a line, as a regex fragment: anything but a terminator.
 *
 * In place of `.`, which also refuses U+2028 and U+2029 — a line holding one
 * was not read as a task at all, though Obsidian shows it as one.
 */
export const IN_LINE = '[^\\r\\n]';

/** Whether a value would be more than one line of a note. */
export function holdsLineBreak(text: string): boolean {
    return /[\r\n]/.test(text);
}
