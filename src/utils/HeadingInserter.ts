import { type App, TFile } from 'obsidian';
import { UnfollowableDraft, fileGone, processLines, type LineDraft, type WriteAt, type WriteChannel } from '../services/persistence/FileLines';
import { Outline } from '../services/parsing/utils/Outline';
import { Block, type SectionLookup, type Spot, Placement } from '../services/persistence/utils/Placement';
import type { Section } from '../services/persistence/Destination';

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
     * Where lines go in the section `to` names, at its side
     * (`Placement.into`: the heading looked up as a link to it is, at any
     * level), `head` the first of them. If the note has no heading by the
     * name, makes one at `to.level` at the end of the file — where
     * `Placement.end` says lines appended to the note go — and the lines go
     * under it. If it has more than one, the lines go nowhere: which of them
     * is meant, no link to the heading tells either. The one place a write
     * that adds lines to a section makes its heading: a line made under it
     * ({@link insertUnderHeading}), a send's carried rows (`SendWriter`).
     *
     * The spot is asked again once the heading is made, so it is
     * `Placement`'s answer either way. Whether the lines read as put is the
     * write's check (`processLines`).
     */
    static sectionSpot(draft: LineDraft, to: Section, head: string): Spot | Extract<SectionLookup, { kind: 'many' }> {
        const found = Placement.into(draft.reading(), to, head);
        if (found.kind === 'spot') return found.spot;
        if (found.kind === 'many') return found;
        // At the end, before the empty element a terminated file splits
        // into, so the file still ends with its terminator. One blank line
        // sets the new heading off from the text above it.
        const end = Placement.end(draft.reading());
        const blank = end.at > 0 && !Outline.isBlank(draft.lines[end.at - 1]) ? [''] : [];
        draft.put(end, Block.read([...blank, '#'.repeat(to.level) + ' ' + to.heading]));
        const made = Placement.into(draft.reading(), to, head);
        if (made.kind !== 'spot') throw new UnfollowableDraft(`the heading '${to.heading}' just made is not one to put lines under`);
        return made.spot;
    }

    /**
     * Insert a line in the section `to` names, at its side, making the
     * heading when the note has none ({@link sectionSpot}).
     *
     * @param draft The file's lines, as a write is handed them
     * @param line  Line to insert
     * @param to    The section, and the level its heading is made at
     * @returns The 0-based line number of the inserted line, or how many
     *          headings go by the name
     */
    static insertUnderHeading(draft: LineDraft, line: string, to: Section): number | Extract<SectionLookup, { kind: 'many' }> {
        const spot = this.sectionSpot(draft, to, line);
        if ('kind' in spot) return spot;
        draft.put(spot, Block.line(line));
        return spot.at;
    }

    /**
     * Insert a line in a section of the given file, via `vault.process`
     * (atomic read-modify-write). The outcome carries the 0-based line number
     * of the inserted line; not written when the file doesn't exist, the note
     * has more than one heading by the name (`headings`), or the lines would
     * not read as put (told to the channel).
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
        to: Section,
    ): Promise<WriteAt> {
        const file = typeof fileOrPath === 'string'
            ? app.vault.getAbstractFileByPath(fileOrPath)
            : fileOrPath;
        if (!(file instanceof TFile)) {
            return fileGone(channel, typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path, line.trim());
        }

        let inserted = -1;
        const outcome = await processLines(app, file, channel, (draft, _eol, session) => {
            const put = HeadingInserter.insertUnderHeading(draft, line, to);
            if (typeof put !== 'number') return session.refuse({ kind: 'headings', name: to.heading, count: put.count });
            inserted = put;
            return true;
        }, line.trim());
        return outcome.written ? { ...outcome, line: inserted } : outcome;
    }
}
