import { DateUtils } from '../../../utils/DateUtils';
import type { Span } from '../../lang/Diagnostic';
import { cutFlowTail } from '../utils/FlowLineScanner';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';
import { parseDateTimeField } from '../utils/DateTimeFieldParser';
import type { DateTimeRule } from '../../../types';
import type { DateField } from '../../../utils/ShiftDates';

/**
 * The date block grammar: `@start>end>due`. Each segment accepts
 * YYYY-MM-DD, YYYY-MM-DDTHH:mm, T?HH:mm (the start) or HH:mm, or nothing.
 * A match of the bare `@` alone (`@alice`, `@1on1`) is no block:
 * {@link readDateBlock} skips it.
 */
const D = DateUtils.DATE_PATTERN;
const TM = DateUtils.TIME_PATTERN;
export const DATE_BLOCK_REGEX = new RegExp(
    String.raw`(@(?=[\d>T])(?:${D}(?:T${TM})?|T?${TM})?(?:>(?:${D}(?:T${TM})?|${TM})?)*)`,
);

/** The dates the first block says, as a `tv-inline` task holds them. */
export interface DateBlockValues {
    /** `''` when the block writes no start date. */
    startDate: string;
    startTime?: string;
    /** Only when written with a date (`>2026-02-16`); a time-only end leaves it out. */
    endDate?: string;
    endTime?: string;
    /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
    due?: string;
}

/**
 * A text's date blocks: where they stand and what the first one says.
 *
 * Spans are columns of the text read (for {@link readLineDateBlock}, of the
 * line). Segment spans (`start`/`end`/`due`) exclude the `@` and `>`
 * delimiters; an unwritten segment (the end of `@d`) is undefined, and a
 * written but empty one (the end of `@d>>due`) is zero-width — callers that
 * decorate fall back to `block` for those.
 */
export interface DateBlockReading {
    /** The first block, the one the dates are read from, with its `@`. */
    block: Span;
    start: Span;
    end?: Span;
    due?: Span;
    /** How many `>` the first block has; the notation reads two at most. */
    separators: number;
    /** From the 3rd `>` to the block's end: what the notation does not read. */
    extraSeparators?: Span;
    /** Each block after the first, with its text as written. */
    extraBlocks: { span: Span; text: string }[];
    /**
     * The segments of the first block that name a day or a time that does
     * not exist (`parseDateTimeField` refuses them). With any, the block is
     * not read: its `values` are none, and no later block is read in its
     * place.
     */
    unread?: Span[];
    values: DateBlockValues;
}

/**
 * The text of a task line's content where its words and its date block
 * stand: before a trailing `^id` and before the command (`==>` and what
 * follows, cut by {@link cutFlowTail}). `rawContent` is what follows the
 * checkbox's gap (`TaskLineClassifier.classify`). The text starts where the
 * content does, so its columns are the content's.
 */
export function taskContentText(rawContent: string): { text: string; blockId?: string } {
    const { text: body, blockId } = TaskLineClassifier.extractBlockId(rawContent);
    const cut = cutFlowTail(body);
    return { text: cut ? body.slice(0, cut.marker) : body, blockId };
}

/**
 * The one reading of a date block: where the blocks of `text` stand and
 * what the first says. `text` is a task's {@link taskContentText}. The line
 * parser reads the values; the editor's diagnostics read the spans, through
 * {@link readLineDateBlock}. Null when the text has no block.
 */
export function readDateBlock(text: string): DateBlockReading | null {
    const globalRe = new RegExp(DATE_BLOCK_REGEX.source, 'g');
    let block: Span | null = null;
    const extraBlocks: { span: Span; text: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = globalRe.exec(text)) !== null) {
        if (m[0].length <= 1) continue; // a bare `@` is no block
        const span = { start: m.index, end: m.index + m[0].length };
        if (!block) block = span;
        else extraBlocks.push({ span, text: m[0] });
    }
    if (!block) return null;

    // Segments inside the first block: past the `@`, split on `>`.
    const parts = text.slice(block.start + 1, block.end).split('>');
    const spans: Span[] = [];
    let offset = block.start + 1;
    for (const part of parts) {
        spans.push({ start: offset, end: offset + part.length });
        offset += part.length + 1; // step over the `>`
    }

    const fields = parts.map(part => parseDateTimeField(part || null));
    const unread = spans.filter((_, i) => fields[i] === null);

    const reading: DateBlockReading = {
        block,
        start: spans[0],
        separators: parts.length - 1,
        extraBlocks,
        values: unread.length > 0 ? { startDate: '' } : readValues(fields as { date?: string; time?: string }[]),
    };
    if (unread.length > 0) reading.unread = unread;
    if (parts.length > 1) reading.end = spans[1];
    if (parts.length > 2) reading.due = spans[2];
    // From the 3rd `>` (the separator before the 4th part).
    if (parts.length > 3) reading.extraSeparators = { start: spans[3].start - 1, end: block.end };
    return reading;
}

/** The values of a block whose every segment reads, segment by segment (an empty one reads as `{}`). */
function readValues(fields: { date?: string; time?: string }[]): DateBlockValues {
    const values: DateBlockValues = { startDate: '' };

    const start = fields[0];
    if (start.date) values.startDate = start.date;
    if (start.time) values.startTime = start.time;

    // An end is a date only when written with one (`>2026-02-16T08:00`); a
    // time-only end (`>08:00`) or an empty one (`>>due`) leaves `endDate`
    // out, and the display resolves the implicit end.
    const end = fields[1];
    if (end) {
        if (end.date) values.endDate = end.date;
        if (end.time) values.endTime = end.time;
    }

    const due = fields[2];
    if (due && (due.date || due.time)) {
        values.due = due.date && due.time ? `${due.date}T${due.time}` : due.date;
    }
    return values;
}

/**
 * {@link readDateBlock} of a task line's {@link taskContentText}, its spans
 * at the line's columns — what the parser reads, where the editor draws.
 * Null for a line that is no task or has no block.
 */
export function readLineDateBlock(line: string): DateBlockReading | null {
    const task = TaskLineClassifier.classify(line);
    if (!task) return null;
    const reading = readDateBlock(taskContentText(task.rawContent).text);
    if (!reading) return null;
    const at = line.length - task.rawContent.length;
    const shift = (span: Span): Span => ({ start: span.start + at, end: span.end + at });
    const shifted: DateBlockReading = {
        ...reading,
        block: shift(reading.block),
        start: shift(reading.start),
        extraBlocks: reading.extraBlocks.map(extra => ({ ...extra, span: shift(extra.span) })),
    };
    if (reading.end) shifted.end = shift(reading.end);
    if (reading.due) shifted.due = shift(reading.due);
    if (reading.extraSeparators) shifted.extraSeparators = shift(reading.extraSeparators);
    if (reading.unread) shifted.unread = reading.unread.map(shift);
    return shifted;
}

/** A segment that writes a date: `YYYY-MM-DD`, with its time or without. */
const DATED_SEGMENT = new RegExp(`^${D}`);

/**
 * `line` with the dates of `fields` in its date block moved by `days` whole
 * days (`DateUtils.shiftDateString`), each written as it was: nothing of the
 * line changes but those dates. The block is the one the parser reads
 * ({@link readLineDateBlock}), so a date in the command or past a bare `@`
 * (`@1on1`) is not moved, nor an extra block. A segment that writes a time
 * alone, or nothing, has no date to move, and neither has a block that
 * does not read (`DateBlockReading.unread`). A line with no block is
 * returned as it is.
 *
 * The line's side of the one rule for moving a task by days: a copy of a
 * line the user wrote is shifted here, and a line built from a task is
 * shifted as the task (`shiftTaskDates`), each over the fields its caller
 * names.
 */
export function shiftLineDates(line: string, days: number, fields: readonly DateField[]): string {
    const dates = readLineDateBlock(line);
    // A block that does not read has no dates to move.
    if (!dates || dates.unread) return line;
    const spans = fields
        .map(field => (field === 'start' ? dates.start : field === 'end' ? dates.end : dates.due))
        .filter((span): span is Span => span !== undefined)
        // From the end back, so an earlier segment's columns stay where they were.
        .sort((a, b) => b.start - a.start);
    let out = line;
    for (const span of spans) {
        const segment = line.slice(span.start, span.end);
        if (!DATED_SEGMENT.test(segment)) continue;
        out = out.slice(0, span.start) + DateUtils.shiftDateString(segment, days) + out.slice(span.end);
    }
    return out;
}

/**
 * `text` without its date blocks, the first and the extra ones: a task's
 * content. What the removal leaves as runs of blanks becomes one space.
 */
export function withoutDateBlocks(text: string, reading: DateBlockReading): string {
    const spans = [reading.block, ...reading.extraBlocks.map(extra => extra.span)];
    let out = '';
    let at = 0;
    for (const span of spans) {
        out += text.slice(at, span.start);
        at = span.end;
    }
    out += text.slice(at);
    return out.replace(/\s{2,}/g, ' ').trim();
}

/** Non-degenerate span, usable as a decoration range. */
function usable(span: Span | undefined): span is Span {
    return !!span && span.end > span.start;
}

/**
 * Map a validation rule onto the block spans to underline. Falls back to
 * the whole block whenever the rule's natural segment is absent or empty.
 */
export function spansForRule(
    rule: DateTimeRule | 'parse-error',
    loc: DateBlockReading
): Span[] {
    switch (rule) {
        case 'cross-midnight':
        case 'same-day-inversion':
        case 'end-before-start':
        case 'end-time-without-start':
            return usable(loc.end) ? [loc.end] : [loc.block];
        case 'due-without-date':
            return usable(loc.due) ? [loc.due] : [loc.block];
        case 'parse-error': {
            const spans: Span[] = [...(loc.unread ?? []).filter(usable)];
            if (usable(loc.extraSeparators)) spans.push(loc.extraSeparators);
            spans.push(...loc.extraBlocks.map(extra => extra.span).filter(usable));
            return spans.length > 0 ? spans : [loc.block];
        }
        default: {
            const exhaustive: never = rule;
            void exhaustive;
            return [loc.block];
        }
    }
}
