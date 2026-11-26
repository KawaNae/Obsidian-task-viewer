import { t } from '../../i18n';
import type { DraftMark, RowDraft, RowDraftRefusal } from '../../services/data/RowDraft';
import type { OpenSource, SeatRow, SeatView, SourceOpening, SourceSeat } from './TaskHubSource';

/** What the source's seat in a move asks of the move it is in (`RowMove`). */
export interface MoveSourceHost {
    /** Whether the move is under way: the source neither opens nor goes back meanwhile. */
    sending(): boolean;
    /** Whether the row is no longer the one the move opened on (changed outside, or lost): no move is asked. */
    stale(): boolean;
    /** The note a link typed in the source is spelt from, asked at each completion. */
    linkSource(): string;
    /** Put in what is typed in the fields (`HubForm.putTyped`): whether all of it was. */
    putTyped(): boolean;
    /** Why the draft did not take the source's lines in, as the move says a refusal. */
    refusal(refused: RowDraftRefusal): string;
    /** The draft took the source's lines in: the card, the fields and where the row goes read it. */
    drafted(): void;
    /** The source opened or closed: the fields are shut while it is open. */
    changed(): void;
    /** Write as [Move] does (`HubForm.write`). */
    submit(): void;
    /** The source's text changed: a question put of what the move holds is withdrawn. */
    edited(): void;
}

/** The source as it is open on the draft, and the mark its drafts are taken in on. */
interface Open {
    source: OpenSource;
    mark: DraftMark;
}

/**
 * The source's seat while the hub moves the row: the text is the move's
 * draft (`RowDraft`), a way of showing it, and writes nothing. The move
 * writes the draft with where the row goes, at once ([Move]).
 *
 * - The source opens on the draft as it is now, once what is typed in the
 *   fields is put in (`MoveSourceHost.putTyped`); not while a value typed
 *   cannot be, nor while the move is under way. The draft's mark is taken
 *   as it opens (`RowDraft.mark`): every draft of the editor is taken in on
 *   it, however many times, as the lines it opened on.
 * - The switch back to the card takes the editor's text into the draft
 *   ({@link take}), and asks nothing: a text that does not take stays, why
 *   said under the editor, the focus in it. A text typed back to what it
 *   opened on takes the lines it opened on (`SubtreeFrame.unchanged`), since
 *   the draft may have taken others since.
 * - The seat has no row of buttons: the hub's form holds cancel and [Move]
 *   (`SeatView.foot` null). [Move] and Mod+Enter take the text in first
 *   (`RowMove.write`); the source stays open after, so a move not made can
 *   be mended and asked again on the same mark.
 * - A close asks nothing here: the form asks, of the text not taken in yet
 *   too ({@link pending}).
 * - A row changed outside, or lost, keeps the text, which may be copied;
 *   cancel is the way out, and the switch back still takes it in.
 */
export class MoveSource implements SourceSeat {
    private current: Open | null = null;
    /** The mark taken as the source is being opened, for the source that opens on it. */
    private opening: DraftMark | null = null;

    constructor(private readonly draft: RowDraft, private readonly host: MoveSourceHost) { }

    /** Whether the source is open on the draft: the fields of the row's values are shut meanwhile. */
    isOpen(): boolean {
        return this.current !== null;
    }

    row(): SeatRow {
        return { task: this.draft.task(), lines: this.draft.subtree() };
    }

    async open(): Promise<SourceOpening | null> {
        if (this.host.sending() || !this.host.putTyped()) return null;
        // Taken once what is typed is in: the editor opens on these lines.
        const mark = this.draft.mark();
        this.opening = mark;
        return { lines: mark.rows, linkSource: () => this.host.linkSource() };
    }

    opened(source: OpenSource): void {
        const mark = this.opening;
        this.opening = null;
        if (!mark) throw new Error('the source opened on a move\'s draft with no mark taken');
        this.current = { source, mark };
        this.host.changed();
    }

    view(): SeatView {
        return {
            foot: null,
            busy: this.host.sending(),
            asking: false,
            lost: this.host.stale() ? { why: t('modal.hub.move.sourceLost'), discard: false } : null,
        };
    }

    /** The switch back to the card: the text taken in, the source closes; not taken, it stays, the focus in the editor. */
    back(): void {
        const open = this.current;
        if (!open || this.host.sending()) return;
        if (!this.take()) {
            open.source.focusEditor();
            return;
        }
        this.end();
        this.host.changed();
    }

    submit(): void {
        this.host.submit();
    }

    edited(): void {
        this.host.edited();
    }

    beforeClose(): boolean {
        return true;
    }

    /**
     * Take the editor's text into the draft, on the mark the source opened
     * on: whether it was, or there is no source open. Not taken (a row's
     * line that is no task, more than one line for it, lines the note would
     * not read as the row's subtree), why is said under the editor, and the
     * draft is as it was.
     */
    take(): boolean {
        const open = this.current;
        if (!open) return true;
        const { source, mark } = open;
        const check = source.frame.check(source.editor.draft());
        if (check.kind === 'refused') {
            source.say(check.reason === 'parent-break' ? t('modal.hub.source.parentBreak') : t('modal.hub.source.notTask'));
            return false;
        }
        const refused = this.draft.take(check.kind === 'write' ? check.replacement : source.frame.unchanged(), mark);
        if (refused) {
            source.say(this.host.refusal(refused));
            return false;
        }
        source.say(null);
        this.host.drafted();
        return true;
    }

    /**
     * Whether the editor holds what the draft has not taken in: a text that
     * does not take, or lines other than the draft's now. A text typed back
     * to what it opened on after another was taken in is one.
     */
    pending(): boolean {
        const open = this.current;
        if (!open) return false;
        const { frame, editor } = open.source;
        const check = frame.check(editor.draft());
        if (check.kind === 'refused') return true;
        const lines = check.kind === 'same'
            ? frame.base
            : [check.replacement.text, ...check.replacement.children.map(line => line.text)];
        const now = this.draft.subtree();
        return lines.length !== now.length || lines.some((line, i) => line !== now[i]);
    }

    /** The question of what the move holds was answered to keep it: the editor takes the focus while the source is open. Whether it did. */
    keep(): boolean {
        if (!this.current) return false;
        this.current.source.focusEditor();
        return true;
    }

    /** The editor takes the focus: a text that did not take is mended there. */
    focusEditor(): void {
        this.current?.source.focusEditor();
    }

    /** The move is thrown away: the source closes, its text with it. */
    end(): void {
        const open = this.current;
        this.current = null;
        open?.source.end();
    }
}
