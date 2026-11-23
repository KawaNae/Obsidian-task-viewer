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
    const input = field.input('heading') as unknown as FakeEl;
    return { field, input, changes: () => changes };
}

describe('DestinationField', () => {
    it('opens the heading field on the heading it is given, and says in its place what it stands for empty', () => {
        const f = fieldOf('Tasks');

        expect(f.input.value).toBe('Tasks');
        expect(f.input.attrs.get('placeholder')).toBe(t('modal.destination.headingEmpty'));
        expect(f.field.ask()).toEqual({ note: { text: 'Plan', picked: null }, heading: 'Tasks' });
    });

    it('holds the heading field emptied as empty, and tells of it', () => {
        const f = fieldOf('Tasks');
        f.input.type('');

        expect(f.field.ask().heading).toBe('');
        expect(f.changes()).toBe(1);
    });
});
