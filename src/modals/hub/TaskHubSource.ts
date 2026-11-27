import { t } from '../../i18n';
import type { Task } from '../../types';
import { SubtreeFrame } from '../../services/persistence/utils/SubtreeFrame';
import type { DraftEditor, EditorOnHooks } from '../form/source/SourceEditor';
import type { FormIssue } from '../form/FormIssue';
import { placeFocus } from '../../views/sharedUI/FocusPlacement';

/**
 * The hub's switch between the card and the source: the row and its subtree
 * as text in an editor, in the card's place.
 *
 * The switch holds where it is (the card, opening the source, the source),
 * why the source cannot open, the editor, the Escape and the back it takes
 * for the editor's completion list, and the draft as lines to copy. Whose the
 * text is while it is open is the seat's (`SourceSeat`), which the host names
 * (`SourceHost.seat`): the row the source opens on, what the switch back to
 * the card does, what Mod+Enter does, whether a close asks, and whether the
 * seat has a row of buttons under the editor. The switch asks the seat as it
 * opens and draws what the seat's answer says (`SeatView`); it knows no kind
 * of seat. What it looks like is the surface's (`TaskHubSourceView`).
 *
 * - The source opens on the lines the seat hands (`SourceSeat.open`), once:
 *   that subtree is the frame every draft is read against
 *   (`SubtreeFrame.open`).
 * - The hub may hold the row for a write of its own (a move being begun, or
 *   under way): the switch to the source is not offered meanwhile, and an
 *   opening under way gives up ({@link hold}).
 */

/** Where the switch is: showing the card, opening the source, or in it. */
export type SourcePhase = 'view' | 'entering' | 'source';

/** The row the switch is drawn for: the source opens on its `lines`, undefined when it has none to open. */
export interface SeatRow {
    task: Task;
    lines: readonly string[] | undefined;
}

/** What the source opens on: the lines, and the note a link typed in them is written in, asked at each completion. */
export interface SourceOpening {
    lines: readonly string[];
    linkSource(): string;
}

/** What the seat says of the source open on it, for the switch to draw. */
export interface SeatView {
    /** The seat's own row of buttons under the editor, `act` whether its button that writes is offered; null, none is shown. */
    foot: { act: boolean } | null;
    /** The seat writes the draft: the switch back is not offered, and the editor's Escape and back are the hub's. */
    busy: boolean;
    /** The seat asks whether to throw the draft away: the switch back is not offered, and the editor's frame is marked. */
    asking: boolean;
    /** The row is lost, or changed outside: `why`, said with a button to copy the draft, and `discard` one to throw it away; null, nothing is said. */
    lost: { why: string; discard: boolean } | null;
}

/** Whose the source's text is (`SourceHost.seat`): what each step on it does. */
export interface SourceSeat {
    /** The row the switch is drawn for; undefined once the hub lost it. */
    row(): SeatRow | undefined;
    /**
     * What the source opens on; null, it gives up, the seat telling why.
     * `live` says whether the opening is still wanted. Every seat first
     * saves what is typed in the hub's fields itself, so the source opens on
     * what was typed: the switch saves it by this alone. A seat on the row
     * the note holds writes what reads and leaves a value that cannot be
     * saved typed in its field (`HubForm.saveTyped`), and opens. The seat of
     * a move opens on a draft that takes what is typed, so it opens only
     * once all of it is put in (`HubForm.putTyped`); a value that cannot be
     * keeps it from opening, the focus taken to it.
     */
    open(live: () => boolean): Promise<SourceOpening | null>;
    /** The source opened on what `open` handed. */
    opened(source: OpenSource): void;
    /** The switch back to the card. */
    back(): void;
    /** Mod+Enter in the editor. */
    submit(): void;
    /** The editor's text changed. */
    edited(): void;
    /** Whether the hub may close now (`OverlayShell.beforeClose`). */
    beforeClose(): boolean;
    view(): SeatView;
}

/** The source as it is open, to the seat that holds it. */
export interface OpenSource {
    readonly frame: SubtreeFrame;
    readonly editor: DraftEditor;
    /** Say why under the editor, as an error of the source; null takes it back. */
    say(why: string | null): void;
    /** Draw the seat's answer again. */
    redraw(): void;
    /** The seat's question was put, first or again: the focus goes to its answer that keeps (`SourceSurface.asked`). */
    asked(): void;
    /** The editor takes the focus (`placeFocus`). */
    focusEditor(): void;
    /** Back to the card, the editor gone. */
    end(): void;
}

/** What the surface shows. */
export interface SourceViewState {
    phase: SourcePhase;
    /** In view: why the switch to the source is not offered; null when it is. */
    shut: string | null;
    /** The hub holds the row for a write of its own: the switch to the source is not offered. */
    held: boolean;
    /** Under the editor: what the seat last said, as an error of the source (`'form'`). */
    issues: readonly FormIssue<never>[];
    /** In the source: what its seat says of it; null out of it. */
    seat: SeatView | null;
}

export interface SourceSurface {
    /** Open the editor on `frame`'s text: `submit` on Mod+Enter, `edited` on a change of its text, a link spelt from the note `linkSource` names. */
    openEditor(frame: SubtreeFrame, hooks: EditorOnHooks): DraftEditor;
    render(state: SourceViewState): void;
    /**
     * The question whether to throw the draft away was put, first or again
     * (a close refused while it stands): the focus goes to its answer that
     * keeps the draft. Moved from the editor, it takes a phone's keyboard
     * down with it, and a stray Enter keeps the draft.
     */
    asked(): void;
}

export interface SourceHost {
    /** Whose the text is if the source opens now. */
    seat(): SourceSeat;
    /** A new level of indentation, as Obsidian's settings say (`ObsidianConfig.indentUnit`). */
    indentUnit(): string;
}

/** The source as it was opened, and the seat it was opened on. */
interface Open {
    seat: SourceSeat;
    frame: SubtreeFrame;
    editor: DraftEditor;
}

export class TaskHubSource {
    private phase: SourcePhase = 'view';
    private open: Open | null = null;
    private message: string | null = null;
    private disposed = false;
    /** The hub holds the row for a write of its own. */
    private held = false;

    constructor(private readonly host: SourceHost, private readonly surface: SourceSurface) {
        this.render();
    }

    /** The row, or what its seat says, changed: draw it again. */
    redraw(): void {
        this.render();
    }

    state(): SourceViewState {
        return {
            phase: this.phase,
            shut: this.phase === 'view' ? this.shutReason() : null,
            held: this.held,
            issues: this.message === null ? [] : [{ at: 'form', tone: 'error', text: this.message }],
            seat: this.open?.seat.view() ?? null,
        };
    }

    /**
     * The hub holds the row for a write of its own, or lets it go: while it
     * holds it the source does not open, and an opening under way goes back
     * to the card. A source open stays as its seat says.
     */
    hold(held: boolean): void {
        if (this.held === held) return;
        this.held = held;
        if (held && this.phase === 'entering') return this.giveUp();
        this.render();
    }

    /** Switch to the source, on the seat the host names now. */
    async enter(): Promise<void> {
        if (this.phase !== 'view' || this.held || this.shutReason() !== null) return;
        const seat = this.host.seat();
        this.phase = 'entering';
        this.render();

        const opening = await seat.open(() => this.stillEntering());
        if (!this.stillEntering()) return;
        if (!opening) return this.giveUp();
        const { lines } = opening;
        const framed = SubtreeFrame.open(lines, this.host.indentUnit());
        if (!framed.open) return this.giveUp();
        const { frame } = framed;
        // The editor numbers a child line by its line in the children it was
        // opened with; a draft read against the frame takes that number as
        // the line's offset in the subtree. The two are one only when every
        // line under the row is one line of the children.
        if (frame.children.length !== lines.length - 1) {
            throw new Error(`the source opened ${frame.children.length} child lines on a subtree of ${lines.length} lines`);
        }

        const editor = this.surface.openEditor(frame, {
            submit: () => seat.submit(),
            edited: () => seat.edited(),
            linkSource: () => opening.linkSource(),
        });
        const open: Open = { seat, frame, editor };
        this.open = open;
        this.phase = 'source';
        seat.opened({
            frame,
            editor,
            say: (why) => {
                if (this.open !== open) return;
                this.message = why;
                this.render();
            },
            redraw: () => this.render(),
            asked: () => this.surface.asked(),
            focusEditor: () => placeFocus({ to: editor }),
            end: () => this.close(open),
        });
        this.render();
        placeFocus({ to: editor });
    }

    /** The switch back to the card: an opening under way gives up; in the source, the seat says what it does. */
    back(): void {
        if (this.phase === 'entering') return this.giveUp();
        this.open?.seat.back();
    }

    /** Whether the hub may close now (`OverlayShell` asks it before a close the user asked for): in the source, as its seat says. */
    beforeClose(): boolean {
        return this.open?.seat.beforeClose() ?? true;
    }

    /** Whether an Escape is the editor's own (a completion list to close), not the hub's. */
    yieldsEscape(): boolean {
        return this.editorKeys()?.isCompleting() ?? false;
    }

    /** The back as the editor's own: a completion list closes, as on Escape. Whether it took the back. */
    takesBack(): boolean {
        return this.editorKeys()?.closeCompletion() ?? false;
    }

    /** The editor while its own keys are offered: in the source, its seat not writing the draft. */
    private editorKeys(): DraftEditor | null {
        const open = this.open;
        return open && !open.seat.view().busy ? open.editor : null;
    }

    /**
     * The draft as lines of the file, to copy out of a hub that can no longer
     * write it: the lines a write would be handed, or the subtree as opened
     * when the draft is the same. Null when there is no draft open.
     */
    draftText(): string | null {
        if (!this.open) return null;
        const { frame, editor } = this.open;
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
        this.open?.editor.destroy();
        this.open = null;
    }

    /** Why the switch to the source is not offered, or null. */
    private shutReason(): string | null {
        const row = this.host.seat().row();
        if (!row) return t('modal.hub.taskMissing');
        if (row.task.isReadOnly) return t('modal.hub.source.readOnly');
        if (!row.lines) return t('modal.hub.source.notWritable');
        const opening = SubtreeFrame.open(row.lines, this.host.indentUnit());
        return opening.open ? null : t('modal.hub.source.shallow', { line: String(opening.line) });
    }

    private stillEntering(): boolean {
        return !this.disposed && this.phase === 'entering';
    }

    /** Opening given up: the card again. */
    private giveUp(): void {
        if (this.disposed || this.phase !== 'entering') return;
        this.phase = 'view';
        this.render();
    }

    /** The seat ended the source `open`: the card again, the editor and what was said under it gone. */
    private close(open: Open): void {
        if (this.open !== open) return;
        open.editor.destroy();
        this.open = null;
        this.message = null;
        this.phase = 'view';
        this.render();
    }

    private render(): void {
        if (this.disposed) return;
        this.surface.render(this.state());
    }
}
