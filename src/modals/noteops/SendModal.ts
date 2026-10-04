import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { NoteOps, SendPreview, SendResult } from '../../services/data/NoteOps';
import type { SubtreeFrame } from '../../services/persistence/utils/SubtreeFrame';
import { indentUnit } from '../../utils/ObsidianConfig';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { createFormRow } from '../form/formRow';
import { SourceEditor, type DraftEditor } from '../form/source/SourceEditor';
import { DestinationField } from './DestinationField';
import { SendDialog, initialAsk, type SendSurface, type SendViewState } from './SendDialog';

/**
 * The send dialog as it looks (`archive/2026-09-send.md`, ダイアログ, 骨組みと並び): the rows to send
 * in the source editor, the destination's fields, what the send does, the
 * values offered for the note's frontmatter, what keeps a send from being
 * asked and what it is asked in spite of, and cancel and send. It draws
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
 * whether to throw the draft away, the row of buttons asks, as the hub's
 * source mode does: the question at its start, discard beside it, and
 * cancel reads back, which keeps the draft.
 */
export class SendModal implements SendSurface {
    private readonly overlay = new OverlayShell();
    private dialog: SendDialog | null = null;
    private field!: DestinationField;
    private rowsEl!: HTMLElement;
    private destinationEl!: HTMLElement;
    private candidatesLabel!: HTMLElement;
    private candidatesEl!: HTMLElement;
    private errorEl!: HTMLElement;
    private warningEl!: HTMLElement;
    private messageEl!: HTMLElement;
    private askEl!: HTMLElement;
    private discardBtn!: HTMLButtonElement;
    private cancelBtn!: HTMLButtonElement;
    private sendBtn!: HTMLButtonElement;
    /** Asked as last drawn: the cancel button is back then. */
    private asking = false;

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
        this.destinationEl = destination.createDiv({ cls: 'tv-send__says' });

        // Put in and taken out rather than hidden (renderCandidates): the
        // last group in the form draws no divider under it.
        this.candidatesLabel = bodyEl.createEl('h4', { cls: 'tv-form__section-label', text: t('modal.send.frontmatter') });
        this.candidatesEl = bodyEl.createDiv({ cls: 'tv-form__group tv-send__candidates' });

        this.errorEl = bodyEl.createDiv({ cls: 'tv-form__error' });
        this.warningEl = bodyEl.createDiv({ cls: 'tv-form__warning' });
        this.messageEl = bodyEl.createDiv({ cls: 'tv-form__error' });

        const actions = bodyEl.createDiv({ cls: 'tv-form__buttons' });
        this.askEl = actions.createSpan({ cls: 'tv-form__ask', text: t('modal.send.discardAsk') });
        this.discardBtn = actions.createEl('button', { cls: 'mod-warning tv-form__discard', text: t('modal.send.discard'), attr: { type: 'button' } });
        this.discardBtn.addEventListener('click', () => this.dialog?.discard());
        this.cancelBtn = actions.createEl('button', { attr: { type: 'button' } });
        this.cancelBtn.addEventListener('click', () => {
            if (this.asking) this.dialog?.keep();
            else void this.overlay.requestClose();
        });
        this.sendBtn = actions.createEl('button', { cls: 'mod-cta', text: t('modal.send.send'), attr: { type: 'button' } });
        this.sendBtn.addEventListener('click', () => { void this.dialog?.send(); });

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
        return new SourceEditor(this.rowsEl, {
            parent: frame.parent,
            children: frame.children,
            indentUnit: frame.unit,
            app: this.app,
            onSubmit: hooks.submit,
            onChange: hooks.edited,
        });
    }

    showFixed(lines: readonly string[], why: string): void {
        const fixed = this.rowsEl.createDiv({ cls: 'tv-send__fixed' });
        fixed.createEl('pre', { cls: 'tv-form__line-preview', text: lines.join('\n') });
        fixed.createDiv({ cls: 'tv-form__info', text: why });
    }

    render(state: SendViewState): void {
        this.rowsEl.toggleClass('tv-source-drafts--asking', state.asking);

        this.destinationEl.empty();
        this.destinationEl.removeClass('tv-form__info', 'tv-form__warning');
        if (state.destination) {
            this.destinationEl.setText(state.destination.text);
            this.destinationEl.addClass(state.destination.tone === 'info' ? 'tv-form__info' : 'tv-form__warning');
        }
        this.destinationEl.toggle(state.destination !== null);
        this.field.offerHeadings(state.headings);
        this.field.markInvalid(state.invalid);

        this.renderCandidates(state.candidates);

        lines(this.errorEl, state.errors);
        lines(this.warningEl, state.warnings);
        lines(this.messageEl, state.message === null ? [] : [state.message]);

        this.askEl.toggle(state.asking);
        this.discardBtn.toggle(state.asking);
        this.cancelBtn.setText(state.asking ? t('modal.send.keep') : t('modal.cancel'));
        this.sendBtn.disabled = !state.canSend;
        this.sendBtn.setText(state.phase === 'sending' ? t('modal.send.sending') : t('modal.send.send'));
        this.asking = state.asking;
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
        if (!this.candidatesEl.isConnected) this.errorEl.before(this.candidatesLabel, this.candidatesEl);
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
        this.cancelBtn.focus();
    }
}

/** Show `texts` in `el`, a line each, and `el` only when there are any. */
function lines(el: HTMLElement, texts: readonly string[]): void {
    el.empty();
    texts.forEach((text, i) => {
        if (i > 0) el.createEl('br');
        el.appendText(text);
    });
    el.toggle(texts.length > 0);
}
