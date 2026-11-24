import type { App } from 'obsidian';
import { t } from '../../i18n';
import { NoteName } from '../../services/data/NoteName';
import type { DestinationAsk, NoteDestination, NotePlaces } from '../../services/data/NotePlaces';
import { OverlayShell, type OverlayFrame } from '../../views/sharedUI/OverlayShell';
import type { AskShell } from '../ask/Ask';
import { FormActions } from '../form/FormActions';
import { IssueBoard } from '../form/FormIssue';
import { DestinationField } from '../noteops/DestinationField';
import { PlaceDialog, type PlaceField, type PlaceSurface, type PlaceViewState } from './PlaceDialog';

/** What the place dialog is opened for, and what it opens with. */
export interface PlaceOptions {
    /** The fields as they open: the note, and the heading (empty for the note's end). */
    initial: DestinationAsk;
    /**
     * What it is opened for, which the title and the button say: a task to
     * make, the hub of which comes next (`create`: the hub's own title, and
     * next), or the hub of a task to make moving it (`move`: change).
     */
    purpose: 'create' | 'move';
    /**
     * The note a new note's folder is reckoned from, when a name alone is
     * typed (`NoteName.defaultFolder`, by Obsidian's setting of where new
     * notes go); '' when there is none.
     */
    folderFrom: string;
}

/**
 * The place dialog as it looks: the note and the heading
 * (`DestinationField`, the send dialog's fields), what each names said
 * under it (`IssueBoard`), and cancel and the button that places. It draws
 * what the dialog's state says (`PlaceViewState`) and does nothing of its
 * own; the dialog's logic is `PlaceDialog`.
 *
 * It is built of the form's shared pieces (`_form.css`), as the send
 * dialog is, and stands on an overlay (`OverlayShell`, centered): the title
 * in its head, the row of buttons in its foot. It opens with the focus on
 * the note field, the caret after its text, a note's name having no fixed
 * shape and being mended as often as replaced. Opened over another overlay (the hub of a task to
 * make), it stands above it, and Escape and a press outside are its own
 * (`LayerOrder`).
 */
export class PlaceModal implements PlaceSurface {
    private dialog: PlaceDialog | null = null;
    private field!: DestinationField;
    private issues!: IssueBoard<PlaceField>;
    private actions!: FormActions;
    private chosen: NoteDestination | null = null;

    /**
     * Open the dialog, and answer once it has closed: the place chosen, or
     * null for a close of any other kind (cancel, the close button, Escape,
     * the back, a click outside, a swipe). It asks nothing before a close.
     * It stands on `overlay`, a new one unless given.
     */
    static pick(app: App, places: Pick<NotePlaces, 'readFields'>, opts: PlaceOptions, overlay: AskShell = new OverlayShell()): Promise<NoteDestination | null> {
        return new Promise((resolve) => new PlaceModal(overlay, app, places, opts, resolve).open());
    }

    private constructor(
        private readonly overlay: AskShell,
        private readonly app: App,
        private readonly places: Pick<NotePlaces, 'readFields'>,
        private readonly opts: PlaceOptions,
        private readonly answer: (to: NoteDestination | null) => void,
    ) { }

    private open(): void {
        this.overlay.open({
            mode: 'centered',
            panelClass: 'tv-overlay__panel--dialog',
            keymap: this.app.keymap,
            initialFocus: () => (this.field ? this.field.focus('note') : null),
            build: (bodyEl, frame) => this.build(bodyEl, frame),
            onClose: () => {
                this.dialog?.dispose();
                this.dialog = null;
                this.answer(this.chosen);
            },
        });
    }

    private build(bodyEl: HTMLElement, frame: OverlayFrame): void {
        const creating = this.opts.purpose === 'create';
        bodyEl.addClass('tv-form');
        frame.head.createEl('h2', { text: creating ? t('modal.newTask.title') : t('modal.place.moveTitle'), cls: 'tv-form__title' });

        const group = bodyEl.createDiv({ cls: 'tv-form__group' });
        this.field = new DestinationField(this.app, group, {
            initial: this.opts.initial,
            onChange: () => this.dialog?.fieldsChanged(this.field.ask()),
            onEnter: () => this.dialog?.enter(),
        });

        const formSays = bodyEl.createDiv({ cls: 'tv-form__says tv-form__says--form' });
        this.issues = new IssueBoard<PlaceField>({
            field: (at) => this.field.slot(at),
            form: formSays,
        });

        this.actions = new FormActions(frame.foot, {
            cancel: { run: () => { void this.overlay.requestClose(); } },
            actions: [{ label: creating ? t('modal.place.next') : t('modal.place.move'), tone: 'cta', run: () => this.dialog?.choose() }],
        });

        // What the fields show as they open, not the options they were built
        // from: the logic asks of what the user sees, by construction.
        this.dialog = new PlaceDialog(this.field.ask(), {
            read: (ask) => this.places.readFields(ask, NoteName.defaultFolder(this.app, this.opts.folderFrom)),
            placed: (to) => {
                this.chosen = to;
                this.overlay.close();
            },
        }, this);
    }

    render(state: PlaceViewState): void {
        this.field.offerHeadings(state.headings);
        this.issues.set('dialog', state.issues);
        this.actions.render({ busy: false, ctaEnabled: state.canPlace });
    }
}
