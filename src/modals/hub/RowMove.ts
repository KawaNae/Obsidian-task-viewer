import { t } from '../../i18n';
import type { Task, TaskViewerSettings } from '../../types';
import { sectionAt } from '../../services/data/CreatePlaces';
import { NoteName } from '../../services/data/NoteName';
import type { NoteOps, SendPreview, SendResult } from '../../services/data/NoteOps';
import type { DestinationAsk } from '../../services/data/NotePlaces';
import { RowDraft, type RowDraftRefusal } from '../../services/data/RowDraft';
import type { SubtreeReplacement } from '../../services/persistence/TaskOps';
import { refusalText } from '../../services/operations/WriteAnswer';
import type { FormIssue } from '../form/FormIssue';
import { SendDialog, initialAsk, type RowStand, type SendHost, type SendSurface, type SendViewState } from '../noteops/SendDialog';
import type { HubDraft } from './HubHost';

/**
 * What the fields of where the row goes open with: where it stands now (its
 * note, and the heading it stands under, none above the note's first), or
 * where a send of it goes unless the user says otherwise (`initialAsk`).
 */
export type MoveStart = 'here' | 'defaults';

/** What a move asks of the notes: where its fields name, the open timers, and the send. */
export type MoveOps = Pick<NoteOps, 'destinationFacts' | 'timersRefuse' | 'send'>;

/** What a move tells the hub it is in. */
export interface MoveHost {
    /**
     * What the move says of itself as a whole, above its write: what the
     * timers keep, what a move is asked in spite of, why the last was not
     * made, and why none can be asked once the row changed or was lost.
     */
    say(issues: readonly FormIssue<never>[]): void;
    /** Why a change of a field was not taken into the draft; null takes back what was said. */
    refuse(why: string | null): void;
    /** The draft changed: the card and the fields draw it. */
    drafted(): void;
    /** The move started or stopped being under way: the fields are shut while it is. */
    underWay(): void;
    /** Whether a move may be asked, or is under way, may have changed: the row of buttons draws it again. */
    showDraft(): void;
    /** Write as the write button does: Enter in a field of where the row goes. */
    submit(): void;
    /** The draft and where it goes are thrown away: the hub writes each change as it comes again. */
    leave(): void;
    /** The row went: the hub closes, asking nothing. */
    close(): void;
}

/** What a move of one row is made of: the row as the disk holds it, and what it asks and tells. */
export interface MoveDeps {
    settings: TaskViewerSettings;
    /** One level of indentation (`ObsidianConfig.indentUnit`). */
    unit: string;
    ops: MoveOps;
    host: MoveHost;
}

/**
 * The hub on a row while it moves the row: what the fields change is held
 * in a draft of the row (`RowDraft`) and written to no note; where the row
 * goes is the send dialog's (`SendDialog`, its fields drawn in the hub's
 * place, `SendSurface`); the move writes both at once (`NoteOps.send`, the
 * draft as the row's replacement). It is the hub's write while it lasts
 * (`HubDraft`: [Move]), and the send's host (`SendHost`).
 *
 * - It opens on `preview`, a row the disk holds as the index's copy reads
 *   it (`NoteOps.previewSend`): the draft opens as that row, and the send
 *   goes from it (`SendRow.base`).
 * - A move to where the row stands is not asked (`SendOptions.stands`): its
 *   note, under the heading it stands under.
 * - Once the index's row is no longer the one it opened on (changed from
 *   outside, or lost), the draft stays and no move is asked: the send would
 *   be refused, and the draft is the user's work. Cancel is the way out.
 *   Whether it changed is read from the index's row each time it is told
 *   ({@link follow}), not from being told.
 * - Throwing it away (cancel) asks of what it would lose where the draft,
 *   or where it goes, is not what it opened with (`changed`).
 * - A move made for the row closes the hub; one not made keeps the draft
 *   and says why above the write; one made in part (the row landed and its
 *   note refused to let it go) says why and offers no move again.
 */
export class RowMove implements HubDraft, SendHost, SendSurface {
    readonly label = t('modal.send.send');
    readonly busyLabel = t('modal.send.sending');
    readonly discardAsk = t('modal.hub.move.discardAsk');
    readonly discard = (): void => this.deps.host.leave();
    /** The fields of where the row goes as it opened. */
    readonly initial: DestinationAsk;
    private readonly draft: RowDraft;
    private readonly dialog: SendDialog;
    private readonly row: Task;
    private ask: DestinationAsk;
    /** The send's state as last drawn, for a view that comes later. */
    private shown: SendViewState | null = null;
    private view: SendSurface | null = null;
    /** Why no move can be asked: the row changed outside, or was lost; null while it is the one opened on. */
    private stale: string | null = null;
    private sending = false;
    /** The move asked last, resolving to whether it was made for the row; null before any. */
    private asked: Promise<boolean> | null = null;
    /** The move was made for the row: the hub closes. */
    private made = false;

    constructor(private readonly preview: SendPreview, start: MoveStart, private readonly deps: MoveDeps) {
        const snapshot = preview.rows[0];
        this.row = snapshot.task;
        this.draft = RowDraft.of(snapshot, deps.settings, deps.unit);
        const stands: RowStand = {
            note: this.row.file,
            heading: sectionAt(snapshot.lines, this.row.line, deps.settings)?.heading?.text ?? null,
        };
        this.initial = start === 'here'
            ? { note: NoteName.askOf(stands.note), heading: stands.heading ?? '' }
            : initialAsk(preview);
        this.ask = this.initial;
        this.dialog = new SendDialog(preview, this, this, { initial: this.initial, stands });
    }

    /** The row as the draft reads: what the card and the fields show. */
    task(): Task {
        return this.draft.task();
    }

    /** Take a field's change into the draft: whether it was taken, why not said by the host. None while the move is under way. */
    put(updates: Partial<Task>): boolean {
        if (this.sending) return false;
        const refused = this.draft.apply(updates);
        if (refused) {
            this.deps.host.refuse(refusalOf(refused, this.row));
            return false;
        }
        this.deps.host.refuse(null);
        this.deps.host.drafted();
        this.dialog.draftsChanged();
        return true;
    }

    /** The fields of where the row goes changed. */
    fieldsChanged(ask: DestinationAsk): void {
        this.ask = { ...ask };
        this.dialog.fieldsChanged(ask);
    }

    /** The user checked or unchecked the value `key` offered. */
    check(key: string, checked: boolean): void {
        this.dialog.check(key, checked);
    }

    /** Enter in a field of where the row goes. */
    submit(): void {
        this.deps.host.submit();
    }

    /** Draw where the row goes in `view` from now on, what it says now first; null, in none. */
    show(view: SendSurface | null): void {
        this.view = view;
        if (view && this.shown) view.render(this.shown);
    }

    /**
     * The index's row as it is now; undefined once the index lost it. A row
     * whose note or lines are no longer those the move opened on stops the
     * move, and why is said.
     */
    follow(row: Task | undefined): void {
        const stale = !row ? t('modal.hub.move.lost')
            : row.file !== this.row.file || !sameLines(row.subtreeLines, this.row.subtreeLines) ? t('modal.hub.move.changed')
                : null;
        if (stale === this.stale) return;
        this.stale = stale;
        this.dialog.draftsChanged();
    }

    // ==================== HubDraft ====================

    canWrite(): boolean {
        return this.dialog.state().canSend;
    }

    writing(): boolean {
        return this.sending;
    }

    write(): void {
        this.asked = this.dialog.send().then(() => this.made);
    }

    /** The move under way, resolving to whether it was made for the row; null while none is. */
    moving(): Promise<boolean> | null {
        return this.sending ? this.asked : null;
    }

    changed(): boolean {
        return this.draft.replacement() !== null || !sameAsk(this.ask, this.initial);
    }

    // ==================== SendHost ====================

    facts(ask: DestinationAsk) {
        return this.deps.ops.destinationFacts(this.preview, ask);
    }

    timers(sending: Parameters<SendHost['timers']>[0]): string | null {
        return this.deps.ops.timersRefuse(sending);
    }

    /** Shown above the write; a notice would say it twice. */
    send(req: Parameters<SendHost['send']>[0]): Promise<SendResult> {
        return this.deps.ops.send(req, { tellRefusal: false });
    }

    /** The draft as the row's replacement; none while the row is not the one opened on. */
    drafts(): readonly (SubtreeReplacement | null)[] | null {
        return this.stale === null ? [this.draft.replacement()] : null;
    }

    close(): void {
        this.made = true;
        this.deps.host.close();
    }

    // ==================== SendSurface ====================

    /**
     * Draw the send's state: where the row goes in the view, what is of the
     * move as a whole above the write, the fields shut while it is under
     * way, and the row of buttons.
     */
    render(state: SendViewState): void {
        this.shown = state;
        this.view?.render(state);
        const host = this.deps.host;
        const issues: FormIssue<never>[] = state.issues
            .filter(issue => issue.at === 'form')
            .map(issue => ({ ...issue, at: 'form' as const }));
        if (this.stale !== null) issues.push({ at: 'form', tone: 'error', text: this.stale });
        host.say(issues);
        const sending = state.phase === 'sending';
        if (sending !== this.sending) {
            this.sending = sending;
            host.underWay();
        }
        host.showDraft();
    }

    /** The hub closed, or the move was thrown away: an answer that comes after comes to nothing. */
    dispose(): void {
        this.view = null;
        this.dialog.dispose();
    }
}

/** Why a change was not taken into the draft, as a write refused for it is said. */
function refusalOf(refused: RowDraftRefusal, row: Task): string {
    if (refused.kind === 'not-task') return t('modal.hub.source.notTask');
    return refusalText({ file: row.file, reason: refused, subject: row.content });
}

function sameLines(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    return a !== undefined && b !== undefined && a.length === b.length && a.every((line, i) => line === b[i]);
}

function sameAsk(a: DestinationAsk, b: DestinationAsk): boolean {
    return a.heading === b.heading && a.note.text === b.note.text && a.note.picked === b.note.picked;
}
