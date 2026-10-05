import { t } from '../../i18n';

/** A button of a form's row besides cancel: an answer, or the form's own act. */
export interface FormAction {
    label: string;
    /** `'cta'` is the act the form is for; `'warning'` one that loses something. */
    tone?: 'cta' | 'warning';
    /** What the act reads while busy (its write under way). */
    busyLabel?: string;
    run(): void;
}

/**
 * How the row asks whether to throw away what a step would lose
 * (`DraftGuard`): the question at the row's start, the answer that throws it
 * away beside it, and cancel reading as the answer that keeps it.
 */
export interface FormAsk {
    discardLabel: string;
    keepLabel: string;
    discard(): void;
    keep(): void;
}

/**
 * The row of buttons that ends a form (`tv-form__buttons`): cancel first,
 * then the form's answers or its act, at the end of the line, the one the
 * hand goes to last.
 *
 * Asked whether to throw something away (`FormAsk`), the same row asks: the
 * question comes in at its start, discard beside it, and cancel reads back,
 * which keeps what would be lost. Discard stands apart from the buttons a
 * hand goes to, so a slip of the hand keeps it; the act stays offered, since
 * acting withdraws the question. A row with no cancel of its own (the hub's
 * form, which saves as it goes) shows only while it asks.
 */
export class FormActions {
    /** Cancel, or back while asking: what the focus goes to as a question is put. */
    readonly cancelButton: HTMLButtonElement;
    private readonly row: HTMLElement;
    private readonly askEl: HTMLElement | null;
    private readonly discardButton: HTMLButtonElement | null;
    private readonly buttons: readonly { el: HTMLButtonElement; spec: FormAction }[];
    /** Whether cancel reads back, as the question last drawn says: what a press of it does. */
    private readsBack = false;

    constructor(container: HTMLElement, private readonly spec: {
        cancel?: { label?: string; run(): void };
        actions: readonly FormAction[];
        ask?: FormAsk;
    }) {
        this.row = container.createDiv({ cls: 'tv-form__buttons' });
        const ask = spec.ask;
        this.askEl = ask ? this.row.createSpan({ cls: 'tv-form__ask' }) : null;
        this.discardButton = ask ? button(this.row, ask.discardLabel, 'warning', () => ask.discard()) : null;
        this.discardButton?.addClass('tv-form__discard');
        this.cancelButton = button(this.row, this.cancelLabel(), undefined, () => {
            if (this.readsBack) ask?.keep();
            else spec.cancel?.run();
        });
        this.cancelButton.addClass('tv-form__cancel');
        this.buttons = spec.actions.map(one => ({ el: button(this.row, one.label, one.tone, one.run), spec: one }));
        this.render({ busy: false });
    }

    /**
     * While busy (an answer being written), the answers do not act again, and
     * the act reads its busy label. Cancel stays: the close it asks for waits
     * on what is under way. The form's act (`'cta'`) is offered only while
     * `ctaEnabled` (what the form holds can be acted on: a value that reads).
     * `ask` is the question put now, null while none is.
     */
    render(state: { busy: boolean; ctaEnabled?: boolean; ask?: string | null }): void {
        const question = this.spec.ask ? state.ask ?? null : null;
        this.readsBack = question !== null;
        this.askEl?.setText(question ?? '');
        this.askEl?.toggle(this.readsBack);
        this.discardButton?.toggle(this.readsBack);
        this.cancelButton.setText(this.cancelLabel());
        this.cancelButton.toggle(this.readsBack || this.spec.cancel !== undefined);
        for (const { el, spec } of this.buttons) {
            el.disabled = state.busy || (spec.tone === 'cta' && state.ctaEnabled === false);
            el.setText(state.busy && spec.busyLabel ? spec.busyLabel : spec.label);
        }
        this.row.toggle(this.readsBack || this.spec.cancel !== undefined || this.buttons.length > 0);
    }

    /** The question was put, first or again: the answer that keeps takes the focus. */
    focusKeep(): void {
        this.cancelButton.focus();
    }

    /** The form's act (`'cta'`), shown or not: a form that cannot act now has no act to offer. */
    showAct(shown: boolean): void {
        for (const { el, spec } of this.buttons) if (spec.tone === 'cta') el.toggle(shown);
    }

    private cancelLabel(): string {
        return this.readsBack && this.spec.ask ? this.spec.ask.keepLabel : this.spec.cancel?.label ?? t('modal.cancel');
    }
}

function button(row: HTMLElement, label: string, tone: FormAction['tone'], run: () => void): HTMLButtonElement {
    const cls = tone === 'cta' ? 'mod-cta' : tone === 'warning' ? 'mod-warning' : undefined;
    const el = row.createEl('button', { text: label, attr: { type: 'button' }, ...(cls ? { cls } : {}) });
    el.addEventListener('click', run);
    return el;
}
