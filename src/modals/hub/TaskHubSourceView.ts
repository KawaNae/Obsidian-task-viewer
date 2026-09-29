import { Notice, type App } from 'obsidian';
import { t } from '../../i18n';
import type { SubtreeFrame } from '../../services/persistence/utils/SubtreeFrame';
import { SourceEditor } from '../form/source/SourceEditor';
import type { DraftEditor, SourceSurface, SourceViewState } from './TaskHubSource';

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
 * source above them, and, in the source, the editor with apply and cancel
 * under it, why the last apply wrote nothing, the question whether to throw
 * the draft away, and what is left once the row is lost. It draws what the
 * mode's state says (`SourceViewState`) and does nothing of its own.
 */
export class TaskHubSourceView implements SourceSurface {
    private readonly viewBtn: HTMLButtonElement;
    private readonly sourceBtn: HTMLButtonElement;
    private readonly shutEl: HTMLElement;
    private readonly pane: HTMLElement;
    private readonly editorHost: HTMLElement;
    private readonly messageEl: HTMLElement;
    private readonly askEl: HTMLElement;
    private readonly lostEl: HTMLElement;
    private readonly actionsEl: HTMLElement;
    private readonly applyBtn: HTMLButtonElement;
    private readonly cancelBtn: HTMLButtonElement;
    private readonly keepBtn: HTMLButtonElement;
    private wasAsking = false;

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

        this.askEl = this.pane.createDiv({ cls: 'task-hub__source-ask' });
        this.askEl.createSpan({ text: t('modal.hub.source.discardAsk') });
        const discardBtn = this.askEl.createEl('button', { cls: 'mod-warning', text: t('modal.hub.source.discard'), attr: { type: 'button' } });
        discardBtn.addEventListener('click', () => actions.discard());
        this.keepBtn = this.askEl.createEl('button', { text: t('modal.hub.source.keep'), attr: { type: 'button' } });
        this.keepBtn.addEventListener('click', () => actions.keep());

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
        this.cancelBtn = this.actionsEl.createEl('button', { text: t('modal.cancel'), attr: { type: 'button' } });
        this.cancelBtn.addEventListener('click', () => actions.cancel());
        this.applyBtn = this.actionsEl.createEl('button', { cls: 'mod-cta', text: t('modal.hub.source.apply'), attr: { type: 'button' } });
        this.applyBtn.addEventListener('click', () => actions.apply());
    }

    openEditor(frame: SubtreeFrame, hooks: { submit(): void }): DraftEditor {
        return new SourceEditor(this.editorHost, {
            parent: frame.parent,
            children: frame.children,
            indentUnit: frame.unit,
            app: this.app,
            onSubmit: hooks.submit,
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
        this.askEl.toggle(open && state.asking);
        this.lostEl.toggle(open && state.lost && !state.asking);
        this.actionsEl.toggle(open && !state.lost && !state.asking);
        this.applyBtn.disabled = state.phase !== 'source';
        this.applyBtn.setText(state.phase === 'applying' ? t('modal.hub.source.applying') : t('modal.hub.source.apply'));
        this.cancelBtn.disabled = state.phase !== 'source';
        // Asked: the safe answer takes the focus, so a stray Enter keeps the draft.
        if (state.asking && !this.wasAsking) this.keepBtn.focus();
        this.wasAsking = state.asking;
    }
}
