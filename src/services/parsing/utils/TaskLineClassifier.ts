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
    private static readonly MARKER_REGEX = new RegExp(`^${TASK_LEAD_SOURCE}(${LIST_BULLET_SOURCE})`);
    private static readonly BLOCK_ID_REGEX = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

    /**
     * Strip a trailing `^block-id` from a line's content. The single
     * implementation shared by all parsers (timer-target semantics of the
     * id are the caller's concern).
     *
     * An id is part of the content, never of the checkbox: it stands at the
     * content's end, alone or after a space. `content` is what follows a
     * task's gap (`classify`'s `rawContent`); for a whole line, see
     * {@link extractLineBlockId}.
     */
    static extractBlockId(content: string): { text: string; blockId?: string } {
        const match = content.match(this.BLOCK_ID_REGEX);
        if (!match) return { text: content };
        return { text: content.slice(0, match.index).trimEnd(), blockId: match[1] };
    }

    /**
     * {@link extractBlockId} on a whole line: taken off the line's content
     * ({@link splitContent}), so that the checkbox, its gap and the
     * indentation stay as they are.
     */
    static extractLineBlockId(line: string): { text: string; blockId?: string } {
        const { head, content } = this.splitContent(line);
        const { text, blockId } = this.extractBlockId(content);
        return { text: head + text, blockId };
    }

    /**
     * A line cut where its content begins. A task's content follows the
     * space or tab after its `]` — that gap is the checkbox's, and a task
     * with no content still has it (`- [ ] `), since without it the line is
     * no task to Obsidian. Any other line's content follows its indentation.
     */
    static splitContent(line: string): { head: string; content: string } {
        const task = this.classify(line);
        const at = task ? line.length - task.rawContent.length : Outline.indentOf(line).length;
        return { head: line.slice(0, at), content: line.slice(at) };
    }

    /**
     * A content made of parts — the text, the date block, the command, the
     * block id — one space apart, each with its end trimmed and the empty
     * ones left out. How every line the plugin writes puts its content
     * together, so that no part leaves a space behind when it is absent.
     */
    static joinContent(...parts: string[]): string {
        return parts.map(part => part.trimEnd()).filter(part => part !== '').join(' ');
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
