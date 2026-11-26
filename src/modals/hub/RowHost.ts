import { Notice, TFile, type App } from 'obsidian';
import { t } from '../../i18n';
import type { Task } from '../../types';
import type { PluginContext } from '../../PluginContext';
import type { IndexReads } from '../../services/core/TaskIndex';
import type { Operations } from '../../services/operations/Operations';
import { getOriginalTaskId } from '../../services/display/DisplayTaskConverter';
import { refusalNotice } from '../../services/core/RefusalClause';
import { refusalText, type WriteAnswer } from '../../services/operations/WriteAnswer';
import { logError } from '../../log/log';
import type { CloseAnswer } from '../../views/sharedUI/CloseGate';
import type { HubForm, HubPanel, PanelHost } from './HubHost';
import { openSourceLine, type LineTarget } from './SourceLine';
import type { ShownPlace } from '../place/PlaceShown';
import { sectionAt } from '../../services/data/CreatePlaces';
import type { NoteOps, SendPreview } from '../../services/data/NoteOps';
import { splitLines } from '../../services/persistence/FileLines';
import { RowMove, type MoveHost, type MoveStart } from './RowMove';
import type { RowPlaceHost } from './RowPlace';

export interface RowHostDeps {
    app: App;
    plugin: PluginContext;
    index: IndexReads;
    operations: Operations;
    /** What a move asks of the notes: the row as the disk holds it, where it goes, and the send. */
    noteOps: Pick<NoteOps, 'previewSend' | 'destinationFacts' | 'timersRefuse' | 'send'>;
    /** One level of indentation (`ObsidianConfig.indentUnit`), for the draft a move holds. */
    indentUnit(): string;
}

/** The hub's source mode as the host tells it of the row. */
export interface RowSourceLink {
    /** Each change of the row after the card and the fields are told of it; undefined once the index no longer holds it. */
    follow(row: Task | undefined): void;
    /** The host holds the row for its move, or lets it go: the source does not open meanwhile. */
    hold(held: boolean): void;
}

/** A move a hub opens in (`RowHost`): the row as the disk held it when asked (`NoteOps.previewSend`), and what the fields of where it goes open with. */
export interface MoveOpening {
    preview: SendPreview;
    start: MoveStart;
}

/**
 * The host of a hub on a row the note already has. It is in one of two
 * states: it writes each change handed on to the row at once, or, while it
 * moves the row (`RowMove`), holds the changes in a draft and writes them
 * with the move, at once. Which it is in is whether it holds a move; `task`,
 * `put`, `draft`, `closing`, `openSource` and the following of the index
 * answer by it.
 *
 * Out of a move, each change handed on is written to the row at once
 * (`Operations.updateTask`), and the row is followed in the index.
 *
 * The value is what the fields hold, not the index's copy: a change handed on
 * is put over it before it is written, so the next one is built from what was
 * typed even before the echo comes. The echo, and any change from outside,
 * replaces it with the index's copy.
 *
 * Writes handed on one after another are asked at once: the operations keep
 * their order (each is planned from what the one before left, `onRow`). Each
 * is asked with no notice (`tellRefusal: false`): a refusal is said above the
 * form's tabs once and the value goes back to the index's copy; once the hub
 * has closed, a refusal is told by a notice, as any write's is.
 *
 * The fields are shut while the source mode holds the row (two ways of
 * writing one row would have one of them refused, and the draft is the
 * user's work) and while the index no longer holds it (nothing to write to).
 *
 * Where the row stands is shown with no field (`shown`): its note and its
 * parent from the value, the heading it stands under from the note's lines,
 * read again as the row changes (`readHeading`).
 *
 * A move begins ({@link beginMove}) once what is typed is put in, the
 * writes asked are written, and the row is read as the disk holds it
 * (`NoteOps.previewSend`). While it lasts, the draft is the value, a change
 * the draft refuses is said above the form's tabs, nothing of the row's
 * lines is offered to open (the draft's lines are on no disk), and the source
 * mode is held. The index's changes are not put over the draft: the move is
 * told the index's row, and compares it with the row it opened on. Thrown
 * away (cancel), the host writes each change as it comes again, from the
 * index's copy; made, the hub closes.
 *
 * A hub may open in a move, on a row its entry read from the disk first
 * (`MoveOpening`): the move is held as the hub opens, in the same task as
 * the form is built, as one begun is held.
 */
export class RowHost implements PanelHost, RowPlaceHost {
    private value: Task;
    private form: HubForm | null = null;
    private panel: HubPanel | null = null;
    private unsubscribe: (() => void) | null = null;
    /** The writes asked and not yet answered, each to whether it was written, for {@link drained} and the close. */
    private writing = new Set<Promise<boolean>>();
    /** The hub closed: a refusal that comes after is told by a notice. */
    private closed = false;
    /** The row is gone from the index: nothing to write to. */
    private missing = false;
    /** The source mode holds the row: its draft is the one way to write it until it closes. */
    private sourceOpen = false;
    /** The heading the row stands under, as last read: null above the note's first heading, undefined until read or once a read failed. */
    private heading: string | null | undefined = undefined;
    /** The row's line in the reading the heading was read for; a change that leaves it so needs no read. */
    private headingOf: string | null = null;
    /** Reads of the heading asked: only the last one's answer is taken. */
    private headingReads = 0;
    /** The move the hub is in: the changes are held in its draft. Null while each is written as it comes. */
    private move: RowMove | null = null;
    /** A move is being begun: what it waits for is not answered yet. */
    private beginning = false;

    /**
     * @param source the hub's source mode, told of the row and held while the row moves
     * @param opening the move the hub opens in; null, it opens writing each change as it comes
     */
    constructor(
        task: Task,
        private readonly deps: RowHostDeps,
        private readonly source: RowSourceLink,
        private opening: MoveOpening | null = null,
    ) {
        // A segment of a split task is a key within the display: the hub
        // works on its row, by the row's name.
        const originalId = getOriginalTaskId(task);
        this.value = deps.index.getTask(originalId) ?? { ...task, id: originalId };
    }

    /** The value: the move's draft while the hub is in one. */
    task(): Task {
        return this.move?.task() ?? this.value;
    }

    /**
     * @returns whether it was written, or, in a move, taken into the draft (a
     *   field refused keeps what was typed: `bindField`)
     */
    put(updates: Partial<Task> | null): Promise<boolean> {
        if (!updates) return Promise.resolve(true);
        if (this.move) return Promise.resolve(this.move.put(updates));
        this.value = { ...this.value, ...updates };
        const id = this.value.id;
        const write: Promise<boolean> = this.deps.operations.updateTask(id, updates, { tellRefusal: false })
            .then((answer) => {
                this.answered(id, answer);
                return answer.written;
            })
            .catch((e) => {
                logError(`[RowHost] commit failed: ${e instanceof Error ? e.message : String(e)}`);
                return false;
            })
            .finally(() => { this.writing.delete(write); });
        this.writing.add(write);
        return write;
    }

    /**
     * A write's answer. Written, the last refusal said is taken back. Refused,
     * why is said above the form's tabs, and the value goes back to the index's
     * copy: the fields refused keep what was typed, and are written again from
     * the new reading when committed again.
     */
    private answered(id: string, answer: WriteAnswer): void {
        if (this.closed) {
            if (!answer.written && answer.refused) new Notice(refusalNotice(answer.refused));
            return;
        }
        if (answer.written) {
            this.form?.sayPut(null);
            return;
        }
        this.form?.sayPut(refusalText(answer.refused));
        const fresh = this.deps.index.getTask(id);
        if (fresh) this.take(fresh);
    }

    /** The index's copy becomes the value, the fields opened again if the row had been lost. */
    private take(fresh: Task): void {
        this.value = fresh;
        if (this.missing) {
            // Only coming back from missing opens the fields again: opened on
            // every echo, a group built anew would break the input in focus.
            this.missing = false;
            this.form?.showShut();
        }
        this.form?.refresh();
    }

    /**
     * In a move, shut only while it is under way: the draft takes changes
     * whether or not the row is still the one it opened on.
     */
    shut(): string | null {
        if (this.move) return this.move.writing() ? t('modal.hub.move.formShut') : null;
        if (this.sourceOpen) return t('modal.hub.source.formShut');
        if (this.missing) return t('modal.hub.taskMissing');
        return null;
    }

    /** Open the line on the value (`openSourceLine`); none in a move, whose draft is on no disk. */
    get openSource(): ((locate: (task: Task) => LineTarget | null) => void) | null {
        return this.move ? null : this.openLine;
    }

    /** Open the line on the value (`openSourceLine`); the hub closes, as for any navigation. */
    private readonly openLine = (locate: (task: Task) => LineTarget | null): void => {
        void openSourceLine(
            { app: this.deps.app, index: this.deps.index, reuseTab: this.deps.plugin.settings.reuseExistingTab },
            this.value,
            locate,
        );
        this.panel?.close();
    };

    /** The move, whose write is [Move]; none while each change is written as it comes. */
    draft(): RowMove | null {
        return this.move;
    }

    /**
     * All written, the hub closes; one refused, it stays open with why above
     * the form's tabs. With the fields shut it closes at once: the source mode
     * opened once the writes were done, and a row gone has nothing to wait for.
     * In a move, asked once the form has asked whether to throw it away: it
     * closes, but while the move is under way, which is waited for; made in
     * part or not at all, the hub stays with why.
     */
    closing(): CloseAnswer {
        if (this.move) {
            const moving = this.move.moving();
            return moving ? moving.then(made => (made ? 'close' : 'stay')) : 'close';
        }
        if (this.shut() !== null || this.writing.size === 0) return 'close';
        return this.settled().then(written => (written ? 'close' : 'stay'));
    }

    /** Resolves once every write asked so far is answered: whether all of them were written. */
    private async settled(): Promise<boolean> {
        let written = true;
        while (this.writing.size > 0) {
            const answers = await Promise.all(this.writing);
            if (answers.includes(false)) written = false;
        }
        return written;
    }

    /** Resolves once every write asked so far is done: the source opens on what they left. */
    async drained(): Promise<void> {
        while (this.writing.size > 0) await Promise.all(this.writing);
    }

    bind(form: HubForm): void {
        this.form = form;
    }

    /** The move the hub is in, for the place to draw where the row goes; null out of one. */
    moving(): RowMove | null {
        return this.move;
    }

    /**
     * Begin a move of the row, the fields of where it goes opened on where it
     * stands (`'here'`) or where a send goes (`'defaults'`): what is typed is
     * put in first, as a close saves it, and the writes asked are waited
     * for; then the row is read as the disk holds it. None begins on a row
     * lost, read only, or held by the source mode, nor while one is begun,
     * and none once a value typed cannot be saved (its field takes the
     * focus), a write was refused (why is said), the row is not the one on
     * the disk (the user is told), or the hub closed meanwhile. The source
     * mode is held from the start: it does not open while the move is begun.
     */
    async beginMove(start: MoveStart): Promise<void> {
        const form = this.form;
        if (!form || this.move || this.beginning || this.closed || this.shut() !== null || this.value.isReadOnly) return;
        this.beginning = true;
        this.source.hold(true);
        try {
            if (!form.putTyped()) return;
            if (!(await this.settled())) return;
            const id = this.value.id;
            if (!this.free()) return;
            const preview = await this.deps.noteOps.previewSend([id]);
            if (!preview || !this.free()) return;
            this.hold(form, { preview, start });
        } catch (e) {
            logError(`[RowHost] the move could not begin: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.beginning = false;
            if (!this.move) this.source.hold(false);
        }
    }

    /** Whether a move begun may still be held: the hub open on the row, the fields not shut. */
    private free(): boolean {
        return !this.closed && this.shut() === null;
    }

    /**
     * Hold a move of the row from `opening`, the source mode held already.
     * The index's row as it is now is compared with the one read, which it
     * may no longer be after the wait. The fields, the card and the row of
     * buttons are drawn again: the move drew itself as it was made, before
     * the host held it.
     */
    private hold(form: HubForm, { preview, start }: MoveOpening): void {
        const move = new RowMove(preview, start, {
            settings: this.deps.plugin.settings,
            unit: this.deps.indentUnit(),
            ops: this.deps.noteOps,
            host: this.moveHost,
        });
        this.move = move;
        move.follow(this.deps.index.getTask(this.value.id));
        form.sayPut(null);
        form.showShut();
        form.refresh();
        this.panel?.redrawPreview();
        form.showDraft();
    }

    /** What the move tells the hub. */
    private readonly moveHost: MoveHost = {
        say: (issues) => this.form?.sayPlace(issues),
        refuse: (why) => this.form?.sayPut(why),
        drafted: () => {
            this.form?.refresh();
            this.panel?.redrawPreview();
        },
        underWay: () => this.form?.showShut(),
        showDraft: () => this.form?.showDraft(),
        submit: () => this.form?.write(),
        leave: () => this.leave(),
        close: () => this.panel?.close(),
    };

    /**
     * The move thrown away: each change is written as it comes again, from
     * the index's copy (the fields shut if the row is gone), where the row
     * stands shown again, and what was said of the move taken back.
     */
    private leave(): void {
        const move = this.move;
        if (!move) return;
        move.dispose();
        this.move = null;
        this.source.hold(false);
        const fresh = this.deps.index.getTask(this.value.id);
        this.missing = fresh === undefined;
        if (fresh) {
            this.value = fresh;
            this.readHeading();
        } else {
            this.forgetHeading();
        }
        this.form?.sayPlace([]);
        this.form?.sayPut(null);
        this.form?.showShut();
        this.form?.refresh();
        this.panel?.redrawPreview();
        this.form?.showDraft();
    }

    /** The source mode opened or closed on the row: the fields are shut while it is open. */
    setSourceOpen(open: boolean): void {
        if (this.sourceOpen === open) return;
        this.sourceOpen = open;
        this.form?.showShut();
    }

    /**
     * Follow the row in the index for the hub that has opened: each change of
     * it (our own writes' echoes among them) becomes the value, drawn in the
     * card and the fields, then told to `follow`; a row the index no longer
     * holds shuts the fields. A hub that opens in a move holds it once the
     * hub has opened, the form built; none on a row read only, or with the
     * fields shut.
     */
    attach(panel: HubPanel): void {
        this.panel = panel;
        this.readHeading();
        this.unsubscribe = this.deps.index.onChange((taskId) => {
            // The parent's text is shown where the row stands.
            if (taskId !== undefined && taskId === this.value.parentId) {
                this.form?.refresh();
                return;
            }
            if (taskId !== undefined && taskId !== this.value.id) return;
            const fresh = this.deps.index.getTask(this.value.id);
            if (this.move) {
                // The draft is the user's work: the move compares the index's row with the one it opened on.
                this.move.follow(fresh);
            } else if (fresh) {
                this.value = fresh;
                panel.redrawPreview();
                this.take(fresh);
                this.readHeading();
            } else {
                this.lose();
            }
            this.source.follow(fresh);
        });
        const opening = this.opening;
        this.opening = null;
        if (!opening || !this.form || this.value.isReadOnly || !this.free()) return;
        this.source.hold(true);
        this.hold(this.form, opening);
    }

    /** The row is gone from the index (deleted, or its name changed): the fields are shut, and where it stood is no longer said. */
    private lose(): void {
        if (this.missing) return;
        this.missing = true;
        this.forgetHeading();
        this.form?.showShut();
        this.form?.refresh();
    }

    /** Where the row stood is no longer said: a read under way comes to nothing. */
    private forgetHeading(): void {
        this.headingReads++;
        this.heading = undefined;
        this.headingOf = null;
    }

    /**
     * Where the row stands, as a place shown with no field: its note, the
     * heading it stands under as last read, and its parent's text where it
     * has a parent (the index's copy of it): none while the index holds no
     * parent of that name, the row of the parent kept. Null once the row is
     * gone.
     */
    shown(): ShownPlace | null {
        if (this.missing) return null;
        const task = this.value;
        if (task.parentId === undefined) return { note: task.file, heading: this.heading, parent: null };
        const parent = this.deps.index.getTask(task.parentId);
        return { note: task.file, heading: this.heading, ...(parent ? { parent: parent.content } : {}) };
    }

    /**
     * Read the heading the row stands under from the note's lines, unless
     * the row stands where it was read for (the same line of the same
     * reading). The lines are taken only while the row's line in them is
     * the row the index read: a note written since is read again once the
     * index has read it, which tells of the row. The last read asked
     * answers; a note that cannot be read leaves the heading unread.
     */
    private readHeading(): void {
        const task = this.value;
        const at = `${task.file}\n${task.reading ?? ''}\n${task.line}`;
        if (at === this.headingOf) return;
        const asked = ++this.headingReads;
        const file = this.deps.app.vault.getAbstractFileByPath(task.file);
        if (!(file instanceof TFile)) return this.readHeadingAs(asked, undefined, null);
        this.deps.app.vault.cachedRead(file).then(
            (content) => {
                const { lines } = splitLines(content);
                if (lines[task.line] !== task.originalText) return;
                const section = sectionAt(lines, task.line, this.deps.plugin.settings);
                this.readHeadingAs(asked, section?.heading?.text ?? null, at);
            },
            (e) => {
                logError(`[RowHost] the heading of ${task.file} could not be read: ${e instanceof Error ? e.message : String(e)}`);
                this.readHeadingAs(asked, undefined, null);
            },
        );
    }

    /** The answer of the read `asked`, taken if it is the last one asked and the hub is open: the form draws where the row stands again. */
    private readHeadingAs(asked: number, heading: string | null | undefined, at: string | null): void {
        if (asked !== this.headingReads || this.closed) return;
        this.headingOf = at;
        if (heading === this.heading) return;
        this.heading = heading;
        this.form?.refresh();
    }

    /** The hub closed: the row is no longer followed, and a refusal that comes after is told by a notice. */
    dispose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.closed = true;
        this.move?.dispose();
    }
}
