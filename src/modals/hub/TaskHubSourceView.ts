import { Notice, setIcon, type App } from 'obsidian';
import { t } from '../../i18n';
import type { SubtreeFrame } from '../../services/persistence/utils/SubtreeFrame';
import { editorOn, type DraftEditor, type EditorOnHooks } from '../form/source/SourceEditor';
import { FormActions } from '../form/FormActions';
import { IssueBoard } from '../form/FormIssue';
import type { SourceSurface, SourceViewState } from './TaskHubSource';
import type { SourceSlots } from './TaskHubPanel';

/**
 * What the view's controls do: the switch's (`TaskHubSource`), and those of
 * the seat whose row of buttons and lost row's discard the view draws
 * (`SourceApply`), shown only while the seat's answer says so (`SeatView`).
 */
export interface SourceViewActions {
    enter(): void;
    /** The switch back to the card. */
    back(): void;
    /** The draft as the file's lines, to copy; null when none is open. */
    draftText(): string | null;
    /** The seat's row: cancel, apply, and the answers of its question. */
    cancel(): void;
    apply(): void;
    discard(): void;
    keep(): void;
}

/**
 * The hub's source mode as it looks: the switch between the form and the
 * source on the title's line, why the source cannot open above the card,
 * and, in the source, the editor with one row of controls under it, why the
 * last apply wrote nothing, and what is left once the row is lost. It draws
 * what the switch's state and its seat's answer say (`SourceViewState`,
 * `SeatView`) and does nothing of its own.
 *
 * The switch is two icon buttons, the one shown marked active: the form by
 * the pencil and the source by the code icon, the icons Obsidian's status bar
 * tells Live Preview and the source mode by. Their names are their labels
 * and tooltips (`aria-label`). Why the source cannot open is the source
 * button's tooltip, and a line of its own above the card while there is a
 * reason: the line takes no room otherwise.
 *
 * The row of controls is cancel and apply at its end (`FormActions`), which
 * asks whether to throw the draft away as every form's row does, shown while
 * the seat has a row (`SeatView.foot`). It stands in the overlay's foot
 * (`OverlayFrame`), after the form's row, which shows on a row only while it
 * asks.
 */
export class TaskHubSourceView implements SourceSurface {
    private readonly viewBtn: HTMLButtonElement;
    private readonly sourceBtn: HTMLButtonElement;
    private readonly shutEl: HTMLElement;
    private readonly pane: HTMLElement;
    private readonly editorHost: HTMLElement;
    private readonly messageEl: HTMLElement;
    /** Why the last apply wrote nothing, said under the editor. */
    private readonly issues: IssueBoard<never>;
    private readonly lostEl: HTMLElement;
    private readonly lostDiscardBtn: HTMLButtonElement;
    /** Where the row of controls stands, in the overlay's foot: hidden while the card shows. */
    private readonly actionsHost: HTMLElement;
    private readonly actions: FormActions;

    private readonly card: HTMLElement;

    /** Built in the panel's slots (`SourceSlots`): the switch, why it cannot open, the card, the source's place and the foot. */
    constructor(
        private readonly app: App,
        slots: Pick<SourceSlots, 'toggle' | 'shut' | 'card' | 'pane' | 'foot'>,
        actions: SourceViewActions,
    ) {
        const { toggle, card, pane: paneHost, foot } = slots;
        this.card = card;
        this.shutEl = slots.shut;
        this.shutEl.addClass('task-hub__mode-shut');
        toggle.addClass('task-hub__mode-toggle', 'tv-ctrl__segments');
        this.viewBtn = modeButton(toggle, 'edit-3', t('modal.hub.source.view'));
        this.sourceBtn = modeButton(toggle, 'code-2', t('modal.hub.source.source'));
        this.viewBtn.addEventListener('click', () => actions.back());
        this.sourceBtn.addEventListener('click', () => actions.enter());

        this.pane = paneHost;
        this.pane.addClass('task-hub__source-pane');
        this.editorHost = this.pane.createDiv({ cls: 'task-hub__source-editor' });
        this.messageEl = this.pane.createDiv({ cls: 'task-hub__source-message tv-form__says' });
        this.issues = new IssueBoard<never>({ field: () => null, form: this.messageEl });

        this.lostEl = this.pane.createDiv({ cls: 'task-hub__source-lost' });
        this.lostEl.createSpan({ text: t('modal.hub.source.lost') });
        const copyBtn = this.lostEl.createEl('button', { text: t('modal.hub.source.copy'), attr: { type: 'button' } });
        copyBtn.addEventListener('click', () => {
            const text = actions.draftText();
            if (text === null) return;
            void navigator.clipboard.writeText(text).then(
                () => new Notice(t('modal.hub.source.copied')),
                () => new Notice(t('modal.hub.source.copyFailed')),
            );
        });
        this.lostDiscardBtn = this.lostEl.createEl('button', { cls: 'mod-warning', text: t('modal.draft.discard'), attr: { type: 'button' } });
        this.lostDiscardBtn.addEventListener('click', () => actions.discard());

        this.actionsHost = foot.createDiv({ cls: 'task-hub__source-actions' });
        this.actions = new FormActions(this.actionsHost, {
            cancel: { run: () => actions.cancel() },
            actions: [{ label: t('modal.hub.source.apply'), busyLabel: t('modal.hub.source.applying'), tone: 'cta', run: () => actions.apply() }],
            ask: { discardLabel: t('modal.draft.discard'), keepLabel: t('modal.draft.keep'), discard: () => actions.discard(), keep: () => actions.keep() },
        });
    }

    openEditor(frame: SubtreeFrame, hooks: EditorOnHooks): DraftEditor {
        return editorOn(this.editorHost, frame, this.app, hooks);
    }

    render(state: SourceViewState): void {
        const seat = state.seat;
        const open = seat !== null;
        const busy = seat?.busy ?? false;
        const asking = seat?.asking ?? false;
        this.viewBtn.toggleClass('is-active', !open);
        this.sourceBtn.toggleClass('is-active', open);
        this.viewBtn.disabled = busy || asking;
        this.sourceBtn.disabled = state.phase !== 'view' || state.shut !== null || state.held;
        this.sourceBtn.title = state.shut ?? '';
        this.shutEl.setText(state.shut ?? '');
        this.shutEl.toggle(state.shut !== null);

        this.card.toggle(!open);
        this.pane.toggle(open);
        this.issues.set('apply', state.issues);
        this.messageEl.toggle(open);
        this.pane.toggleClass('tv-source-drafts--asking', asking);
        this.lostEl.toggle(seat?.lost != null);
        this.lostDiscardBtn.toggle(seat?.lost?.discard ?? false);
        this.actions.render({
            busy,
            ctaEnabled: open && !busy,
            ask: asking ? t('modal.draft.discardAsk') : null,
        });
        this.actions.cancelButton.disabled = !asking && (!open || busy);
        // Asked, the apply stays offered: applying withdraws the question.
        this.actions.showAct(seat?.foot?.act ?? false);
        // Hidden by its attribute, which the overlay's foot reads to show or not (`OverlayFrame`).
        this.actionsHost.hidden = !seat?.foot;
    }

    /** Asked, first or again: back takes the focus, where cancel was. */
    asked(): void {
        this.actions.focusKeep();
    }
}

/** A button of the switch: its icon, and its label as its name and tooltip. */
function modeButton(toggle: HTMLElement, icon: string, label: string): HTMLButtonElement {
    const btn = toggle.createEl('button', { cls: 'task-hub__mode-button', attr: { type: 'button', 'aria-label': label } });
    setIcon(btn, icon);
    return btn;
}
