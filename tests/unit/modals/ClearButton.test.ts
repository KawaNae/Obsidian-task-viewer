import { describe, it, expect } from 'vitest';
import { t } from '../../../src/i18n';
import { ClearButton, createClearableInput } from '../../../src/modals/form/ClearButton';
import { FakeEl, asEl, focused } from '../helpers/fakeDom';
import { FocusDoc, asEl as asFocusEl } from '../helpers/focusDom';
import { holdPresses, ownCommit } from '../../../src/views/sharedUI/PressCommit';

/**
 * The × at the end of a form's text field (`ClearButton`): shown while the
 * field holds a value, out of the Tab order, disabled with the field, and
 * what a press does to the field and the focus; and the field that a ×
 * empties as deleting its text does (`createClearableInput`).
 */

function buttonOf(value: string, focusesField: boolean) {
    const box = new FakeEl();
    const input = box.createEl('input');
    input.value = value;
    let cleared = 0;
    const clear = new ClearButton(asEl(box), asEl(input), {
        clear: () => { input.value = ''; cleared++; },
        focusesField,
    });
    const button = box.find('tv-form__clear-button')!;
    return { box, input, clear, button, cleared: () => cleared };
}

describe('ClearButton', () => {
    it('stands in the field\'s box, named for a screen reader, out of the Tab order', () => {
        const b = buttonOf('x', true);

        expect(b.box.classes.has('tv-form__clearable')).toBe(true);
        expect(b.button.attrs.get('aria-label')).toBe(t('modal.clear'));
        expect(b.button.attrs.get('type')).toBe('button');
        expect(b.button.tabIndex).toBe(-1);
    });

    it('shows while the field holds a value, following what is typed', () => {
        const b = buttonOf('', true);
        expect(b.button.style.display).toBe('none');

        b.input.type('Plan');
        expect(b.button.style.display).toBe('');
        b.input.type('  ');
        expect(b.button.style.display).toBe('none');
    });

    it('follows a value put in by script once synced', () => {
        const b = buttonOf('', true);
        b.input.value = 'Plan';
        b.clear.sync();

        expect(b.button.style.display).toBe('');
    });

    it('empties the field and hides, leaving the focus in the field when it is to', () => {
        const b = buttonOf('Plan', true);
        b.input.focus();
        const press = b.button.press();

        expect(press.defaultPrevented).toBe(true);
        expect(b.cleared()).toBe(1);
        expect(b.input.value).toBe('');
        expect(b.button.style.display).toBe('none');
        expect(focused()).toBe(b.input);
    });

    it('focuses the field after the clear though the focus was elsewhere', () => {
        const b = buttonOf('Plan', true);
        new FakeEl().focus();
        b.button.press();

        expect(focused()).toBe(b.input);
    });

    it('is pressed as any button otherwise: the focus not kept nor moved to the field', () => {
        const b = buttonOf('Plan', false);
        const elsewhere = new FakeEl();
        elsewhere.focus();
        const press = b.button.press();

        expect(press.defaultPrevented).toBe(false);
        expect(b.cleared()).toBe(1);
        expect(focused()).toBe(elsewhere);
    });

    it('keeps the focus in a field in focus till it is emptied, then takes it out, when the field is not to keep it: no blur commits what was typed first', () => {
        const b = buttonOf('Plan', false);
        const seen: string[] = [];
        b.input.addEventListener('blur', () => seen.push(`blur ${JSON.stringify(b.input.value)} after ${b.cleared()} clears`));
        b.input.focus();
        b.input.type('typed');
        const press = b.button.press();

        expect(press.defaultPrevented).toBe(true);
        expect(b.cleared()).toBe(1);
        expect(seen).toEqual(['blur "" after 1 clears']);
        expect(focused()).not.toBe(b.input);
    });

    it('is disabled with the field once synced, and a press then does nothing', () => {
        const b = buttonOf('Plan', true);
        b.input.disabled = true;
        b.clear.sync();

        expect(b.button.disabled).toBe(true);
        b.button.press();
        expect(b.input.value).toBe('Plan');
        expect(b.cleared()).toBe(0);
    });
});

describe('ClearButton in a surface that holds the presses on its buttons (holdPresses)', () => {
    /** A × of a field in a surface that holds its presses, and another field beside it that commits what is typed. */
    function inSurface(focusesField: boolean) {
        const doc = new FocusDoc();
        const panel = doc.root();
        holdPresses(asFocusEl(panel));
        const input = panel.createEl('input', { type: 'text' });
        input.value = 'Plan';
        const commits: string[] = [];
        new ClearButton(asFocusEl(panel), asFocusEl(input), {
            clear: () => { input.value = ''; commits.push('cleared'); },
            focusesField,
        });
        // Both fields commit what is typed in them, as a bound field does.
        const other = panel.createEl('input', { type: 'text' });
        for (const [field, name] of [[input, 'own'], [other, 'other']] as const) {
            let given = field.value;
            ownCommit(asFocusEl(field), {
                typed: () => field.value !== given,
                commit: () => { commits.push(`${name} ${field.value}`); given = field.value; return true; },
            });
        }
        return { doc, input, other, commits, button: panel.find('tv-form__clear-button')! };
    }

    it('is its field\'s own: with the focus in its field, typed over, it acts as out of the surface, nothing else committed first', () => {
        for (const focusesField of [false, true]) {
            const s = inSurface(focusesField);
            s.other.type('x');
            s.input.focus();
            s.input.type('typed');
            s.button.press();
            expect(s.commits, String(focusesField)).toEqual(['cleared']);
            expect(s.doc.activeElement === s.input, String(focusesField)).toBe(focusesField);
        }
    });

    it('commits the field in focus beside it first, which keeps the focus, then empties its own', () => {
        const s = inSurface(false);
        s.other.focus();
        s.other.type('x');
        s.button.press();
        expect(s.commits).toEqual(['other x', 'cleared']);
        expect(s.doc.activeElement).toBe(s.other);
    });
});

describe('createClearableInput', () => {
    it('puts the field and its × in one box, the field with its placeholder', () => {
        const row = new FakeEl();
        const { input } = createClearableInput(asEl(row), 'ノート');
        const box = row.children[0];

        expect(box.classes.has('tv-form__control')).toBe(true);
        expect(box.classes.has('tv-form__clearable')).toBe(true);
        expect(box.children[0]).toBe(input as unknown as FakeEl);
        expect((input as unknown as FakeEl).attrs.get('placeholder')).toBe('ノート');
        expect(box.find('tv-form__clear-button')).not.toBeNull();
    });

    it('empties the field as deleting its text does: an input event, the value already empty, the focus in the field', () => {
        const row = new FakeEl();
        const { input, clear } = createClearableInput(asEl(row), '');
        const field = input as unknown as FakeEl;
        field.value = 'Plan';
        clear.sync();
        const seen: string[] = [];
        field.addEventListener('input', () => seen.push(field.value));

        row.find('tv-form__clear-button')!.press();

        expect(seen).toEqual(['']);
        expect(focused()).toBe(field);
    });
});
