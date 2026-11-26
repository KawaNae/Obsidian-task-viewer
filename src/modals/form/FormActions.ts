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
 * question comes in at its start, on a line of its own, discard at the
 * start of the line under it, and cancel reads back, which keeps what would
 * be lost. Discard stands apart from the buttons a
 * hand goes to, so a slip of the hand keeps it; the act stays offered, since
 * acting withdraws the question. A row with no cancel of its own (the hub
 * on a row, which saves as it goes) shows only while it asks.
 *
 * A form may put a control of its own at the row's start (`lead`), apart
 * from the buttons at its end. It steps aside while the row asks: the
 * question takes the start, and a line to itself.
 *
 * A form whose act comes and goes as it stands (the hub, holding something
 * not written yet or not) says at each draw whether the row offers its
 * lead, cancel and acts (`offered`), and what its act reads (`act`). Not
 * offered, the row is as one built with none: the lead and the acts are
 * taken out of it, cancel is hidden, and it shows only while it asks.
 */
export class FormActions {
    /** Cancel, or back while asking: what the focus goes to as a question is put. */
    readonly cancelButton: HTMLButtonElement;
    private readonly row: HTMLElement;
    private readonly leadEl: HTMLElement | null;
    private readonly askEl: HTMLElement | null;
    private readonly discardButton: HTMLButtonElement | null;
    private readonly buttons: readonly { el: HTMLButtonElement; spec: FormAction }[];
    /** Whether cancel reads back, as the question last drawn says: what a press of it does. */
    private readsBack = false;
    /** What the answer that keeps reads for the question last drawn; the ask's own label when it gave none. */
    private keepLabel: string | null = null;
    /** Whether the lead, cancel and the acts are offered, as the last draw said: the lead and the acts are in the row only then. */
    private offered = true;

    constructor(container: HTMLElement, private readonly spec: {
        cancel?: { label?: string; run(): void };
        actions: readonly FormAction[];
        ask?: FormAsk;
        /** Put the control at the row's start in the row given, and hand it back. */
        lead?: (row: HTMLElement) => HTMLElement;
    }) {
        this.row = container.createDiv({ cls: 'tv-form__buttons' });
        this.leadEl = spec.lead?.(this.row) ?? null;
        this.leadEl?.addClass('tv-form__lead');
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
     * `ask` is the question put now, null while none is; `keep` what its
     * answer that keeps reads, when it is not the ask's `keepLabel`.
     * `offered` false takes the lead and the acts out of the row and hides
     * cancel (the question and its answers stay); none, they are offered. `act` is what the form's act
     * reads now, and while busy, in place of what it was built with.
     */
    render(state: {
        busy: boolean;
        ctaEnabled?: boolean;
        ask?: string | null;
        keep?: string;
        offered?: boolean;
        act?: { label: string; busyLabel?: string };
    }): void {
        const question = this.spec.ask ? state.ask ?? null : null;
        const offered = state.offered ?? true;
        if (offered !== this.offered) this.offer(offered);
        this.readsBack = question !== null;
        this.keepLabel = state.keep ?? null;
        this.askEl?.setText(question ?? '');
        this.leadEl?.toggle(!this.readsBack);
        this.askEl?.toggle(this.readsBack);
        this.discardButton?.toggle(this.readsBack);
        this.cancelButton.setText(this.cancelLabel());
        const cancels = offered && this.spec.cancel !== undefined;
        this.cancelButton.toggle(this.readsBack || cancels);
        for (const { el, spec } of this.buttons) {
            const act = spec.tone === 'cta' ? state.act ?? spec : spec;
            el.disabled = state.busy || (spec.tone === 'cta' && state.ctaEnabled === false);
            el.setText(state.busy && act.busyLabel ? act.busyLabel : act.label);
        }
        // Hidden by its attribute, which the overlay's foot reads to show or not (`OverlayFrame`).
        this.row.hidden = !(this.readsBack || cancels || (offered && this.buttons.length > 0));
    }

    /** The question was put, first or again: the answer that keeps takes the focus. */
    focusKeep(): void {
        this.cancelButton.focus();
    }

    /** The form's act (`'cta'`) takes the focus: what the form can do now, with no field to put it on. */
    focusAct(): void {
        this.buttons.find(({ spec }) => spec.tone === 'cta')?.el.focus();
    }

    /** The form's act (`'cta'`), shown or not: a form that cannot act now has no act to offer. */
    showAct(shown: boolean): void {
        for (const { el, spec } of this.buttons) if (spec.tone === 'cta') el.toggle(shown);
    }

    /** Put the lead back at the row's start and the acts at its end, or take them out of it. */
    private offer(offered: boolean): void {
        this.offered = offered;
        const lead = this.leadEl;
        if (offered) {
            if (lead) this.row.insertBefore(lead, this.row.children[0] ?? null);
            for (const { el } of this.buttons) this.row.appendChild(el);
            return;
        }
        if (lead) this.row.removeChild(lead);
        for (const { el } of this.buttons) this.row.removeChild(el);
    }

    private cancelLabel(): string {
        return this.readsBack && this.spec.ask ? this.keepLabel ?? this.spec.ask.keepLabel : this.spec.cancel?.label ?? t('modal.cancel');
    }
}

function button(row: HTMLElement, label: string, tone: FormAction['tone'], run: () => void): HTMLButtonElement {
    const cls = tone === 'cta' ? 'mod-cta' : tone === 'warning' ? 'mod-warning' : undefined;
    const el = row.createEl('button', { text: label, attr: { type: 'button' }, ...(cls ? { cls } : {}) });
    el.addEventListener('click', run);
    return el;
}
