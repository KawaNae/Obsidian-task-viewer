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
    private static readonly TASK_LINE_REGEX = /^(\s*)((?:[-*+]|\d+[.)]) *\[)(.)(\].*)$/;
    private static readonly MARKER_REGEX = /^\s*([-*+]|\d+[.)])/;

    /** Full classification — returns null if the line is not a task line. */
    static classify(line: string): TaskLineMatch | null {
        const m = line.match(this.TASK_LINE_REGEX);
        if (!m) return null;
        const [, indent, bulletBracket, statusChar, bracketTail] = m;
        // rawContent: strip leading `] ` (bracket + optional space)
        const rawContent = bracketTail.replace(/^\]\s?/, '');
        return {
            indent,
            statusChar,
            rawContent,
            prefix: indent + bulletBracket,
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
