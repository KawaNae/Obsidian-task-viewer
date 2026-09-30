import { describe, it, expect } from 'vitest';
import { PickerTextField, createPickerTextField } from '../../../src/modals/form/PickerTextField';
import { DateFieldGroup } from '../../../src/modals/form/DateFieldGroup';
import { makeTask } from '../helpers/makeTask';

/**
 * A picker field takes input or not as one state: disabled, its text, its
 * picker and the picker's button, and its clear button are all disabled, and
 * none of them changes the value.
 *
 * Vitest runs in node without a DOM, so the field is built in a stand-in that
 * has only what the field touches. As in a browser, `click()` on a disabled
 * button or input dispatches nothing: that is what keeps a disabled field's
 * buttons from acting, and the field's handlers do not look at it themselves.
 */

type Listener = (e: Event) => void;

class FakeEl {
    tagName: string;
    classes = new Set<string>();
    attrs = new Map<string, string>();
    children: FakeEl[] = [];
    listeners = new Map<string, Listener[]>();
    style: Record<string, string> = {};
    value = '';
    type = '';
    step = '';
    placeholder = '';
    disabled = false;
    tabIndex = 0;
    shown = 0;

    constructor(tag: string, cls = '') {
        this.tagName = tag.toUpperCase();
        cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
    }

    createEl(tag: string, o: { cls?: string; type?: string; placeholder?: string; attr?: Record<string, string> } = {}): FakeEl {
        const el = new FakeEl(tag, o.cls);
        if (o.type) el.type = o.type;
        if (o.placeholder) el.placeholder = o.placeholder;
        for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
        this.children.push(el);
        return el;
    }
    createDiv(o: { cls?: string } = {}): FakeEl { return this.createEl('div', o); }
    createSpan(o: { cls?: string } = {}): FakeEl { return this.createEl('span', o); }
    insertBefore(el: FakeEl, ref: FakeEl): void {
        this.children = this.children.filter(c => c !== el);
        this.children.splice(this.children.indexOf(ref), 0, el);
    }
    addClass(c: string): void { this.classes.add(c); }
    appendText(_t: string): void { /* the label's text is not read */ }
    setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
    addEventListener(type: string, fn: Listener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    dispatchEvent(e: Event): boolean {
        for (const fn of this.listeners.get(e.type) ?? []) fn(e);
        return true;
    }
    /** A browser dispatches no click on a disabled form control. */
    click(): void {
        if (this.disabled && (this.tagName === 'BUTTON' || this.tagName === 'INPUT')) return;
        this.dispatchEvent(new Event('click'));
    }
    focus(): void { this.dispatchEvent(new Event('focus')); }
    showPicker(): void { this.shown++; }

    find(cls: string): FakeEl {
        const found = this.findAll(cls)[0];
        if (!found) throw new Error(`no .${cls}`);
        return found;
    }
    findAll(cls: string): FakeEl[] {
        return this.children.flatMap(c => [...(c.classes.has(cls) ? [c] : []), ...c.findAll(cls)]);
    }
}

function parts(root: FakeEl) {
    return {
        text: root.find('tv-ctrl__text-input'),
        pickerButton: root.find('tv-form__picker-button'),
        picker: root.find('tv-form__native-picker-input'),
        clear: root.findAll('tv-form__clear-button')[0] ?? null,
    };
}

function dateField(value: string) {
    const root = new FakeEl('div');
    const field = createPickerTextField(root as unknown as HTMLElement, 'date', 'YYYY-MM-DD', value);
    return { field, root, ...parts(root) };
}

describe('PickerTextField', () => {
    it('clears the value and opens the picker while enabled', () => {
        const f = dateField('2026-09-29');
        expect(f.clear!.style.display).toBe('');

        f.pickerButton.click();
        f.picker.click();
        expect(f.picker.shown).toBe(2);

        f.clear!.click();
        expect(f.field.input.value).toBe('');
        expect(f.clear!.style.display).toBe('none');
    });

    it('disables its text, picker, picker button and clear button together, and none of them changes the value', () => {
        const f = dateField('2026-09-29');
        f.field.setEnabled(false);

        expect([f.text.disabled, f.picker.disabled, f.pickerButton.disabled, f.clear!.disabled]).toEqual([true, true, true, true]);

        f.clear!.click();
        f.pickerButton.click();
        f.picker.click();
        expect(f.field.input.value).toBe('2026-09-29');
        expect(f.picker.shown).toBe(0);

        f.field.setEnabled(true);
        expect([f.text.disabled, f.picker.disabled, f.pickerButton.disabled, f.clear!.disabled]).toEqual([false, false, false, false]);
    });

    it('builds its buttons as buttons, the picker and clear out of the tab order and the picker button in it', () => {
        const f = dateField('');
        expect(f.pickerButton.tagName).toBe('BUTTON');
        expect(f.pickerButton.attrs.get('type')).toBe('button');
        expect(f.pickerButton.tabIndex).toBe(0);
        expect(f.clear!.tagName).toBe('BUTTON');
        expect(f.clear!.tabIndex).toBe(-1);
        expect(f.picker.tabIndex).toBe(-1);
    });

    it('takes a picked value into the text', () => {
        const f = dateField('');
        f.picker.value = '2026-10-01';
        f.picker.dispatchEvent(new Event('change'));
        expect(f.field.input.value).toBe('2026-10-01');
    });

    it('disables a color field, which has no clear button, its picker with it', () => {
        const root = new FakeEl('div');
        const field = new PickerTextField(root as unknown as HTMLElement, {
            type: 'color', icon: 'palette', pickerLabel: 'color', initialValue: 'red', clearable: false,
        });
        const p = parts(root);
        expect(p.clear).toBeNull();

        field.setEnabled(false);
        p.pickerButton.click();
        p.picker.click();
        expect(p.picker.shown).toBe(0);
        expect([p.text.disabled, p.picker.disabled, p.pickerButton.disabled]).toEqual([true, true, true]);
    });
});

describe('DateFieldGroup.setEnabled', () => {
    it('disables every field with its buttons, so a clear in the hub\'s source mode changes nothing', () => {
        const root = new FakeEl('div');
        const inputs: string[] = [];
        const group = new DateFieldGroup(root as unknown as HTMLElement, {
            labels: { start: 'start', end: 'end', due: 'due' },
            initial: { startDate: '2026-09-29', startTime: '10:00', dueDate: '2026-10-01' },
            buildOverlayTask: () => makeTask({ id: 'overlay' }),
            getStartHour: () => 0,
            taskLookup: () => undefined,
            getValidationCtx: () => ({ hasImplicitStartDate: false }),
            onInput: (group) => inputs.push(group),
            onCommit: (group) => inputs.push(`commit:${group}`),
        });
        group.setEnabled(false);

        const controls = [
            ...root.findAll('tv-ctrl__text-input'), ...root.findAll('tv-form__picker-button'),
            ...root.findAll('tv-form__native-picker-input'), ...root.findAll('tv-form__clear-button'),
        ];
        expect(controls).toHaveLength(24);
        expect(controls.every(c => c.disabled)).toBe(true);

        for (const clear of root.findAll('tv-form__clear-button')) clear.click();
        for (const button of root.findAll('tv-form__picker-button')) button.click();
        expect(group.collect()).toMatchObject({ startDate: '2026-09-29', startTime: '10:00', dueDate: '2026-10-01' });
        expect(root.findAll('tv-form__native-picker-input').every(p => p.shown === 0)).toBe(true);
        expect(inputs).toEqual([]);
    });
});
