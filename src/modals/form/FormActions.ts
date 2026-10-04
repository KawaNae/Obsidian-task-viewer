import { t } from '../../i18n';

/** A button of a form's row besides cancel: an answer, or the form's own act. */
export interface FormAction {
    label: string;
    /** `'cta'` is the act the form is for; `'warning'` one that loses something. */
    tone?: 'cta' | 'warning';
    run(): void;
}

/**
 * The row of buttons that ends a form (`tv-form__buttons`): cancel first,
 * then the form's answers or its act, at the end of the line, the one the
 * hand goes to last.
 */
export class FormActions {
    readonly cancelButton: HTMLButtonElement;
    private readonly buttons: readonly HTMLButtonElement[];

    constructor(container: HTMLElement, spec: {
        cancel: { label?: string; run(): void };
        actions: readonly FormAction[];
    }) {
        const row = container.createDiv({ cls: 'tv-form__buttons' });
        this.cancelButton = button(row, spec.cancel.label ?? t('modal.cancel'), undefined, spec.cancel.run);
        this.buttons = spec.actions.map(one => button(row, one.label, one.tone, one.run));
    }

    /**
     * While busy (an answer being written), the answers do not act again.
     * Cancel stays: the close it asks for waits on what is under way.
     */
    render(state: { busy: boolean }): void {
        for (const one of this.buttons) one.disabled = state.busy;
    }
}

function button(row: HTMLElement, label: string, tone: FormAction['tone'], run: () => void): HTMLButtonElement {
    const cls = tone === 'cta' ? 'mod-cta' : tone === 'warning' ? 'mod-warning' : undefined;
    const el = row.createEl('button', { text: label, attr: { type: 'button' }, ...(cls ? { cls } : {}) });
    el.addEventListener('click', run);
    return el;
}
