export interface TaskLineMatch {
    /** Leading whitespace */
    indent: string;
    /** Character inside `[ ]` */
    statusChar: string;
    /** Content after `] ` (everything following the closing bracket + space) */
    rawContent: string;
    /** Restore prefix: indent + `- [` portion */
    prefix: string;
    /** Restore suffix: `]` + everything after it */
    suffix: string;
}

/**
 * Unified classifier for parent task lines (`- [ ] content`).
 * Centralises the checkbox-line regex so that callers don't maintain their own copies.
 */
export class TaskLineClassifier {
    // Currently only `-` bullet. Extend here when supporting `*`, `+`, or ordered lists.
    private static readonly TASK_LINE_REGEX = /^(\s*)(- *\[)(.)(\].*)$/;

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

    /** Build the `- [x] ` prefix for a given status char and optional indent. */
    static formatPrefix(statusChar: string, indent: string = ''): string {
        return `${indent}- [${statusChar}] `;
    }
}
