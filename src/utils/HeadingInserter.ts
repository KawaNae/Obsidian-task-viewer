import { CodeFenceTracker } from './CodeFenceTracker';

export interface InsertResult {
    content: string;
    insertedLine: number;
}

/**
 * Heading-based line insertion utility.
 * Pure function: takes content string, returns modified content string.
 * Reusable across daily notes and frontmatter task files.
 */
export class HeadingInserter {
    /**
     * Insert a line under a specific heading in file content.
     * If the heading exists, inserts directly under the heading (headerIndex + 1).
     * If the heading does not exist, creates it at the end of the file.
     *
     * @param content Full file content
     * @param line    Line to insert
     * @param header  Heading text (without # prefix)
     * @param headerLevel Number of # (e.g. 2 for ##)
     * @returns Modified file content and the 0-based line number of the inserted line
     */
    static insertUnderHeading(
        content: string,
        line: string,
        header: string,
        headerLevel: number
    ): InsertResult {
        const lines = content.split('\n');
        const headerPrefix = '#'.repeat(headerLevel) + ' ';
        const fullHeader = headerPrefix + header;

        const fenceTracker = new CodeFenceTracker();
        let headerIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            const fenced = fenceTracker.feed(lines[i]);
            if (fenced) continue;
            if (lines[i].trim() === fullHeader) {
                headerIndex = i;
                break;
            }
        }

        let insertedLine: number;
        if (headerIndex !== -1) {
            insertedLine = headerIndex + 1;
            lines.splice(insertedLine, 0, line);
        } else {
            if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
                lines.push('');
            }
            lines.push(fullHeader);
            insertedLine = lines.length;
            lines.push(line);
        }

        return { content: lines.join('\n'), insertedLine };
    }
}
