import { describe, it, expect } from 'vitest';
import { t } from '../../../src/i18n';
import { DestinationField } from '../../../src/modals/noteops/DestinationField';
import { FakeEl, asEl } from '../helpers/fakeDom';

/**
 * The destination fields (`DestinationField`): the heading
 * field as it opens, what it says while empty, and what it holds as typed.
 */

function fieldOf(heading: string) {
    const container = new FakeEl();
    let changes = 0;
    const field = new DestinationField({ scope: {}, keymap: { pushScope() { }, popScope() { } } } as never, asEl(container), {
        initial: { note: { text: 'Plan', picked: null }, heading },
        onChange: () => { changes++; },
        onEnter: () => { },
    });
    const input = field.focus('heading').to as unknown as FakeEl;
    const [noteClear, headingClear] = container.findAll('tv-form__clear-button');
    return { field, input, noteClear, headingClear, changes: () => changes };
}

describe('DestinationField', () => {
    it('opens the heading field on the heading it is given, and says in its place what it stands for empty', () => {
        const f = fieldOf('Tasks');

        expect(f.input.value).toBe('Tasks');
        expect(f.input.attrs.get('placeholder')).toBe(t('modal.destination.headingEmpty'));
        expect(f.field.ask()).toEqual({ note: { text: 'Plan', picked: null }, heading: 'Tasks' });
    });

    it('focuses either field with the caret after its text', () => {
        const f = fieldOf('Tasks');

        expect(f.field.focus('heading')).toEqual({ to: f.input, selection: 'end' });
        expect(f.field.focus('note').selection).toBe('end');
    });

    it('empties the heading field by its ×, as deleting the text does: the note\'s end, told once', () => {
        const cleared = fieldOf('Tasks');
        const deleted = fieldOf('Tasks');
        cleared.headingClear.press();
        deleted.input.type('');

        expect(cleared.field.ask()).toEqual({ note: { text: 'Plan', picked: null }, heading: '' });
        expect(cleared.field.ask()).toEqual(deleted.field.ask());
        expect(cleared.changes()).toBe(1);
        expect(cleared.headingClear.style.display).toBe('none');
    });

    it('empties the note field by its ×, the heading kept', () => {
        const f = fieldOf('Tasks');
        f.noteClear.press();

        expect(f.field.ask()).toEqual({ note: { text: '', picked: null }, heading: 'Tasks' });
        expect(f.changes()).toBe(1);
    });

    it('holds the heading field emptied as empty, and tells of it', () => {
        const f = fieldOf('Tasks');
        f.input.type('');

        expect(f.field.ask().heading).toBe('');
        expect(f.changes()).toBe(1);
    });
});
