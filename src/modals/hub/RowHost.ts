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
import { splitLines } from '../../services/persistence/FileLines';

export interface RowHostDeps {
    app: App;
    plugin: PluginContext;
    index: IndexReads;
    operations: Operations;
}

/**
 * The host of a hub on a row the note already has: each change handed on is
 * written to the row at once (`Operations.updateTask`), and the row is
 * followed in the index.
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
 */
export class RowHost implements PanelHost {
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

    /**
     * @param follow told of each change of the row after the card and the
     *   fields are, undefined once the index no longer holds it: the hub's
     *   source mode follows the row by it
     */
    constructor(task: Task, private readonly deps: RowHostDeps, private readonly follow: (row: Task | undefined) => void) {
        // A segment of a split task is a key within the display: the hub
        // works on its row, by the row's name.
        const originalId = getOriginalTaskId(task);
        this.value = deps.index.getTask(originalId) ?? { ...task, id: originalId };
    }

    task(): Task {
        return this.value;
    }

    /** @returns whether it was written (a field refused keeps what was typed: `bindField`) */
    put(updates: Partial<Task> | null): Promise<boolean> {
        if (!updates) return Promise.resolve(true);
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
            this.form?.sayWrite(null);
            return;
        }
        this.form?.sayWrite(refusalText(answer.refused));
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

    shut(): string | null {
        if (this.sourceOpen) return t('modal.hub.source.formShut');
        if (this.missing) return t('modal.hub.taskMissing');
        return null;
    }

    /** Open the line on the value (`openSourceLine`); the hub closes, as for any navigation. */
    readonly openSource = (locate: (task: Task) => LineTarget | null): void => {
        void openSourceLine(
            { app: this.deps.app, index: this.deps.index, reuseTab: this.deps.plugin.settings.reuseExistingTab },
            this.value,
            locate,
        );
        this.panel?.close();
    };

    /** Each change is written as it comes: nothing to create. */
    readonly draft = null;

    /**
     * All written, the hub closes; one refused, it stays open with why above
     * the form's tabs. With the fields shut it closes at once: the source mode
     * opened once the writes were done, and a row gone has nothing to wait for.
     */
    closing(): CloseAnswer {
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
     * holds shuts the fields.
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
            if (fresh) {
                this.value = fresh;
                panel.redrawPreview();
                this.take(fresh);
                this.readHeading();
            } else {
                this.lose();
            }
            this.follow(fresh);
        });
    }

    /** The row is gone from the index (deleted, or its name changed): the fields are shut, and where it stood is no longer said. */
    private lose(): void {
        if (this.missing) return;
        this.missing = true;
        this.headingReads++;
        this.heading = undefined;
        this.headingOf = null;
        this.form?.showShut();
        this.form?.refresh();
    }

    /**
     * Where the row stands, as a place shown with no field: its note, the
     * heading it stands under as last read, and its parent's text where it
     * has a parent (the index's copy of it). Null once the row is gone.
     */
    shown(): ShownPlace | null {
        if (this.missing) return null;
        const task = this.value;
        const parent = task.parentId === undefined ? null : this.deps.index.getTask(task.parentId)?.content ?? null;
        return { note: task.file, heading: this.heading, parent };
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
    }
}
