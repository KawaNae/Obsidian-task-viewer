import { type App, TFile } from 'obsidian';
import { fileGone, processLines, type LineDraft, type WriteAt, type WriteChannel } from './FileLines';
import { Outline } from '../services/parsing/utils/Outline';
import { Block, Placement } from '../services/persistence/utils/Placement';

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
     * If the heading exists, puts it just under the heading, past the
     * paragraph below it, as a sibling of the first task there
     * (`Placement.underHeading`): a task indented under the heading is not
     * made its child. If the heading does not exist, creates it at the end of
     * the file — where `Placement.end` says lines appended to the note go.
     * Whether the lines read as put is the write's check (`processLines`).
     *
     * @param draft   The file's lines, as a write is handed them
     * @param line    Line to insert
     * @param header  Heading text (without # prefix)
     * @param headerLevel Number of # (e.g. 2 for ##)
     * @returns The 0-based line number of the inserted line
     */
    static insertUnderHeading(
        draft: LineDraft,
        line: string,
        header: string,
        headerLevel: number
    ): number {
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

        if (headerIndex !== -1) {
            const spot = Placement.underHeading(out, headerIndex, line);
            draft.put(spot, Block.line(line));
            return spot.at;
        }
        // At the end, before the empty element a terminated file splits
        // into, so the file still ends with its terminator. One blank line
        // sets the new heading off from the text above it.
        const spot = Placement.end(out);
        const head = spot.at > 0 && !Outline.isBlank(out[spot.at - 1]) ? [''] : [];
        draft.put(spot, Block.read([...head, fullHeader, line]));
        return spot.at + head.length + 1;
    }

    /**
     * Insert a line under a heading in the given file, via `vault.process`
     * (atomic read-modify-write). The outcome carries the 0-based line number
     * of the inserted line; not written when the file doesn't exist, or the
     * lines would not read as put (told to the channel).
     *
     * The write reports what it did like every other (see `LineDraft`), so a
     * task already under the heading keeps its name across the insert.
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
        const outcome = await processLines(app, file, channel, (draft) => {
            inserted = HeadingInserter.insertUnderHeading(draft, line, header, headerLevel);
            return true;
        }, line.trim());
        return outcome.written ? { ...outcome, line: inserted } : outcome;
    }
}
