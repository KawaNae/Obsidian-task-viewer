import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { NoteOps, SendPreview, SendResult } from '../../services/data/NoteOps';
import type { SubtreeFrame } from '../../services/persistence/utils/SubtreeFrame';
import { indentUnit } from '../../utils/ObsidianConfig';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { createFormRow } from '../form/formRow';
import { IssueBoard } from '../form/FormIssue';
import { editorOn, type DraftEditor } from '../form/source/SourceEditor';
import { FormActions } from '../form/FormActions';
import { DestinationField } from './DestinationField';
import { SendDialog, initialAsk, type SendField, type SendSurface, type SendViewState } from './SendDialog';

/**
 * The send dialog as it looks (`archive/2026-09-send.md`, ダイアログ, 骨組みと並び): the rows to send
 * in the source editor, the destination's fields, what the send does, the
 * values offered for the note's frontmatter, what keeps a send from being
 * asked and what it is asked in spite of, each said next to what it is of
 * (`IssueBoard`: under the name, the heading or a row, or above the
 * buttons), and cancel and send. It draws
 * what the dialog's state says (`SendViewState`) and does nothing of its
 * own; the dialog's logic is `SendDialog`.
 *
 * It is built of the form's shared pieces, as the task hub is (`_form.css`):
 * the rows, the destination and the values offered are sections
 * (`tv-form__group`) the form divides with a line, the fields are form rows
 * (`createFormRow`) with their icons, the values offered stand under a
 * section label as the hub's properties do, and the row of buttons is the
 * one the hub's source mode asks in (`tv-form__buttons`).
 *
 * It stands on an overlay (`OverlayShell`, centered), which keeps
 * Obsidian's hotkeys off the note behind while the focus is in it, and asks
 * the dialog before a close the user asks for (`beforeClose`). Asked
 * whether to throw the draft away, the row of buttons asks, as every form's
 * row does (`FormActions`).
 */
export class SendModal implements SendSurface {
    private readonly overlay = new OverlayShell();
    private dialog: SendDialog | null = null;
    private field!: DestinationField;
    private rowsEl!: HTMLElement;
    /** The line under each row, in the order of the rows. */
    private readonly rowSays: HTMLElement[] = [];
    private candidatesLabel!: HTMLElement;
    private candidatesEl!: HTMLElement;
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
            // The first draft; the note's name when no row opened in the editor.
            initialFocus: () => this.dialog?.firstEditor() ?? this.field,
            build: (bodyEl) => this.build(bodyEl),
            onClose: () => {
                this.dialog?.dispose();
                this.dialog = null;
            },
            beforeClose: () => ((this.dialog?.beforeClose() ?? true) ? 'close' : 'stay'),
            yieldsEscape: () => this.dialog?.yieldsEscape() ?? false,
            takesBack: () => this.dialog?.takesBack() ?? false,
        });
    }

    private build(bodyEl: HTMLElement): void {
        bodyEl.addClass('tv-form');
        bodyEl.createEl('h2', { text: t('modal.send.title'), cls: 'tv-form__title' });

        const rows = bodyEl.createDiv({ cls: 'tv-form__group' });
        this.rowsEl = rows.createDiv({ cls: 'tv-send__rows' });

        const destination = bodyEl.createDiv({ cls: 'tv-form__group tv-send__destination' });
        const initial = initialAsk(this.preview);
        this.field = new DestinationField(this.app, destination, {
            initial,
            defaultHeading: this.preview.defaults.section.heading,
            onChange: () => this.dialog?.fieldsChanged(this.field.ask()),
            onEnter: () => { void this.dialog?.send(); },
        });

        // Put in and taken out rather than hidden (renderCandidates): the
        // last group in the form draws no divider under it.
        this.candidatesLabel = bodyEl.createEl('h4', { cls: 'tv-form__section-label', text: t('modal.send.frontmatter') });
        this.candidatesEl = bodyEl.createDiv({ cls: 'tv-form__group tv-send__candidates' });

        this.formSays = bodyEl.createDiv({ cls: 'tv-form__says tv-form__says--form' });
        this.issues = new IssueBoard<SendField>({
            field: (at) => (at === 'name' || at === 'heading' ? this.field.slot(at) : this.rowSlot(at)),
            form: this.formSays,
        });

        this.actions = new FormActions(bodyEl, {
            cancel: { run: () => { void this.overlay.requestClose(); } },
            actions: [{ label: t('modal.send.send'), busyLabel: t('modal.send.sending'), tone: 'cta', run: () => { void this.dialog?.send(); } }],
            ask: { discardLabel: t('modal.draft.discard'), keepLabel: t('modal.draft.keep'), discard: () => this.dialog?.discard(), keep: () => this.dialog?.keep() },
        });

        this.dialog = new SendDialog(this.preview, {
            facts: (ask) => this.ops.destinationFacts(this.preview, ask),
            timers: (sending) => this.ops.timersRefuse(sending),
            // Shown under the fields; a notice would say it twice.
            send: (req) => this.ops.send(req, { tellRefusal: false }),
            indentUnit: () => indentUnit(this.app),
            sent: (result) => this.sent(result),
            close: () => this.overlay.close(),
        }, this);
    }

    openEditor(frame: SubtreeFrame, hooks: { submit(): void; edited(): void }): DraftEditor {
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
        this.rowsEl.toggleClass('tv-source-drafts--asking', state.asking);

        this.field.offerHeadings(state.headings);
        this.renderCandidates(state.candidates);
        this.issues.set('dialog', state.issues);

        this.actions.render({
            busy: state.phase === 'sending',
            ctaEnabled: state.canSend,
            ask: state.asking ? t('modal.draft.discardAsk') : null,
        });
    }

    /**
     * The values offered for the frontmatter, a form row each, as the hub's
     * properties are: the key in the label's place, and the box, the value
     * and where it comes from in the control's. Their section stands after
     * the destination's while there are any, and is out of the form while
     * there are none.
     */
    private renderCandidates(candidates: SendViewState['candidates']): void {
        this.candidatesEl.empty();
        if (candidates === null) {
            this.candidatesLabel.detach();
            this.candidatesEl.detach();
            return;
        }
        if (!this.candidatesEl.isConnected) this.formSays.before(this.candidatesLabel, this.candidatesEl);
        for (const one of candidates) {
            const { row } = createFormRow(this.candidatesEl, one.key, { alignStart: true });
            const label = row.createEl('label', { cls: 'tv-send__candidate' });
            const box = label.createEl('input', { type: 'checkbox' });
            box.checked = one.checked;
            box.disabled = one.shut !== null;
            box.addEventListener('change', () => this.dialog?.check(one.key, box.checked));
            label.createSpan({ cls: 'tv-send__value', text: one.value });
            label.createSpan({ cls: 'tv-send__from', text: one.from });
            if (one.shut) label.createSpan({ cls: 'tv-send__from', text: one.shut });
        }
    }

    /** Asked, first or again: back takes the focus, where cancel was. */
    asked(): void {
        this.actions.focusKeep();
    }
}

