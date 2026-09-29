import { Notice, type App } from 'obsidian';
import { t } from '../../i18n';
import type { SubtreeFrame } from '../../services/persistence/utils/SubtreeFrame';
import { SourceEditor, type DraftEditor } from '../form/source/SourceEditor';
import type { SourceSurface, SourceViewState } from './TaskHubSource';

/** What the view's controls do: the source mode's operations (`TaskHubSource`). */
export interface SourceViewActions {
    enter(): void;
    apply(): void;
    cancel(): void;
    discard(): void;
    keep(): void;
    /** The draft as the file's lines, to copy; null when none is open. */
    draftText(): string | null;
}

/**
 * The hub's source mode as it looks: the switch between the card and the
 * source above them, and, in the source, the editor with one row of controls
 * under it, why the last apply wrote nothing, and what is left once the row
 * is lost. It draws what the mode's state says (`SourceViewState`) and does
 * nothing of its own.
 *
 * The row of controls is cancel and apply at its end. Asked whether to throw
 * the draft away, the same row asks: the question comes in at its start,
 * discard beside it, and cancel reads back, which keeps the draft. Discard
 * stands apart from the buttons a hand goes to, so a slip of the hand keeps
 * the draft; apply stays offered, since applying withdraws the question.
 */
export class TaskHubSourceView implements SourceSurface {
    private readonly viewBtn: HTMLButtonElement;
    private readonly sourceBtn: HTMLButtonElement;
    private readonly shutEl: HTMLElement;
    private readonly pane: HTMLElement;
    private readonly editorHost: HTMLElement;
    private readonly messageEl: HTMLElement;
    private readonly lostEl: HTMLElement;
    private readonly actionsEl: HTMLElement;
    private readonly discardBtn: HTMLButtonElement;
    private readonly askEl: HTMLElement;
    private readonly cancelBtn: HTMLButtonElement;
    private readonly applyBtn: HTMLButtonElement;
    /** Asked as last drawn: the cancel button is back then. */
    private asking = false;

    /**
     * @param bar where the switch goes, above the card
     * @param card the card's element, hidden while the source is open
     * @param paneHost where the source goes, in the card's place
     */
    constructor(
        private readonly app: App,
        bar: HTMLElement,
        private readonly card: HTMLElement,
        paneHost: HTMLElement,
        actions: SourceViewActions,
    ) {
        bar.addClass('task-hub__mode-bar');
        const toggle = bar.createDiv({ cls: 'task-hub__mode-toggle' });
        this.viewBtn = toggle.createEl('button', { text: t('modal.hub.source.view'), attr: { type: 'button' } });
        this.sourceBtn = toggle.createEl('button', { text: t('modal.hub.source.source'), attr: { type: 'button' } });
        this.shutEl = bar.createSpan({ cls: 'task-hub__mode-shut' });
        this.viewBtn.addEventListener('click', () => actions.cancel());
        this.sourceBtn.addEventListener('click', () => actions.enter());

        this.pane = paneHost;
        this.pane.addClass('task-hub__source-pane');
        this.editorHost = this.pane.createDiv({ cls: 'task-hub__source-editor' });
        this.messageEl = this.pane.createDiv({ cls: 'task-hub__source-message' });

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
        const lostDiscardBtn = this.lostEl.createEl('button', { cls: 'mod-warning', text: t('modal.hub.source.discard'), attr: { type: 'button' } });
        lostDiscardBtn.addEventListener('click', () => actions.discard());

        this.actionsEl = this.pane.createDiv({ cls: 'task-hub__source-actions' });
        this.askEl = this.actionsEl.createSpan({ cls: 'task-hub__source-ask', text: t('modal.hub.source.discardAsk') });
        this.discardBtn = this.actionsEl.createEl('button', { cls: 'mod-warning task-hub__source-discard', text: t('modal.hub.source.discard'), attr: { type: 'button' } });
        this.discardBtn.addEventListener('click', () => actions.discard());
        this.cancelBtn = this.actionsEl.createEl('button', { cls: 'task-hub__source-cancel', attr: { type: 'button' } });
        this.cancelBtn.addEventListener('click', () => (this.asking ? actions.keep() : actions.cancel()));
        this.applyBtn = this.actionsEl.createEl('button', { cls: 'mod-cta', text: t('modal.hub.source.apply'), attr: { type: 'button' } });
        this.applyBtn.addEventListener('click', () => actions.apply());
    }

    openEditor(frame: SubtreeFrame, hooks: { submit(): void; edited(): void }): DraftEditor {
        return new SourceEditor(this.editorHost, {
            parent: frame.parent,
            children: frame.children,
            indentUnit: frame.unit,
            app: this.app,
            onSubmit: hooks.submit,
            onChange: hooks.edited,
        });
    }

    render(state: SourceViewState): void {
        const open = state.phase === 'source' || state.phase === 'applying';
        this.viewBtn.toggleClass('is-active', !open);
        this.sourceBtn.toggleClass('is-active', open);
        this.viewBtn.disabled = state.phase === 'applying' || state.asking;
        this.sourceBtn.disabled = state.phase !== 'view' || state.shut !== null;
        this.sourceBtn.title = state.shut ?? '';
        this.shutEl.setText(state.shut ?? '');
        this.shutEl.toggle(state.shut !== null);

        this.card.toggle(!open);
        this.pane.toggle(open);
        this.messageEl.setText(state.message ?? '');
        this.messageEl.toggle(open && state.message !== null);
        const asking = open && state.asking;
        this.pane.toggleClass('task-hub__source-pane--asking', asking);
        this.lostEl.toggle(open && state.lost && !asking);
        // A lost row has its own way out; asked there, the row asks as anywhere.
        this.actionsEl.toggle(open && (!state.lost || asking));
        this.discardBtn.toggle(asking);
        this.askEl.toggle(asking);
        this.cancelBtn.setText(asking ? t('modal.hub.source.keep') : t('modal.cancel'));
        this.cancelBtn.disabled = !asking && state.phase !== 'source';
        // Asked, the apply stays offered: applying withdraws the question.
        this.applyBtn.toggle(!state.lost);
        this.applyBtn.disabled = state.phase !== 'source';
        this.applyBtn.setText(state.phase === 'applying' ? t('modal.hub.source.applying') : t('modal.hub.source.apply'));
        this.asking = asking;
    }

    /** Asked, first or again: back takes the focus, where cancel was. */
    asked(): void {
        this.cancelBtn.focus();
    }
}
