import { t } from '../../i18n';
import type { SendPreview } from '../../services/data/NoteOps';
import type { SubtreeReplacement } from '../../services/persistence/TaskOps';
import { Outline } from '../../services/parsing/utils/Outline';
import { SubtreeFrame, type DraftCheck } from '../../services/persistence/utils/SubtreeFrame';
import { placeFocus } from '../../views/sharedUI/FocusPlacement';
import type { DraftEditor, EditorOnHooks } from '../form/source/SourceEditor';
import { DraftGuard } from '../form/DraftGuard';
import type { FormIssue } from '../form/FormIssue';
import { rowBase, type SendField } from './SendDialog';

/** What the send modal's editors ask of the modal they stand in. */
export interface SendEditorsHost {
    /**
     * Open an editor on a row's subtree, in the order of the rows: `submit`
     * on Mod+Enter, `edited` on a change of its text; a link typed in it is
     * spelt from the note `linkSource` names.
     */
    openEditor(frame: SubtreeFrame, hooks: EditorOnHooks): DraftEditor;
    /** Show a row the editor cannot open, in the order of the rows: its lines as they go, and why. */
    showFixed(lines: readonly string[], why: string): void;
    /** Mod+Enter in an editor: send as the dialog holds it. */
    submit(): void;
    /** The note a link typed in a row's editor is written in, for a row of the note `rowFile`. */
    linkSource(rowFile: string): string;
    /** A draft changed, or the question was put, withdrawn or answered: draw again. */
    changed(): void;
    /** The question whether to throw the drafts away was put, first or again: the focus goes to its answer that keeps them. */
    asked(): void;
    /** Thrown away, as asked: close, asking nothing more. */
    close(): void;
}

/** A row as the modal opened it: in an editor, or as it stands. */
type OpenedRow =
    | { kind: 'editor'; frame: SubtreeFrame; editor: DraftEditor }
    | { kind: 'fixed' };

/**
 * The rows of the send modal in the source editor, and what their drafts
 * are to the send dialog (`SendHost.drafts`) and to a close.
 *
 * - Each row opens in the source editor (`SubtreeFrame.open`), as the hub's
 *   source mode opens it. A row whose subtree does not open (`shallow`) is
 *   shown as its lines, moved to the first column, and goes as it stands.
 * - Why a row's draft cannot be written is said under that row; while one
 *   cannot, the dialog is handed no drafts, and asks no send.
 * - A draft is never lost to a close the user asks for: the modal asks
 *   first (`beforeClose`), as the hub's source mode does (`DraftGuard`). A
 *   draft is a row whose editor holds other lines than it opened on
 *   (`SubtreeFrame.check` is not `same`); the fields are not asked about.
 */
export class SendEditors {
    private readonly rows: OpenedRow[] = [];
    /** Whether to throw the drafts away, asked before a close that would lose them. */
    private readonly guard: DraftGuard<'close'>;

    constructor(preview: SendPreview, indentUnit: string, private readonly host: SendEditorsHost) {
        this.guard = new DraftGuard<'close'>({
            loss: () => (this.hasDraft() ? { kind: 'draft' } : null),
            render: () => host.changed(),
            asked: () => host.asked(),
            goOn: () => host.close(),
        });
        for (const row of preview.rows) {
            const base = rowBase(row);
            const opening = SubtreeFrame.open(base, indentUnit);
            if (opening.open) {
                const editor = host.openEditor(opening.frame, {
                    submit: () => host.submit(),
                    edited: () => this.edited(),
                    linkSource: () => host.linkSource(row.task.file),
                });
                this.rows.push({ kind: 'editor', frame: opening.frame, editor });
            } else {
                host.showFixed(atFirstColumn(base), t('modal.send.shallow', { line: String(opening.line) }));
                this.rows.push({ kind: 'fixed' });
            }
        }
    }

    /** Each row's draft, as the dialog asks it (`SendHost.drafts`): null for all while one cannot be written. */
    drafts(): (SubtreeReplacement | null)[] | null {
        const checks = this.checks();
        if (checks.some(check => check?.kind === 'refused')) return null;
        return checks.map(check => (check?.kind === 'write' ? check.replacement : null));
    }

    /** Why a row's draft cannot be written, under that row. */
    issues(): FormIssue<SendField>[] {
        return this.checks().flatMap((check, i): FormIssue<SendField>[] => (check?.kind === 'refused'
            ? [{ at: `row:${i}`, tone: 'error', text: draftError(check.reason) }]
            : []));
    }

    /** Whether the question whether to throw the drafts away is put. */
    asking(): boolean {
        return this.guard.asking !== null;
    }

    /**
     * Whether the modal may close now (`OverlayShell` asks it before a close
     * the user asked for). Not while a row's editor holds a draft: it asks
     * whether to throw it away, and closes if the user says so. Asked again
     * while it asks, the question is put again.
     */
    beforeClose(): boolean {
        return this.guard.request('close');
    }

    /** Throw the drafts away, as asked, and close. */
    discard(): void {
        this.guard.discard();
    }

    /** Keep the drafts: the question is withdrawn, and the first editor takes the focus. */
    keep(): void {
        if (!this.guard.keep()) return;
        const editor = this.firstEditor();
        if (editor) placeFocus({ to: editor });
    }

    /** A send is being made of the drafts: the question is withdrawn. */
    withdraw(): void {
        this.guard.withdraw();
    }

    /** Whether an Escape is an editor's own (a completion list to close), not the modal's. */
    yieldsEscape(): boolean {
        return this.editors().some(editor => editor.isCompleting());
    }

    /** The back as an editor's own: a completion list closes, as on Escape. Whether one took it. */
    takesBack(): boolean {
        return this.editors().map(editor => editor.closeCompletion()).some(Boolean);
    }

    /** The editor the modal focuses as it opens; none when no row opened in one. */
    firstEditor(): DraftEditor | null {
        return this.editors()[0] ?? null;
    }

    dispose(): void {
        for (const editor of this.editors()) editor.destroy();
    }

    /** A draft's text changed: drawn again, and, asked whether to throw it away, the question is withdrawn. */
    private edited(): void {
        if (!this.guard.withdraw()) this.host.changed();
    }

    private editors(): DraftEditor[] {
        return this.rows.flatMap(row => (row.kind === 'editor' ? [row.editor] : []));
    }

    /** What each row's editor's draft comes to; null for a row shown as it stands. */
    private checks(): (DraftCheck | null)[] {
        return this.rows.map(row => (row.kind === 'editor' ? row.frame.check(row.editor.draft()) : null));
    }

    private hasDraft(): boolean {
        return this.checks().some(check => check !== null && check.kind !== 'same');
    }
}

function draftError(reason: Extract<DraftCheck, { kind: 'refused' }>['reason']): string {
    return reason === 'parent-break' ? t('modal.send.parentBreak') : t('modal.send.notTask');
}

/** A subtree's lines as they read from the row: the row's indentation taken off every line. */
function atFirstColumn(base: readonly string[]): string[] {
    const indent = Outline.indentOf(base[0]);
    return base.map(line => (Outline.isBlank(line) ? '' : Outline.shiftIndent(line, indent, '')));
}
