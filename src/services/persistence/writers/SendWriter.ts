import { type App, TFile } from 'obsidian';
import { HeadingInserter } from '../../../utils/HeadingInserter';
import { indentUnit } from '../../../utils/ObsidianConfig';
import { carryTo } from '../Carry';
import type { Section } from '../Destination';
import { fileGone, type LineDraft, type RowTarget, type WriteChannels, type WriteSession } from '../FileLines';
import { replaceSubtree } from '../ReplaceSubtree';
import type { PlannedTarget } from '../TaskRefs';
import type { CompletionFire, FiringOutcome, SubtreeReplacement } from '../TaskOps';
import { ListNumber } from '../utils/ListNumber';
import { Placement, type Spot } from '../utils/Placement';
import type { InlineTaskWriter } from './InlineTaskWriter';

/**
 * A row a send takes: the row, named with the subtree the send was planned
 * on (`RowBasis.subtree`), and the draft of the row and its subtree the user
 * wrote before sending it, if any (`SubtreeReplacement`).
 */
export interface SentRow {
    target: PlannedTarget;
    draft?: SubtreeReplacement;
}

/**
 * The writes of a send: rows and their subtrees taken to a section of a note
 * (`v0.58-features.md`, 送る操作への一般化).
 */
export class SendWriter {
    constructor(
        private app: App,
        private inline: InlineTaskWriter,
        private channelOf: WriteChannels,
    ) { }

    /**
     * Send `rows`, all of `path`, to the section `to` of the same note, as
     * one write.
     *
     * The write reads as the dialog says: the rows were edited, and then
     * sent. A row with a draft is written as the draft says first
     * (`replaceSubtree`), and every row the draft completed fires where it
     * stands (`completing`, as the hub's source mode fires it:
     * `InlineTaskWriter.writeFiring`), so what the fire writes — the next
     * instance, a consumed command, a move — is written in the note as it
     * stood. Then each row, and its subtree as the fires left it, is carried
     * (`carryTo`), with its own `==>` lines, which fire at its next
     * completion where it lands. Each row is found where the edits before
     * left it (`WriteSession.row`, `mark`), so the order of the edits
     * changes no row they name.
     *
     * `rows` stand in the note in their order, and none in another's
     * subtree. The first goes where `Placement.into` puts lines in the
     * section, the heading made when the note has none
     * (`HeadingInserter.sectionSpot`); each after it goes just past the one
     * before, as its sibling: they land in the order they stood, whichever
     * side of the section they go to. A note with more than one heading by
     * the name takes none of them (`headings`).
     *
     * Refused, nothing is written, and the refusal is told as any write's
     * is: there is nothing to make up for.
     */
    async sendWithinFile<F extends CompletionFire>(
        path: string,
        rows: readonly SentRow[],
        to: Section,
        completing: { completes(before: string, after: string): boolean; fire(): F },
    ): Promise<FiringOutcome<F>> {
        const file = this.app.vault.getAbstractFileByPath(path);
        const channel = this.channelOf(path);
        if (!(file instanceof TFile)) return fileGone(channel, path, rows[0]?.target.subject ?? path);
        // Where each row is to be found once its draft is written: the row,
        // or the line its replacement marked. Made anew on each run.
        let sent: RowTarget[] = [];
        return this.inline.writeFiring(file, channel, (draft, session) => {
            sent = [];
            const completed: RowTarget[] = [];
            for (const row of rows) {
                const line = session.row(row.target);
                if (line === null) return false;
                if (!row.draft) {
                    sent.push(row.target);
                    continue;
                }
                const rewritten = replaceSubtree(draft, session, line, row.draft);
                if (rewritten === false) return false;
                sent.push(rewritten[0].row);
                for (const one of rewritten) {
                    if (completing.completes(one.was, one.now)) completed.push(one.row);
                }
            }
            return completed;
        }, completing.fire, (draft, session) => this.carryAll(draft, session, sent, to));
    }

    /** Carry each of `sent` to the section `to`, in their order (see {@link sendWithinFile}). */
    private carryAll(draft: LineDraft, session: WriteSession, sent: readonly RowTarget[], to: Section): boolean {
        for (let k = 0; k < sent.length; k++) {
            const found = session.row(sent[k]);
            if (found === null) return false;
            const head = ListNumber.first(draft.lines[found]);
            let spot: Spot;
            if (k === 0) {
                const inSection = HeadingInserter.sectionSpot(draft, to, head);
                if ('kind' in inSection) return session.refuse({ kind: 'headings', name: to.heading, count: inSection.count });
                spot = inSection;
            } else {
                const before = session.row(sent[k - 1]);
                if (before === null) return false;
                spot = Placement.afterSubtree(draft.reading(), before, head, indentUnit(this.app));
            }
            // Asked again, past the heading the first spot may have made.
            const line = session.row(sent[k]);
            if (line === null) return false;
            carryTo(draft, line, spot, { flow: 'carry' });
        }
        return true;
    }
}
