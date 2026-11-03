import { describe, it, expect, vi } from 'vitest';
import { StateEffect } from '@codemirror/state';
import { askToRedraw, redrawsOn } from '../../../src/editor/TaskMenuExtension';

/**
 * The editor's line buttons are drawn again when the index or the settings
 * change, by a transaction of the plugin's own — never into an editor the
 * IME is composing in, whose input not read yet the transaction would drop
 * (iOS reads it on the next frame). The change is held there, and drawn at
 * the editor's first update after the composition.
 */

const changed = StateEffect.define<void>();

function editor(composing: boolean) {
    return { compositionStarted: composing, dispatch: vi.fn() };
}

function update(composing: boolean, docChanged = false) {
    return { docChanged, viewportChanged: false, transactions: [], view: { compositionStarted: composing } };
}

describe('askToRedraw', () => {
    it('dispatches the change into an editor not composing, and holds nothing', () => {
        const view = editor(false);
        const hold = vi.fn();
        const why = changed.of(undefined);

        askToRedraw(view, why, hold);

        expect(view.dispatch).toHaveBeenCalledTimes(1);
        expect(view.dispatch).toHaveBeenCalledWith({ effects: why });
        expect(hold).not.toHaveBeenCalled();
    });

    it('dispatches nothing into an editor composing, and holds the change', () => {
        const view = editor(true);
        const hold = vi.fn();

        askToRedraw(view, changed.of(undefined), hold);

        expect(view.dispatch).not.toHaveBeenCalled();
        expect(hold).toHaveBeenCalledTimes(1);
    });
});

describe('redrawsOn', () => {
    it('draws a held change at the first update after the composition, not before', () => {
        expect(redrawsOn(update(true), true)).toBe(false);
        expect(redrawsOn(update(false), true)).toBe(true);
    });

    it('draws nothing on an update that changed nothing, with nothing held', () => {
        expect(redrawsOn(update(false), false)).toBe(false);
    });

    it('draws on a change of the document, composing or not', () => {
        expect(redrawsOn(update(true, true), false)).toBe(true);
        expect(redrawsOn(update(false, true), false)).toBe(true);
    });
});
