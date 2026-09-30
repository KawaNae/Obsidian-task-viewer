import { describe, it, expect } from 'vitest';
import { isFormEnter } from '../../../src/modals/form/formEnter';

/**
 * The create dialog's name and date fields submitted on any Enter, including
 * the one an IME uses to commit a conversion. They now ask isFormEnter, as the
 * Task Hub's name field does.
 */
function key(init: { key?: string; isComposing?: boolean; keyCode?: number }): KeyboardEvent {
    return { key: 'Enter', isComposing: false, keyCode: 13, ...init } as KeyboardEvent;
}

describe('isFormEnter', () => {
    it('a plain Enter acts on the form', () => {
        expect(isFormEnter(key({}))).toBe(true);
    });

    it('Chromium: the Enter that commits a conversion arrives with isComposing', () => {
        expect(isFormEnter(key({ isComposing: true, keyCode: 229 }))).toBe(false);
    });

    it('Safari: the composition has ended but the Enter still carries keyCode 229', () => {
        expect(isFormEnter(key({ isComposing: false, keyCode: 229 }))).toBe(false);
    });

    it('a field that tracks its own composition can hold the Enter back', () => {
        expect(isFormEnter(key({}), true)).toBe(false);
    });

    it('other keys are not Enter', () => {
        expect(isFormEnter(key({ key: 'a', keyCode: 65 }))).toBe(false);
    });
});
