import type { App } from 'obsidian';
import { t } from '../../i18n';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { FormActions } from '../form/FormActions';
import { IssueBoard } from '../form/FormIssue';
import { SectionDialog, readSectionNote, type SectionAsk, type SectionField as SectionFieldName, type SectionSurface, type SectionViewState } from './SectionDialog';
import { SectionField } from './SectionField';

/** What a {@link SectionModal} is opened for, and what it opens with. */
export interface SectionModalOptions {
    /** To add a frame, or to choose again the section a frame shows: the title and the button say which. */
    purpose: 'add' | 'relink';
    initial: SectionAsk;
    /** A section was chosen: the link that names it. The dialog closes itself. */
    chosen(link: string): void;
}

/**
 * The section dialog as it looks: the note and the heading (`SectionField`),
 * what each names said under it (`IssueBoard`), and cancel and the button
 * that chooses. It draws what the dialog's state says (`SectionViewState`)
 * and does nothing of its own; the dialog's logic is `SectionDialog`.
 *
 * It is built of the form's shared pieces, as the send dialog is
 * (`_form.css`), and stands on an overlay (`OverlayShell`, centered). It
 * opens with the focus on the heading field when the note field names a
 * note picked, and on the note field otherwise.
 */
export class SectionModal implements SectionSurface {
    private readonly overlay = new OverlayShell();
    private dialog: SectionDialog | null = null;
    private field!: SectionField;
    private issues!: IssueBoard<SectionFieldName>;
    private actions!: FormActions;

    constructor(
        private readonly app: App,
        private readonly opts: SectionModalOptions,
    ) { }

    open(): void {
        if (this.overlay.isOpen()) return;
        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog tv-section',
            keymap: this.app.keymap,
            initialFocus: () => this.field?.input(this.opts.initial.note.picked === null ? 'note' : 'heading') ?? null,
            build: (bodyEl) => this.build(bodyEl),
            onClose: () => {
                this.dialog?.dispose();
                this.dialog = null;
            },
        });
    }

    private build(bodyEl: HTMLElement): void {
        const adding = this.opts.purpose === 'add';
        bodyEl.addClass('tv-form');
        bodyEl.createEl('h2', { text: t(adding ? 'modal.section.addTitle' : 'modal.section.relinkTitle'), cls: 'tv-form__title' });

        const group = bodyEl.createDiv({ cls: 'tv-form__group' });
        this.field = new SectionField(this.app, group, {
            initial: this.opts.initial,
            noteChanged: () => this.dialog?.noteChanged(this.field.ask().note),
            headingChanged: () => this.dialog?.headingChanged(this.field.heading()),
            onEnter: () => this.dialog?.choose(),
        });

        const formSays = bodyEl.createDiv({ cls: 'tv-form__says tv-form__says--form' });
        this.issues = new IssueBoard<SectionFieldName>({
            field: (at) => this.field.slot(at),
            form: formSays,
        });

        this.actions = new FormActions(bodyEl, {
            cancel: { run: () => { void this.overlay.requestClose(); } },
            actions: [{ label: t(adding ? 'modal.section.add' : 'modal.section.relink'), tone: 'cta', run: () => this.dialog?.choose() }],
        });

        this.dialog = new SectionDialog(this.opts.initial, {
            note: (ask) => readSectionNote(this.app, ask),
            chosen: (link) => this.opts.chosen(link),
            close: () => this.overlay.close(),
        }, this);
    }

    render(state: SectionViewState): void {
        this.field.offer(state.path, state.choices);
        this.issues.set('dialog', state.issues);
        this.actions.render({ busy: false, ctaEnabled: state.canChoose });
    }
}
