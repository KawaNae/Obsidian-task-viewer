import type { App } from 'obsidian';
import type { Read } from '../../utils/values/Read';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { FormActions } from '../form/FormActions';
import { onFormEnter } from '../form/formEnter';
import { createFormRow } from '../form/formRow';
import { issueWords } from '../form/issueWords';
import { ask } from './Ask';

export interface TextSpec<T> {
    title: string;
    label: string;
    /** The field's first text, selected so that what is typed replaces it. */
    initial: string;
    /** How the text reads (a codec of `utils/values`, or one of the caller's). */
    read(text: string): Read<T>;
    submitLabel: string;
    /** A keyboard of digits on a phone, for a number. */
    numeric?: boolean;
    /**
     * Act on the value read, and answer when done: null to close, or why it
     * did not go, said under the field with the dialog left open (a write
     * refused). What is written is written here, waited for (I#9).
     */
    submit(value: T): Promise<string | null>;
}

/**
 * Ask for one value, in a dialog of a field. The focus opens on the field,
 * its text selected. The form's Enter (`onFormEnter`) or the submit button
 * reads the text: what does not read is said under the field, and the
 * dialog stays open (入力の論点 E). A value read is handed to `submit`,
 * waited for, and the dialog closes once it has gone.
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
            const { row } = createFormRow(group, spec.label);
            const input = row.createEl('input', {
                type: 'text',
                cls: 'tv-ctrl__text-input tv-ctrl__text-input--md tv-ctrl__text-input--glow tv-form__control',
                value: spec.initial,
            });
            if (spec.numeric) input.inputMode = 'numeric';
            const saysEl = group.createDiv({ cls: 'tv-form__error tv-ask__says' });
            const say = (text: string | null) => {
                saysEl.setText(text ?? '');
                saysEl.toggle(text !== null);
            };
            say(null);
            input.addEventListener('input', () => say(null));

            /** The submit under way, answering why it did not go (null: it went). */
            let pending: Promise<string | null> | null = null;
            const submit = async () => {
                if (pending) return;
                const read = spec.read(input.value);
                if (!read.ok) {
                    say(issueWords(read.issue));
                    return;
                }
                pending = spec.submit(read.value);
                actions.render({ busy: true });
                try {
                    const why = await pending;
                    if (why === null) hands.answer('done');
                    else say(why);
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
