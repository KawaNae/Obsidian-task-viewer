import { type App, TFile } from 'obsidian';
import { fileGone, processLines, type LineDraft, type WriteAt, type WriteChannel } from './FileLines';
import { Outline } from '../services/parsing/utils/Outline';
import { Placement } from '../services/persistence/utils/Placement';

/**
 * Heading-based line insertion utility.
 *
 * `insertUnderHeading` edits a draft and nothing else — this is the part
 * every write site should test against directly.
 * `writeUnderHeading` is a thin non-pure wrapper around it (processLines)
 * shared by every write site so the read-modify-write itself isn't
 * reimplemented per caller, and so the file keeps its own line terminator.
 */
export class HeadingInserter {
    /**
     * Insert a line under a specific heading in file content.
     * If the heading exists, inserts directly under the heading (headerIndex + 1).
     * If the heading does not exist, creates it at the end of the file — where
     * `Placement.end` says lines appended to the note go.
     *
     * @param draft   The file's lines, as a write is handed them
     * @param line    Line to insert
     * @param header  Heading text (without # prefix)
     * @param headerLevel Number of # (e.g. 2 for ##)
     * @returns The 0-based line number of the inserted line; null, and nothing
     *          spliced, when the heading is absent and the note ends inside a
     *          fence that never closes, so the heading and the line would be
     *          written into it.
     */
    static insertUnderHeading(
        draft: LineDraft,
        line: string,
        header: string,
        headerLevel: number
    ): number | null {
        const out = draft.lines;
        const headerPrefix = '#'.repeat(headerLevel) + ' ';
        const fullHeader = headerPrefix + header;

        // A heading as the parser reads one: in the body, not in a fence, and
        // at the start of its line — an indented `## Tasks` is a line of the
        // task above it, and one inside the frontmatter is YAML.
        const bodyStart = Outline.bodyStart(out);
        const outline = Outline.read(out);
        let headerIndex = -1;
        for (let i = bodyStart; i < out.length; i++) {
            if (outline.inCode(i)) continue;
            if (out[i].trimEnd() === fullHeader) {
                headerIndex = i;
                break;
            }
        }

        let insertedLine: number;
        if (headerIndex !== -1) {
            insertedLine = headerIndex + 1;
            draft.splice(insertedLine, 0, line);
        } else {
            // At the end, before the empty element a terminated file splits
            // into, so the file still ends with its terminator. One blank line
            // sets the new heading off from the text above it.
            const end = Placement.end(out);
            if (end === null) return null;
            let at = end;
            if (at > 0 && out[at - 1].trim() !== '') draft.splice(at++, 0, '');
            draft.splice(at, 0, fullHeader, line);
            insertedLine = at + 1;
        }

        return insertedLine;
    }

    /**
     * Insert a line under a heading in the given file, via `vault.process`
     * (atomic read-modify-write). Returns the 0-based line number of the
     * inserted line, or -1 if the file doesn't exist or the line has nowhere
     * in the body to go (told to the channel as `unplaceable`).
     *
     * The write reports what it did like every other (see `LineDraft`), so a
     * task already under the heading keeps its name across the insert — even
     * when it is indented and the new line becomes its parent.
     *
     * Accepts a `TFile` directly when the caller already has one — e.g. a
     * file just created via `vault.create` may not yet resolve back through
     * `getAbstractFileByPath` on every Obsidian version, so re-resolving by
     * path would be a silent way to lose the write.
     */
    static async writeUnderHeading(
        app: App,
        fileOrPath: TFile | string,
        channel: WriteChannel | undefined,
        line: string,
        header: string,
        headerLevel: number
    ): Promise<WriteAt> {
        const file = typeof fileOrPath === 'string'
            ? app.vault.getAbstractFileByPath(fileOrPath)
            : fileOrPath;
        if (!(file instanceof TFile)) {
            return fileGone(channel, typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path, line.trim());
        }

        let inserted = -1;
        const outcome = await processLines(app, file, channel, (draft, _eol, { refuse }) => {
            const at = HeadingInserter.insertUnderHeading(draft, line, header, headerLevel);
            if (at === null) return refuse({ kind: 'unplaceable' }, line.trim());
            inserted = at;
            return true;
        });
        return outcome.written ? { ...outcome, line: inserted } : outcome;
    }
}
