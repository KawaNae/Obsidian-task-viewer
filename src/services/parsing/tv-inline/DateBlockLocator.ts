import type { Span } from '../../lang/Diagnostic';
import type { DateTimeRule } from '../../../types';

/**
 * Regex for locating the Date block: @start>end>due
 * Each segment accepts: YYYY-MM-DD, YYYY-MM-DDTHH:mm, T?HH:mm, or empty
 * Rejects non-date @ patterns like @user, @notation
 *
 * Shared between TVInlineParser (field extraction) and the editor
 * diagnostics locator below — single definition, no drift.
 */
export const DATE_BLOCK_REGEX =
    /(@(?=[\d>T])(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|T?\d{2}:\d{2})?(?:>(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?|\d{2}:\d{2})?)*)/;

/**
 * Column spans of a line's date block, all relative to the start of the
 * raw line text. Segment spans (`start`/`end`/`due`) exclude the `@` and
 * `>` delimiters; an unwritten segment (e.g. the end of `@d>>due`) is
 * undefined. Empty-but-written segments get zero-width spans — callers
 * that decorate must fall back to `block` for those.
 */
export interface DateBlockLocation {
    /** The whole canonical (first) block, including the `@`. */
    block: Span;
    start: Span;
    end?: Span;
    due?: Span;
    /** From the 3rd `>` to the block end (parser accepts at most 2). */
    extraSeparators?: Span;
    /** Each discarded block beyond the first (parser keeps only #1). */
    extraBlocks: Span[];
}

/**
 * Locate the date block of a task line without parsing field values.
 * Mirrors TVInlineParser exactly: the flow tail after `==>` is excluded
 * first, and only matches longer than a bare `@` count as blocks. The
 * checkbox prefix and a trailing `^block-id` cannot contain `@`, so
 * running against the raw line (rather than the classified rawContent)
 * yields the same match at directly usable line columns.
 */
export function locateDateBlock(lineText: string): DateBlockLocation | null {
    const taskPart = lineText.split(/==>(.+)/)[0];

    const globalRe = new RegExp(DATE_BLOCK_REGEX.source, 'g');
    let block: Span | null = null;
    const extraBlocks: Span[] = [];
    let m: RegExpExecArray | null;
    while ((m = globalRe.exec(taskPart)) !== null) {
        if (m[0].length <= 1) continue; // bare `@` before `>`/digit is not a block
        const span = { start: m.index, end: m.index + m[0].length };
        if (!block) block = span;
        else extraBlocks.push(span);
    }
    if (!block) return null;

    // Segment offsets inside the canonical block: skip `@`, split on `>`.
    const inner = taskPart.slice(block.start + 1, block.end);
    const parts = inner.split('>');
    const spans: Span[] = [];
    let offset = block.start + 1;
    for (const part of parts) {
        spans.push({ start: offset, end: offset + part.length });
        offset += part.length + 1; // step over the `>`
    }

    const location: DateBlockLocation = {
        block,
        start: spans[0],
        extraBlocks,
    };
    if (parts.length > 1) location.end = spans[1];
    if (parts.length > 2) location.due = spans[2];
    if (parts.length > 3) {
        // From the 3rd `>` (the separator preceding the 4th part).
        location.extraSeparators = { start: spans[3].start - 1, end: block.end };
    }
    return location;
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
    loc: DateBlockLocation
): Span[] {
    switch (rule) {
        case 'cross-midnight':
        case 'same-day-inversion':
        case 'end-before-start':
        case 'end-time-without-start':
            return usable(loc.end) ? [loc.end] : [loc.block];
        case 'due-without-date':
            return usable(loc.due) ? [loc.due] : [loc.block];
        case 'frontmatter-time-only':
            return [loc.block];
        case 'parse-error': {
            const spans: Span[] = [];
            if (usable(loc.extraSeparators)) spans.push(loc.extraSeparators);
            spans.push(...loc.extraBlocks.filter(usable));
            return spans.length > 0 ? spans : [loc.block];
        }
        default: {
            const exhaustive: never = rule;
            void exhaustive;
            return [loc.block];
        }
    }
}
