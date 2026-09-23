import { IN_LINE } from '../../../utils/LineBreak';
import { CHECKBOX_GAP_SOURCE, LIST_BULLET_SOURCE, STATUS_CHAR_SOURCE } from './ListMarker';
import { INDENT_SOURCE, Outline } from './Outline';

/**
 * What may stand before a task's list marker, as a regex fragment.
 *
 * Its indentation and nothing else: a line opened with a full-width or a
 * no-break space is no list item to Obsidian, so no task either (R0). Kept a
 * name of its own rather than written as `INDENT_SOURCE` in place, because
 * "is this line a task" and "how deep is it" are two questions: were such a
 * line ever to read as a task, it would widen here while its depth stayed
 * `Outline`'s.
 */
const TASK_LEAD_SOURCE = INDENT_SOURCE;

export interface TaskLineMatch {
    /** Leading whitespace */
    indent: string;
    /** Character inside `[ ]` */
    statusChar: string;
    /** Content after `] ` (everything following the closing bracket + space) */
    rawContent: string;
    /** Restore prefix: indent + bullet marker + `[` portion */
    prefix: string;
    /** Restore suffix: `]` + everything after it */
    suffix: string;
}

/**
 * Unified classifier for parent task lines (`- [ ] content`).
 * Centralises the checkbox-line regex so that callers don't maintain their own copies.
 * Supports `-`, `*`, `+`, and ordered list markers (`1.`, `1)`).
 */
export class TaskLineClassifier {
    private static readonly TASK_LINE_REGEX = new RegExp(`^(${TASK_LEAD_SOURCE})(${LIST_BULLET_SOURCE} *\\[)(${STATUS_CHAR_SOURCE})(\\]${CHECKBOX_GAP_SOURCE}${IN_LINE}*)$`);
    private static readonly BARE_CHECKBOX_REGEX = new RegExp(`^${TASK_LEAD_SOURCE}${LIST_BULLET_SOURCE} *\\[${STATUS_CHAR_SOURCE}\\]$`);
    private static readonly MARKER_REGEX =new RegExp(`^${TASK_LEAD_SOURCE}(${LIST_BULLET_SOURCE})`);
    private static readonly BLOCK_ID_REGEX = /\s\^([A-Za-z0-9-]+)\s*$/;

    /**
     * Strip a trailing `^block-id` from a line/content string. The single
     * implementation shared by all parsers (timer-target semantics of the
     * id are the caller's concern).
     */
    static extractBlockId(text: string): { text: string; blockId?: string } {
        const match = text.match(this.BLOCK_ID_REGEX);
        if (!match) return { text };
        return {
            // Up to and with the space before `^`: on `- [ ] ^a` that space is
            // also the checkbox's gap, which `trimEnd` keeps.
            text: this.trimEnd(text.slice(0, match.index! + 1)),
            blockId: match[1],
        };
    }

    /**
     * `text` with its end trimmed, but not the gap after a checkbox that has
     * nothing else on its line.
     *
     * A checkbox is a task to Obsidian only with a space or a tab after its
     * `]`, so `- [ ] ` is a task with no content and `- [ ]` is none. A task
     * with no content formats to the first; trimming the line as it is
     * written would turn it into the second. Any other line's end is trimmed
     * as before.
     */
    static trimEnd(text: string): string {
        const trimmed = text.trimEnd();
        return trimmed.length < text.length && this.BARE_CHECKBOX_REGEX.test(trimmed)
            ? text.slice(0, trimmed.length + 1)
            : trimmed;
    }

    /**
     * A line as a writer puts it after the indentation it decides: the line's
     * own indentation taken off, as the reading takes it off
     * (`Outline.dedent`), and its end trimmed as {@link trimEnd} does.
     */
    static tidy(line: string): string {
        return this.trimEnd(Outline.dedent(line));
    }

    /** Full classification — returns null if the line is not a task line. */
    static classify(line: string): TaskLineMatch | null {
        const m = line.match(this.TASK_LINE_REGEX);
        if (!m) return null;
        const [, lead, bulletBracket, statusChar, bracketTail] = m;
        const indent = Outline.indentOf(lead);
        // rawContent: past `]` and the one space or tab a task line has there
        const rawContent = bracketTail.slice(2);
        return {
            indent,
            statusChar,
            rawContent,
            prefix: lead + bulletBracket,
            suffix: bracketTail,
        };
    }

    /** Boolean-only check — avoids object allocation on hot paths. */
    static isTaskLine(line: string): boolean {
        return this.TASK_LINE_REGEX.test(line);
    }

    /** Extract the list marker (`-`, `*`, `+`, `1.`, etc.) from a line. Returns `-` if not found. */
    static extractMarker(line: string): string {
        const m = line.match(this.MARKER_REGEX);
        return m ? m[1] : '-';
    }

    /** Build the `- [x] ` prefix for a given status char, indent, and marker. */
    static formatPrefix(statusChar: string, indent: string = '', marker: string = '-'): string {
        return `${indent}${marker} [${statusChar}] `;
    }
}
