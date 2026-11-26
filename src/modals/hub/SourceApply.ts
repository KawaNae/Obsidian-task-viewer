import { t } from '../../i18n';
import type { Task } from '../../types';
import { refusalText, type WriteAnswer } from '../../services/operations/WriteAnswer';
import type { SubtreeReplacement } from '../../services/persistence/TaskOps';
import { DraftGuard } from '../form/DraftGuard';
import type { OpenSource, SeatRow, SeatView, SourceOpening, SourceSeat } from './TaskHubSource';

export interface SourceApplyHost {
    /** The row as the hub follows it in the index; undefined once the hub lost it. */
    row(): Task | undefined;
    /** Resolves once the hub's writes asked so far are done (`RowHost.drained`). */
    drained(): Promise<void>;
    /** Whether the index's copy of the row is the row on the disk (`Operations.confirmTask`); told the user when not. */
    confirm(taskId: string): Promise<boolean>;
    /** The index's copy of the row, followed through our own writes (`IndexReads.getTask`). */
    reread(taskId: string): Task | undefined;
    /** Write the draft (`Operations.replaceSubtree`), the refusal shown here rather than in a notice. */
    replace(taskId: string, base: readonly string[], replacement: SubtreeReplacement): Promise<WriteAnswer>;
    /** Shut the form while the source is open, and open it again after. */
    lockForm(locked: boolean): void;
    /** Close the hub, asking nothing more: the draft was thrown away for a close the user asked for. */
    closeHub(): void;
}

/** What throwing the draft away goes on to: the card, or closing the hub. */
type After = 'view' | 'close';

/**
 * The source's seat on the row the note holds: the text is the row and its
 * subtree on the disk, written from a draft when the user applies it, and
 * nowhere else: not when the source or the hub is left.
 *
 * - The source opens once the hub's writes asked so far are done, the hub's
 *   copy confirmed as the row on the disk (`confirm`), on the subtree the
 *   index holds then: that subtree is the base every apply is checked
 *   against. The form is shut while the source is open, since two ways of
 *   writing one row would have one of them refused.
 * - An apply writes the parent and the children in one write, or leaves at
 *   once when the draft is the subtree opened. A refused draft stays, with
 *   why under it; the same draft again is not written again, since nothing
 *   the index holds has changed what the write would say of it.
 * - A draft the user has not thrown away is never lost to a step the user
 *   asks for: the switch back and a close ask first, in the seat's row of
 *   buttons (`DraftGuard`). A draft is what writes something: an editor
 *   whose text the frame reads as other lines than it opened on
 *   (`SubtreeFrame.check` is not `same`), so a blank line added at the end
 *   asks nothing. Going back to the draft withdraws the question as its keep
 *   does: an edit of the text, or an apply, which goes on as asked. A focus
 *   given back to the editor without an edit leaves the question, since
 *   reading the draft or copying from it is a way to answer it.
 * - A row the hub lost (a change from outside renamed it) keeps the draft,
 *   and offers no apply: copying the draft and throwing it away is the way
 *   out.
 */
export class SourceApply implements SourceSeat {
    private source: OpenSource | null = null;
    /** A write of the draft is on its way. */
    private applying = false;
    /** Whether to throw the draft away, asked before a step that would lose it. */
    private readonly guard: DraftGuard<After> = new DraftGuard<After>({
        loss: () => (this.hasDraft() ? { kind: 'draft' } : null),
        render: () => this.source?.redraw(),
        asked: () => this.source?.asked(),
        goOn: (after) => {
            this.leave();
            if (after === 'close') this.host.closeHub();
        },
    });
    /** The draft last refused, and why: not written again while it stays the same. */
    private refused: { key: string; message: string } | null = null;
    private disposed = false;

    constructor(private readonly host: SourceApplyHost) { }

    row(): SeatRow | undefined {
        const task = this.host.row();
        return task && { task, lines: task.subtreeLines };
    }

    async open(live: () => boolean): Promise<SourceOpening | null> {
        await this.host.drained();
        const known = this.host.row();
        const copy = known && this.host.reread(known.id);
        if (!live()) return null;
        if (!copy || !(await this.host.confirm(copy.id))) return null;
        if (!live()) return null;
        const fresh = this.host.reread(copy.id);
        if (!fresh || fresh.isReadOnly || !fresh.subtreeLines) return null;
        // The row's note: a link typed under the row is written there.
        return { lines: fresh.subtreeLines, linkSource: () => fresh.file };
    }

    opened(source: OpenSource): void {
        this.source = source;
        this.host.lockForm(true);
    }

    view(): SeatView {
        const lost = this.host.row() === undefined;
        const asking = this.guard.asking !== null;
        // A lost row has its own way out; asked there, the row of buttons asks as anywhere.
        const own = lost && !asking;
        return {
            foot: own ? null : { act: !lost },
            busy: this.applying,
            asking,
            lost: own ? { discard: true } : null,
        };
    }

    submit(): void {
        void this.apply();
    }

    /** Write the draft: the apply button, or Mod+Enter. Asked whether to throw it away, the question is withdrawn. */
    async apply(): Promise<void> {
        const source = this.source;
        const row = this.host.row();
        if (!source || this.applying || !row) return;
        this.guard.withdraw();

        const check = source.frame.check(source.editor.draft());
        if (check.kind === 'same') return this.leave();
        if (check.kind === 'refused') {
            return source.say(check.reason === 'parent-break' ? t('modal.hub.source.parentBreak') : t('modal.hub.source.notTask'));
        }
        const key = keyOf(check.replacement);
        if (this.refused?.key === key) return source.say(this.refused.message);

        this.applying = true;
        source.say(null);
        const answer = await this.host.replace(row.id, source.frame.base, check.replacement);
        if (this.disposed || this.source !== source) return;
        this.applying = false;
        if (answer.written) return this.leave();
        const message = refusalText(answer.refused);
        this.refused = { key, message };
        source.say(message);
    }

    /** Back to the card: the cancel button, or the switch. Asks first when there is a draft. */
    back(): void {
        if (!this.source || this.applying || this.guard.asking) return;
        if (this.guard.request('view')) this.leave();
    }

    /**
     * Whether the hub may close now. Not while there is a draft: the hub
     * asks whether to throw it away, and closes if the user says so. Asked
     * while it is already asking (a close after the switch to the card
     * asked, or a close again), the question is put again, and throwing the
     * draft away now closes: what the user asked for last is what it goes on
     * to. Every close refused puts the question, so each takes the focus to
     * its answer as the first did.
     */
    beforeClose(): boolean {
        if (!this.source) return true;
        return this.guard.request('close');
    }

    /** Throw the draft away: as asked, going on to what asked; unasked (a lost row's own way out), back to the card. */
    discard(): void {
        if (this.guard.asking) this.guard.discard();
        else this.leave();
    }

    /** Keep the draft: the question is withdrawn, and the editor takes the focus. */
    keep(): void {
        if (!this.guard.keep() || !this.source) return;
        this.source.focusEditor();
    }

    /** The draft's text changed: asked whether to throw it away, the question is withdrawn. */
    edited(): void {
        this.guard.withdraw();
    }

    /** The hub closed: a write's answer that comes after leaves the source as it is. */
    dispose(): void {
        this.disposed = true;
    }

    /** Whether the editor holds a draft that writes something: other lines than the subtree opened (`SubtreeFrame.check`). */
    private hasDraft(): boolean {
        const source = this.source;
        return source !== null && source.frame.check(source.editor.draft()).kind !== 'same';
    }

    /** The source closed, the draft with it: the card again, and the form open. */
    private leave(): void {
        const source = this.source;
        this.guard.withdraw();
        this.source = null;
        this.applying = false;
        this.refused = null;
        source?.end();
        if (!this.disposed) this.host.lockForm(false);
    }
}

/** A replacement as the one it is: the lines it writes, and which line each child was. */
function keyOf(replacement: SubtreeReplacement): string {
    return JSON.stringify([replacement.text, replacement.children.map(line => [line.text, line.was])]);
}
