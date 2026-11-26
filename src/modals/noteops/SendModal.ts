import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { NoteOps, SendPreview, SendResult } from '../../services/data/NoteOps';
import type { SubtreeFrame } from '../../services/persistence/utils/SubtreeFrame';
import { indentUnit } from '../../utils/ObsidianConfig';
import { OverlayShell, type OverlayFrame } from '../../views/sharedUI/OverlayShell';
import { IssueBoard } from '../form/FormIssue';
import { editorOn, type DraftEditor, type EditorOnHooks } from '../form/source/SourceEditor';
import { FormActions } from '../form/FormActions';
import { SendDialog, initialAsk, type SendField, type SendSurface, type SendViewState } from './SendDialog';
import { SendFields } from './SendFields';
import { SendEditors, type SendEditorsHost } from './SendEditors';

/**
 * The send dialog as it looks: the rows to send
 * in the source editor, the destination's fields and the values offered to
 * write into the note (`SendFields`), what the send does, what keeps a send from being
 * asked and what it is asked in spite of, each said next to what it is of
 * (`IssueBoard`: under the note, the heading or a row, or above the
 * buttons), and cancel and send. It draws
 * what the dialog's state says (`SendViewState`) and does nothing of its
 * own; the dialog's logic is `SendDialog`, and the rows' editors, their
 * drafts and the question a close puts of them are `SendEditors`, which
 * hands the dialog the drafts.
 *
 * It is built of the form's shared pieces, as the task hub is (`_form.css`):
 * the rows, the destination and the values offered are sections
 * (`tv-form__group`) the form divides with a line, and the row of buttons is the
 * one the hub's source mode asks in (`tv-form__buttons`). The title stands
 * in the overlay's head and the row in its foot (`OverlayFrame`): both stay
 * in sight as the rows and the fields scroll.
 *
 * It stands on an overlay (`OverlayShell`, centered), which keeps
 * Obsidian's hotkeys off the note behind while the focus is in it, and asks
 * the editors before a close the user asks for (`beforeClose`). Asked
 * whether to throw the draft away, the row of buttons asks, as every form's
 * row does (`FormActions`).
 */
export class SendModal implements SendSurface, Pick<SendEditorsHost, 'openEditor' | 'showFixed'> {
    private readonly overlay = new OverlayShell();
    private dialog: SendDialog | null = null;
    private editors: SendEditors | null = null;
    private fields!: SendFields;
    private rowsEl!: HTMLElement;
    /** The line under each row, in the order of the rows. */
    private readonly rowSays: HTMLElement[] = [];
    private formSays!: HTMLElement;
    private issues!: IssueBoard<SendField>;
    private actions!: FormActions;

    /**
     * @param sent what the caller does once the rows went, all or some: the
     * dialog closes itself on a send made for all of them.
     */
    constructor(
        private readonly app: App,
        private readonly ops: NoteOps,
        private readonly preview: SendPreview,
        private readonly sent: (result: Exclude<SendResult, { kind: 'not-done' }>) => void = () => { },
    ) { }

    open(): void {
        if (this.overlay.isOpen()) return;
        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog tv-send',
            keymap: this.app.keymap,
            // The first draft, which puts its own caret; the note field when
            // no row opened in the editor.
            initialFocus: () => {
                const editor = this.editors?.firstEditor();
                return editor ? { to: editor } : this.fields.focus('note');
            },
            build: (bodyEl, frame) => this.build(bodyEl, frame),
            onClose: () => {
                this.dialog?.dispose();
                this.dialog = null;
                this.editors?.dispose();
                this.editors = null;
            },
            beforeClose: () => ((this.editors?.beforeClose() ?? true) ? 'close' : 'stay'),
            yieldsEscape: () => this.editors?.yieldsEscape() ?? false,
            takesBack: () => this.editors?.takesBack() ?? false,
        });
    }

    private build(bodyEl: HTMLElement, frame: OverlayFrame): void {
        bodyEl.addClass('tv-form');
        frame.head.createEl('h2', { text: t('modal.send.title'), cls: 'tv-form__title' });

        const rows = bodyEl.createDiv({ cls: 'tv-form__group' });
        this.rowsEl = rows.createDiv({ cls: 'tv-send__rows' });

        this.fields = new SendFields(this.app, bodyEl, {
            initial: initialAsk(this.preview),
            groupClass: 'tv-send__destination',
            onChange: (ask) => this.dialog?.fieldsChanged(ask),
            onEnter: () => this.send(),
            onCheck: (key, checked) => this.dialog?.check(key, checked),
        });

        this.formSays = bodyEl.createDiv({ cls: 'tv-form__says tv-form__says--form' });
        this.issues = new IssueBoard<SendField>({
            field: (at) => (at === 'note' || at === 'heading' ? this.fields.slot(at) : this.rowSlot(at)),
            form: this.formSays,
        });

        this.actions = new FormActions(frame.foot, {
            cancel: { run: () => { void this.overlay.requestClose(); } },
            actions: [{ label: t('modal.send.send'), busyLabel: t('modal.send.sending'), tone: 'cta', run: () => this.send() }],
            ask: { discardLabel: t('modal.draft.discard'), keepLabel: t('modal.draft.keep'), discard: () => this.editors?.discard(), keep: () => this.editors?.keep() },
        });

        this.editors = new SendEditors(this.preview, indentUnit(this.app), {
            openEditor: (frame, hooks) => this.openEditor(frame, hooks),
            showFixed: (lines, why) => this.showFixed(lines, why),
            submit: () => this.send(),
            linkSource: (rowFile) => this.dialog?.notePath() ?? rowFile,
            changed: () => this.dialog?.draftsChanged(),
            asked: () => this.actions.focusKeep(),
            close: () => this.overlay.close(),
        });
        const editors = this.editors;
        this.dialog = new SendDialog(this.preview, {
            facts: (ask) => this.ops.destinationFacts(this.preview, ask),
            timers: (sending) => this.ops.timersRefuse(sending),
            // Shown under the fields; a notice would say it twice.
            send: (req) => this.ops.send(req, { tellRefusal: false }),
            drafts: () => editors.drafts(),
            sent: (result) => this.sent(result),
            close: () => this.overlay.close(),
        }, this);
    }

    /**
     * Send as the dialog holds it: the send button, Enter in a field, or
     * Mod+Enter in an editor. A send that may be asked withdraws the
     * question whether to throw the drafts away.
     */
    private send(): void {
        const dialog = this.dialog;
        if (!dialog) return;
        if (dialog.request() && dialog.state().canSend) this.editors?.withdraw();
        void dialog.send();
    }

    openEditor(frame: SubtreeFrame, hooks: EditorOnHooks): DraftEditor {
        const editor = editorOn(this.rowsEl, frame, this.app, hooks);
        this.rowSays.push(this.rowsEl.createDiv({ cls: 'tv-form__says tv-send__row-says' }));
        return editor;
    }

    showFixed(lines: readonly string[], why: string): void {
        const fixed = this.rowsEl.createDiv({ cls: 'tv-send__fixed' });
        fixed.createEl('pre', { cls: 'tv-form__line-preview', text: lines.join('\n') });
        fixed.createDiv({ cls: 'tv-form__info', text: why });
        this.rowSays.push(this.rowsEl.createDiv({ cls: 'tv-form__says tv-send__row-says' }));
    }

    /** Where what is said of a row's draft goes: the line under it. */
    private rowSlot(at: `row:${number}`): { input: null; message: HTMLElement } | null {
        const message = this.rowSays[Number(at.slice('row:'.length))];
        return message ? { input: null, message } : null;
    }

    render(state: SendViewState): void {
        const asking = this.editors?.asking() ?? false;
        this.rowsEl.toggleClass('tv-source-drafts--asking', asking);

        this.fields.render(state);
        this.issues.set('dialog', [...state.issues, ...this.editors?.issues() ?? []]);

        this.actions.render({
            busy: state.phase === 'sending',
            ctaEnabled: state.canSend,
            ask: asking ? t('modal.draft.discardAsk') : null,
        });
    }

}

