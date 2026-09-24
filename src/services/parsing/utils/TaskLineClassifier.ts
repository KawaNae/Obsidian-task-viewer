import { IN_LINE } from '../../../utils/LineBreak';
import { CHECKBOX_GAP_SOURCE, LIST_BULLET_SOURCE, MARKER_GAP_SOURCE, STATUS_CHAR_SOURCE } from './ListMarker';
import { INDENT_SOURCE, Outline, type OutlineReading } from './Outline';

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
 * The one reading of "is this line a task" (`- [ ] content`), for a row and
 * for a checkbox among a row's children alike: a child checkbox is a task
 * line deeper than its parent. Callers do not keep copies of the pattern.
 * Supports `-`, `*`, `+`, and ordered list markers (`1.`, `1)`).
 */
export class TaskLineClassifier {
    private static readonly TASK_LINE_REGEX = new RegExp(`^(${INDENT_SOURCE})(${LIST_BULLET_SOURCE}${MARKER_GAP_SOURCE}\\[)(${STATUS_CHAR_SOURCE})(\\]${CHECKBOX_GAP_SOURCE}(${IN_LINE}*))$`);
    private static readonly STATUS_CHAR_REGEX = new RegExp(`^${STATUS_CHAR_SOURCE}$`);
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
        // rawContent: past `]` and the gap a task line has there
        const [, indent, bulletBracket, statusChar, bracketTail, rawContent] = m;
        return {
            indent,
            statusChar,
            rawContent,
            prefix: indent + bulletBracket,
            suffix: bracketTail,
        };
    }

    /**
     * Whether `status` is a character a checkbox can hold (`STATUS_CHAR_SOURCE`):
     * one written there makes a line that reads back as a task. Takes what an
     * API caller passed as is: `RegExp.test` would turn `5` into `'5'`.
     */
    static isStatusChar(status: unknown): status is string {
        return typeof status === 'string' && this.STATUS_CHAR_REGEX.test(status);
    }

    /** Boolean-only check — avoids object allocation on hot paths. */
    static isTaskLine(line: string): boolean {
        return this.TASK_LINE_REGEX.test(line);
    }

    /**
     * Whether line `line` of the note is a task line as the parser reads the
     * note: it opens a list item the outline reads, is not code, and is a
     * task line. A checkbox the outline reads as a paragraph going on, or as
     * code, is text.
     */
    static opensTask(outline: OutlineReading, line: number): boolean {
        return outline.item(line) !== null && this.isTaskLine(outline.lines[line]);
    }

    /**
     * A task line's list marker with the gap after it, as the line has them
     * (`- `, `-\t`, `10.  `); `- ` for a line that is no task. A line written
     * over a task line keeps them: the gap sets the item's content column, and
     * a child reaches the item by it (under `-\t[ ] T`, a child two spaces past
     * a tab is the task's; under `- [ ] T` it goes on T's paragraph).
     */
    static extractMarker(line: string): string {
        const task = this.classify(line);
        return task ? task.prefix.slice(task.indent.length, -1) : '- ';
    }

    /** Build the `- [x] ` prefix for a given status char, indent, and marker with its gap. */
    static formatPrefix(statusChar: string, indent: string = '', marker: string = '- '): string {
        return `${indent}${marker}[${statusChar}] `;
    }
}
