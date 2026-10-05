import type { App } from 'obsidian';
import type { FieldCodec } from '../../utils/values/Read';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { FormActions } from '../form/FormActions';
import { onFormEnter } from '../form/formEnter';
import { createFormRow } from '../form/formRow';
import { IssueBoard, readIssue, type FormIssue } from '../form/FormIssue';
import { ask } from './Ask';

export interface TextSpec<T> {
    title: string;
    label: string;
    /** The field's first text, selected so that what is typed replaces it. */
    initial: string;
    /** How the text reads (a codec of `utils/values`). */
    codec: FieldCodec<T>;
    submitLabel: string;
    /** A keyboard of digits on a phone, for a number. */
    numeric?: boolean;
    /**
     * Act on the value read, and answer when done: null to close, or what
     * keeps it from going, of the value or of the form (a write refused),
     * said with the dialog left open. What is written is written here,
     * waited for (I#9).
     */
    submit(value: T): Promise<FormIssue<'value'> | null>;
}

/**
 * Ask for one value, in a dialog of a field. The focus opens on the field,
 * its text selected. The form's Enter (`onFormEnter`) or the submit button
 * reads the text: what does not read is said under the field, the field
 * marked, and the dialog stays open (入力の論点 E). A value read is handed
 * to `submit`, waited for, and the dialog closes once it has gone; what
 * keeps it from going is said under the field, or above the buttons.
 * Typing again takes back what was said.
 *
 * A close asked for while `submit` runs waits on it: it closes with the
 * dialog if the value went, and stays to say why if it did not.
 *
 * @returns when the dialog has closed, however
 */
export async function askText<T>(app: App, spec: TextSpec<T>): Promise<void> {
    await ask<'done'>(new OverlayShell(), {
        keymap: app.keymap,
        draw: (bodyEl, hands) => {
            bodyEl.addClass('tv-form');
            bodyEl.createEl('h2', { text: spec.title, cls: 'tv-form__title' });

            const group = bodyEl.createDiv({ cls: 'tv-form__group' });
            const { row, says } = createFormRow(group, spec.label);
            const input = row.createEl('input', {
                type: 'text',
                cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control',
                value: spec.initial,
            });
            if (spec.numeric) input.inputMode = 'numeric';
            const formSays = bodyEl.createDiv({ cls: 'tv-form__says tv-form__says--form' });
            const issues = new IssueBoard<'value'>({ field: () => ({ input, message: says }), form: formSays });
            input.addEventListener('input', () => issues.set('submit', []));

            /** The submit under way, answering what keeps it from going (null: it went). */
            let pending: Promise<FormIssue<'value'> | null> | null = null;
            const submit = async () => {
                if (pending) return;
                const read = spec.codec.read(input.value);
                if (!read.ok) {
                    issues.set('submit', readIssue('value', read.issue));
                    return;
                }
                pending = spec.submit(read.value);
                actions.render({ busy: true });
                try {
                    const why = await pending;
                    if (why === null) hands.answer('done');
                    else issues.set('submit', [why]);
                } finally {
                    pending = null;
                    actions.render({ busy: false });
                }
            };

            onFormEnter(input, () => { void submit(); });
            const actions = new FormActions(bodyEl, {
                cancel: { run: hands.cancel },
                actions: [{ label: spec.submitLabel, tone: 'cta', run: () => { void submit(); } }],
            });
            return {
                focus: input,
                beforeClose: () => pending
                    ? pending.then((why): 'close' | 'stay' => (why === null ? 'close' : 'stay'))
                    : 'close',
            };
        },
    });
}
