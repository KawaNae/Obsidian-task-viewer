/**
 * Which line of the note a checkbox drawn in a markdown frame's card
 * writes, decided off renders of the card's markdown that are never shown.
 * `MarkdownRenderer.render` draws a checkbox with no mark of the line it
 * comes from, but writes the status character of its task line on the
 * item, as `data-task` (a space as nothing). So the card renders twice
 * when a checkbox is pressed:
 *
 * 1. `markLines`: the markdown with the status of each line written as a
 *    task line is replaced by a character naming the line. The item of the
 *    pressed checkbox's place in that render names the line to try
 *    (`markedLine`)
 * 2. `turnLine`: the markdown as it is, but for that line's status, turned
 *    as it is to be written. The line is written only when this render
 *    draws what the click asks for (`confirms`): as many checkboxes as the
 *    card shows, the pressed one's status turned, and every other one's as
 *    the card shows it
 *
 * The second render alone is what a write stands on. The first only finds
 * which line to try in one render; a line it names wrongly does not pass
 * the second, and the checkbox writes nothing. No shape of the markdown is
 * read here: what each line is, is the render's.
 */

/** A line of the note to write: its index in the note's lines, what it reads there, and what it is to read. */
export interface BoxLine {
    line: number;
    text: string;
    next: string;
}

/**
 * A line written as a task line, past what may hold it on the same line
 * (quotes, footnote definitions, list markers): the status character is
 * the second group. Taken wide: a line that draws no checkbox is replaced
 * in a render never shown, to no effect, and a task line it misses only
 * leaves its checkbox unable to write.
 */
const TASK_LINE = /^((?:[ \t]*>|[ \t]*\[\^[^\]\s]+\]:|[ \t]*(?:[-*+]|\d+[.)])(?=[ \t]))*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)(.)(\])/;

/**
 * The opening of a fenced code block and its language, past what may hold
 * it on the same line. A block of a language a plugin draws (`dataviewjs`,
 * `dataview`) would run that plugin's script or query on every render; the
 * language is replaced by one no plugin draws, so the block is drawn as
 * code. Replacing a word of the opening line by another keeps it an
 * opening line, and a line within a block one within it. This has no part
 * in what a write stands on: a render it changed in some other way does
 * not draw what the click asks for, and the checkbox writes nothing.
 */
const FENCE_OPEN = /^((?:[ \t]*>|[ \t]*\[\^[^\]\s]+\]:|[ \t]*(?:[-*+]|\d+[.)])(?=[ \t]))*[ \t]*(?:`{3,}|~{3,})[ \t]*)[^\s`]+/;

/** The language a fence's is replaced by: one no plugin draws. */
const QUIET_LANGUAGE = 'x';

/**
 * The first character naming a line, in Unicode's private use area: line
 * `k` is `MARK_BASE + k`. The area holds `MARKED_LINES` of them; a task
 * line past them keeps its status, and its checkbox cannot write.
 */
const MARK_BASE = 0xE000;
export const MARKED_LINES = 0xF8FF - MARK_BASE + 1;

/** `markdown`'s lines, each fence's language replaced (`FENCE_OPEN`), and `turn` applied to the line `k`. */
function quieted(markdown: string, turn: (line: string, k: number) => string): string {
    return markdown.split('\n')
        .map((line, k) => turn(line.replace(FENCE_OPEN, (_, open: string) => open + QUIET_LANGUAGE), k))
        .join('\n');
}

/** The markdown to render to find a checkbox's line: each task line's status replaced by the character naming its line. */
export function markLines(markdown: string): string {
    return quieted(markdown, (line, k) => k < MARKED_LINES
        ? line.replace(TASK_LINE, (_, open: string, _status: string, close: string) => open + String.fromCharCode(MARK_BASE + k) + close)
        : line);
}

/** The line the `data-task` of an item of `markLines`'s render names, or null when it names none. */
export function markedLine(task: string | null): number | null {
    if (task === null || task.length !== 1) return null;
    const k = task.charCodeAt(0) - MARK_BASE;
    return k >= 0 && k < MARKED_LINES ? k : null;
}

/**
 * The status as the render writes it on an item's `data-task`: a space as
 * nothing.
 */
function drawnStatus(status: string): string {
    return status === ' ' ? '' : status;
}

/**
 * The line `k` of a card's `markdown` written with its status turned, as a
 * task card's checkbox and Obsidian's reading view turn it, by how the
 * pressed checkbox looks (`shown`, its item's `data-task`): one drawn with
 * no status, a space's or another blank's, is written `x`, any other a
 * space. `lines` are the note's line each line of the markdown is
 * (`CardRows.lines`). Gives the markdown to render to confirm it
 * (`confirms`), the `data-task` that render is to draw on the pressed
 * checkbox's item, and the line to write; or null when the line is not
 * written as a task line.
 */
export function turnLine(markdown: string, lines: readonly number[], k: number, shown: string | null): { markdown: string; drawn: string; write: BoxLine } | null {
    const text = markdown.split('\n')[k];
    const match = text === undefined ? null : TASK_LINE.exec(text);
    if (match === null || lines[k] === undefined) return null;
    const status = shown === '' ? 'x' : ' ';
    const at = match[1].length;
    const next = text.slice(0, at) + status + text.slice(at + 1);
    return {
        markdown: quieted(markdown, (line, i) => i === k ? line.slice(0, at) + status + line.slice(at + 1) : line),
        drawn: drawnStatus(status),
        write: { line: lines[k], text, next },
    };
}

/**
 * Whether the render of a turned line (`tried`, the `data-task` of each
 * checkbox it drew, in order) draws what a click of the checkbox `index`
 * asks for, the card showing `shown`: as many checkboxes, the pressed
 * one's `data-task` changed to `drawn`, and every other one's as shown.
 */
export function confirms(shown: readonly (string | null)[], tried: readonly (string | null)[], index: number, drawn: string): boolean {
    if (tried.length !== shown.length || index < 0 || index >= shown.length || shown[index] === drawn) return false;
    return tried.every((task, i) => i === index ? task === drawn : task === shown[i]);
}
