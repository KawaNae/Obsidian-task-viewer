import { type App, TFile } from 'obsidian';
import { CodeFenceTracker } from './CodeFenceTracker';

export interface InsertResult {
    content: string;
    insertedLine: number;
}

/**
 * Heading-based line insertion utility.
 *
 * `insertUnderHeading` is a pure function: content string in, modified
 * content string out — this is the part every write site should test
 * against directly. `writeUnderHeading` is a thin non-pure wrapper around
 * it (vault.process) shared by every write site so the read-modify-write
 * itself isn't reimplemented per caller.
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

    /**
     * Insert a line under a heading in the given file, via `vault.process`
     * (atomic read-modify-write). Returns the 0-based line number of the
     * inserted line, or -1 if the file doesn't exist.
     *
     * Accepts a `TFile` directly when the caller already has one — e.g. a
     * file just created via `vault.create` may not yet resolve back through
     * `getAbstractFileByPath` on every Obsidian version, so re-resolving by
     * path would be a silent way to lose the write.
     */
    static async writeUnderHeading(
        app: App,
        fileOrPath: TFile | string,
        line: string,
        header: string,
        headerLevel: number
    ): Promise<number> {
        const file = typeof fileOrPath === 'string'
            ? app.vault.getAbstractFileByPath(fileOrPath)
            : fileOrPath;
        if (!(file instanceof TFile)) return -1;

        let insertedLine = -1;
        await app.vault.process(file, (content) => {
            const result = HeadingInserter.insertUnderHeading(content, line, header, headerLevel);
            insertedLine = result.insertedLine;
            return result.content;
        });
        return insertedLine;
    }
}
