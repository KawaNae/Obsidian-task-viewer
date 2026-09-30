import { t } from '../../i18n';
import type { Task } from '../../types';
import { refusalNotice, type IndexRefusal } from '../../services/core/RefusalClause';
import type { SubtreeReplacement } from '../../services/persistence/TaskOps';
import { SubtreeFrame } from '../../services/persistence/utils/SubtreeFrame';
import type { DraftEditor } from '../form/source/SourceEditor';

/**
 * The hub's source mode: the row and its subtree as text, written from a
 * draft when the user applies it, and nowhere else (source-mode-design.md,
 * 3「確定の仕方」).
 *
 * This is the mode's logic, apart from the DOM: when the switch is offered,
 * what the source opens on, what an apply writes, what a refusal leaves, and
 * whether the hub may close. What it looks like is the surface's
 * (`TaskHubSourceView`); where the text comes from and goes to is the host's
 * (the hub panel).
 *
 * - Entering waits for the form's writes queued so far, asks whether the
 *   hub's copy is the row on the disk (`confirm`), and opens its subtree once
 *   (`SubtreeFrame.open`): that subtree is the base every apply is checked
 *   against. The form is shut while the source is open, since two ways of
 *   writing one row would have one of them refused.
 * - An apply writes the parent and the children in one write, or leaves at
 *   once when the draft is the subtree opened. A refused draft stays, with
 *   why under it; the same draft again is not written again, since nothing
 *   the index holds has changed what the write would say of it.
 * - A draft the user has not thrown away is never lost to a close the user
 *   asks for: the hub asks first (`beforeClose`), in the same place as a
 *   cancel does. Going back to the draft withdraws the question as its keep
 *   does: an edit of the text, or an apply, which goes on as asked. A focus
 *   given back to the editor without an edit leaves the question, since
 *   reading the draft or copying from it is a way to answer it.
 * - A row the hub lost (a change from outside renamed it) keeps the draft,
 *   and offers no apply: copying the draft and throwing it away is the way
 *   out.
 */

/** Where the mode is: showing the card, opening the source, editing it, or writing a draft. */
export type SourcePhase = 'view' | 'entering' | 'source' | 'applying';

/** What the surface shows. */
export interface SourceViewState {
    phase: SourcePhase;
    /** In view: why the switch to the source is not offered; null when it is. */
    shut: string | null;
    /** Under the editor: why the last apply wrote nothing. */
    message: string | null;
    /** Asking whether to throw the draft away. */
    asking: boolean;
    /** The hub lost the row: the draft cannot be written. */
    lost: boolean;
}

export interface SourceSurface {
    /** Open the editor on `frame`'s text: `submit` on Mod+Enter, `edited` on a change of its text. */
    openEditor(frame: SubtreeFrame, hooks: { submit(): void; edited(): void }): DraftEditor;
    render(state: SourceViewState): void;
    /**
     * The question whether to throw the draft away was put, first or again
     * (a close refused while it stands): the focus goes to its answer that
     * keeps the draft. Moved from the editor, it takes a phone's keyboard
     * down with it, and a stray Enter keeps the draft.
     */
    asked(): void;
}

export type ReplaceAnswer = { written: true } | { written: false; refused: IndexRefusal | null };

export interface SourceHost {
    /** Resolves once the form's writes queued so far are done. */
    drained(): Promise<void>;
    /** Whether the index's copy of the row is the row on the disk (`Operations.confirmTask`); told the user when not. */
    confirm(taskId: string): Promise<boolean>;
    /** The index's copy of the row, followed through our own writes (`TaskReadService.getTask`). */
    reread(taskId: string): Task | undefined;
    /** Write the draft (`Operations.replaceSubtree`), the refusal shown here rather than in a notice. */
    replace(taskId: string, base: readonly string[], replacement: SubtreeReplacement): Promise<ReplaceAnswer>;
    /** A new level of indentation, as Obsidian's settings say (`ObsidianConfig.indentUnit`). */
    indentUnit(): string;
    /** Shut the form while the source is open, and open it again after. */
    lockForm(locked: boolean): void;
    /** Close the hub, asking nothing more: the draft was thrown away for a close the user asked for. */
    closeHub(): void;
}

/** What throwing the draft away goes on to: the card, or closing the hub. */
type After = 'view' | 'close';

/** The source as it was opened. */
interface Opened {
    frame: SubtreeFrame;
    editor: DraftEditor;
}

export class TaskHubSource {
    private phase: SourcePhase = 'view';
    private current: Task | undefined;
    private opened: Opened | null = null;
    private message: string | null = null;
    private asking: After | null = null;
    /** The draft last refused, and why: not written again while it stays the same. */
    private refused: { key: string; message: string } | null = null;
    private disposed = false;

    constructor(task: Task, private readonly host: SourceHost, private readonly surface: SourceSurface) {
        this.current = task;
        this.render();
    }

    /** The row as the hub follows it; undefined once the hub lost it. */
    follow(task: Task | undefined): void {
        this.current = task;
        this.render();
    }

    state(): SourceViewState {
        return {
            phase: this.phase,
            shut: this.phase === 'view' ? this.shutReason() : null,
            message: this.message,
            asking: this.asking !== null,
            lost: this.current === undefined,
        };
    }

    /** Switch to the source. */
    async enter(): Promise<void> {
        if (this.phase !== 'view' || this.shutReason() !== null) return;
        this.phase = 'entering';
        this.render();

        await this.host.drained();
        const known = this.current;
        const copy = known && this.host.reread(known.id);
        if (!this.stillEntering()) return;
        if (!copy || !(await this.host.confirm(copy.id))) return this.back();
        if (!this.stillEntering()) return;
        const fresh = this.host.reread(copy.id);
        if (!fresh || fresh.isReadOnly || !fresh.subtreeLines) return this.back();

        const base = fresh.subtreeLines;
        const opening = SubtreeFrame.open(base, this.host.indentUnit());
        if (!opening.open) return this.back();
        const { frame } = opening;
        // The editor numbers a child line by its line in the children it was
        // opened with; the write reads that number as the line's offset in
        // the subtree. The two are one only when every line under the row is
        // one line of the children.
        if (frame.children.length !== base.length - 1) {
            throw new Error(`the source opened ${frame.children.length} child lines on a subtree of ${base.length} lines`);
        }

        const editor = this.surface.openEditor(frame, {
            submit: () => { void this.apply(); },
            edited: () => this.edited(),
        });
        this.opened = { frame, editor };
        this.current = fresh;
        this.phase = 'source';
        this.host.lockForm(true);
        this.render();
        editor.focus();
    }

    /** Write the draft: the apply button, or Mod+Enter. Asked whether to throw it away, the question is withdrawn. */
    async apply(): Promise<void> {
        const opened = this.opened;
        const row = this.current;
        if (this.phase !== 'source' || !opened || !row) return;
        this.asking = null;

        const check = opened.frame.check(opened.editor.draft());
        if (check.kind === 'same') return this.leave();
        if (check.kind === 'refused') {
            this.message = check.reason === 'parent-break' ? t('modal.hub.source.parentBreak') : t('modal.hub.source.notTask');
            return this.render();
        }
        const key = keyOf(check.replacement);
        if (this.refused?.key === key) {
            this.message = this.refused.message;
            return this.render();
        }

        this.phase = 'applying';
        this.message = null;
        this.render();
        const answer = await this.host.replace(row.id, opened.frame.base, check.replacement);
        if (this.disposed || this.opened !== opened) return;
        if (answer.written) return this.leave();
        const message = answer.refused ? refusalNotice(answer.refused) : t('modal.hub.source.notWritable');
        this.refused = { key, message };
        this.phase = 'source';
        this.message = message;
        this.render();
    }

    /** Back to the card: the cancel button, or the switch. Asks first when there is a draft. */
    cancel(): void {
        if (this.phase === 'entering') return this.back();
        if (this.phase !== 'source' || this.asking) return;
        if (this.opened?.editor.isDirty()) return this.ask('view');
        this.leave();
    }

    /**
     * Whether the hub may close now (`OverlayShell` asks it before a close
     * the user asked for). Not while there is a draft: the hub asks whether
     * to throw it away, and closes if the user says so. Asked while it is
     * already asking (a close after the switch to the card asked, or a
     * close again), the question is put again, and throwing the draft away
     * now closes: what the user asked for last is what it goes on to. Every
     * close refused puts the question, so each takes the focus to its answer
     * as the first did.
     */
    beforeClose(): boolean {
        if (this.phase !== 'source' && this.phase !== 'applying') return true;
        if (!this.asking && !this.opened?.editor.isDirty()) return true;
        this.ask('close');
        return false;
    }

    /** Throw the draft away, as asked, and go on to what asked. */
    discard(): void {
        const after = this.asking ?? 'view';
        this.asking = null;
        this.leave();
        if (after === 'close') this.host.closeHub();
    }

    /** Keep the draft: the question is withdrawn. */
    keep(): void {
        if (!this.asking) return;
        this.asking = null;
        this.render();
        this.opened?.editor.focus();
    }

    /** The draft's text changed: asked whether to throw it away, the question is withdrawn. */
    private edited(): void {
        if (!this.asking) return;
        this.asking = null;
        this.render();
    }

    /** Whether an Escape is the editor's own (a completion list to close), not the hub's. */
    yieldsEscape(): boolean {
        return this.phase === 'source' && (this.opened?.editor.isCompleting() ?? false);
    }

    /** The back as the editor's own: a completion list closes, as on Escape. Whether it took the back. */
    takesBack(): boolean {
        return this.phase === 'source' && (this.opened?.editor.closeCompletion() ?? false);
    }

    /**
     * The draft as lines of the file, to copy out of a hub that can no longer
     * write it: the lines the apply would write, or the subtree as opened
     * when the draft is the same. Null when there is no draft open.
     */
    draftText(): string | null {
        if (!this.opened) return null;
        const { frame, editor } = this.opened;
        const draft = editor.draft();
        const check = frame.check(draft);
        switch (check.kind) {
            case 'write': return [check.replacement.text, ...check.replacement.children.map(line => line.text)].join('\n');
            case 'same': return frame.base.join('\n');
            case 'refused': return [draft.parent, ...draft.children.map(line => line.text)].join('\n');
        }
    }

    dispose(): void {
        this.disposed = true;
        this.opened?.editor.destroy();
        this.opened = null;
    }

    /** Why the switch to the source is not offered, or null. */
    private shutReason(): string | null {
        const task = this.current;
        if (!task) return t('modal.hub.taskMissing');
        if (task.isReadOnly) return t('modal.hub.source.readOnly');
        if (!task.subtreeLines) return t('modal.hub.source.notWritable');
        const opening = SubtreeFrame.open(task.subtreeLines, this.host.indentUnit());
        return opening.open ? null : t('modal.hub.source.shallow', { line: String(opening.line) });
    }

    private stillEntering(): boolean {
        return !this.disposed && this.phase === 'entering';
    }

    /** Entering given up: the card again. */
    private back(): void {
        if (this.disposed || this.phase !== 'entering') return;
        this.phase = 'view';
        this.render();
    }

    /** Put the question, first or again, and go on to `after` if the draft is thrown away. */
    private ask(after: After): void {
        const drawn = this.asking !== null;
        this.asking = after;
        if (!drawn) this.render();
        this.surface.asked();
    }

    /** The source closed, the draft with it: the card again, and the form open. */
    private leave(): void {
        this.asking = null;
        this.opened?.editor.destroy();
        this.opened = null;
        this.message = null;
        this.refused = null;
        this.phase = 'view';
        if (!this.disposed) this.host.lockForm(false);
        this.render();
    }

    private render(): void {
        if (this.disposed) return;
        this.surface.render(this.state());
    }
}

/** A replacement as the one it is: the lines it writes, and which line each child was. */
function keyOf(replacement: SubtreeReplacement): string {
    return JSON.stringify([replacement.text, replacement.children.map(line => [line.text, line.was])]);
}
