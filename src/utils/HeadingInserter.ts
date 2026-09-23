import { type App, TFile } from 'obsidian';
import { CodeFenceTracker } from './CodeFenceTracker';
import { processLines } from './FileLines';
import { Outline } from '../services/parsing/utils/Outline';

export interface InsertResult {
    lines: string[];
    insertedLine: number;
}

/**
 * Heading-based line insertion utility.
 *
 * `insertUnderHeading` is a pure function: lines in, modified lines out —
 * this is the part every write site should test against directly.
 * `writeUnderHeading` is a thin non-pure wrapper around it (processLines)
 * shared by every write site so the read-modify-write itself isn't
 * reimplemented per caller, and so the file keeps its own line terminator.
 */
export class HeadingInserter {
    /**
     * Insert a line under a specific heading in file content.
     * If the heading exists, inserts directly under the heading (headerIndex + 1).
     * If the heading does not exist, creates it at the end of the file.
     *
     * @param lines   File content, already split into lines
     * @param line    Line to insert
     * @param header  Heading text (without # prefix)
     * @param headerLevel Number of # (e.g. 2 for ##)
     * @returns Modified lines and the 0-based line number of the inserted line
     */
    static insertUnderHeading(
        lines: string[],
        line: string,
        header: string,
        headerLevel: number
    ): InsertResult {
        const out = [...lines];
        const headerPrefix = '#'.repeat(headerLevel) + ' ';
        const fullHeader = headerPrefix + header;

        // A heading as the parser reads one: in the body, not in a fence, and
        // at the start of its line — an indented `## Tasks` is a line of the
        // task above it, and one inside the frontmatter is YAML.
        const bodyStart = Outline.bodyStart(out);
        const fenceTracker = new CodeFenceTracker();
        let headerIndex = -1;
        for (let i = 0; i < out.length; i++) {
            const fenced = fenceTracker.feed(out[i]);
            if (fenced || i < bodyStart) continue;
            if (out[i].trimEnd() === fullHeader) {
                headerIndex = i;
                break;
            }
        }

        let insertedLine: number;
        if (headerIndex !== -1) {
            insertedLine = headerIndex + 1;
            out.splice(insertedLine, 0, line);
        } else {
            // At the end, before the empty element a terminated file splits
            // into, so the file still ends with its terminator. One blank line
            // sets the new heading off from the text above it.
            let at = out.length > 0 && out[out.length - 1] === '' ? out.length - 1 : out.length;
            if (at > 0 && out[at - 1].trim() !== '') out.splice(at++, 0, '');
            out.splice(at, 0, fullHeader, line);
            insertedLine = at + 1;
        }

        return { lines: out, insertedLine };
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
        await processLines(app, file, (lines) => {
            const result = HeadingInserter.insertUnderHeading(lines, line, header, headerLevel);
            insertedLine = result.insertedLine;
            return result.lines;
        });
        return insertedLine;
    }
}
