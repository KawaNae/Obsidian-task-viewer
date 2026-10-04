import type { App } from 'obsidian';
import { OverlayShell } from '../../views/sharedUI/OverlayShell';
import { FormActions } from '../form/FormActions';
import { ask } from './Ask';

export interface Choice<C extends string> {
    value: C;
    label: string;
    tone?: 'cta' | 'warning';
}

export interface ChoiceSpec<C extends string> {
    title: string;
    /** Paragraphs, or a body drawn by the caller (a flow's next line shown as it would be written). */
    body: readonly string[] | ((el: HTMLElement) => void);
    /** The answers besides cancel, in the order they stand after it. */
    choices: readonly Choice<C>[];
    /** A class of the panel, for what only this question draws. */
    panelClass?: string;
}

/**
 * Ask the user to choose, in a dialog of buttons. The focus opens on
 * cancel (論点4): an Enter pressed before anything is read writes nothing,
 * deletes nothing, starts nothing. Answered once, when it has closed: the
 * choice pressed, else `'cancel'` (cancel, the close button, Escape, the
 * back, a click outside, a swipe).
 */
export function askChoice<C extends string>(app: App, spec: ChoiceSpec<C>): Promise<C | 'cancel'> {
    return ask<C>(new OverlayShell(), {
        keymap: app.keymap,
        panelClass: spec.panelClass,
        draw: (bodyEl, hands) => {
            bodyEl.addClass('tv-form');
            bodyEl.createEl('h2', { text: spec.title, cls: 'tv-form__title' });
            const text = bodyEl.createDiv({ cls: 'tv-ask__body' });
            if (typeof spec.body === 'function') spec.body(text);
            else for (const paragraph of spec.body) text.createEl('p', { text: paragraph });
            const actions = new FormActions(bodyEl, {
                cancel: { run: hands.cancel },
                actions: spec.choices.map(one => ({ label: one.label, tone: one.tone, run: () => hands.answer(one.value) })),
            });
            return { focus: actions.cancelButton };
        },
    });
}

/**
 * Ask whether to go on, in a dialog of cancel and `confirmLabel`.
 * @returns whether the user confirmed; a close of any other kind is no
 */
export async function confirm(app: App, spec: {
    title: string;
    body: readonly string[];
    confirmLabel: string;
    /** The act loses something (a delete): the button says so. */
    warning?: boolean;
}): Promise<boolean> {
    const answer = await askChoice(app, {
        title: spec.title,
        body: spec.body,
        choices: [{ value: 'confirm', label: spec.confirmLabel, tone: spec.warning ? 'warning' : 'cta' }],
    });
    return answer === 'confirm';
}
