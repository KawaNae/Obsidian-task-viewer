import { describe, it, expect } from 'vitest';
import { PickerTextField, createPickerTextField } from '../../../src/modals/form/PickerTextField';
import { DateFieldGroup } from '../../../src/modals/hub/fields/DateFieldGroup';
import type { FieldGroupContext } from '../../../src/modals/hub/fields/FieldGroupContext';
import type { Task } from '../../../src/types';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import { makeTask } from '../helpers/makeTask';
import { t } from '../../../src/i18n';

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
    dataset: Record<string, string> = {};
    text = '';

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
    toggleClass(c: string, on: boolean): void { if (on) this.classes.add(c); else this.classes.delete(c); }
    setText(text: string): void { this.text = text; }
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
    /** A document whose focus is on none of these elements: a clear button's press finds its field out of focus. */
    get ownerDocument(): { activeElement: null } { return { activeElement: null }; }
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

    it('takes a picked value into the text, and tells the pick with no event of the text', () => {
        const root = new FakeEl('div');
        const picked: string[] = [];
        let inputs = 0;
        const field = createPickerTextField(root as unknown as HTMLElement, 'date', 'YYYY-MM-DD', '', { onPick: (value) => picked.push(value) });
        field.input.addEventListener('input', () => { inputs++; });
        const p = parts(root);
        p.picker.value = '2026-10-01';
        p.picker.dispatchEvent(new Event('change'));
        expect(field.input.value).toBe('2026-10-01');
        expect(picked).toEqual(['2026-10-01']);
        expect(inputs).toBe(0);
        expect(p.clear!.style.display).toBe('');
    });

    it('tells a clear with no event of the text, and keeps its clear button and picker in step with a text set from outside', () => {
        const root = new FakeEl('div');
        let cleared = 0;
        let inputs = 0;
        const field = createPickerTextField(root as unknown as HTMLElement, 'date', 'YYYY-MM-DD', '2026-09-29', { onClear: () => { cleared++; } });
        field.input.addEventListener('input', () => { inputs++; });
        const p = parts(root);
        expect(p.picker.value).toBe('2026-09-29');

        p.clear!.click();
        expect([field.input.value, cleared, inputs, p.clear!.style.display, p.picker.value]).toEqual(['', 1, 0, 'none', '']);

        field.setText('2026-10-05');
        expect([inputs, p.clear!.style.display, p.picker.value]).toEqual([0, '', '2026-10-05']);
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

/**
 * The hub's date fields on `task`, its context a stand-in: what the group
 * hands on (`put`) and says (`issues`) is kept.
 */
function dateGroup(task: () => Task, root = new FakeEl('div')) {
    const put: string[] = [];
    /** Whether the hub is shut: its fields are disabled with it. */
    const hub = { shut: false };
    const said: { at: string; text: string }[][] = [];
    const ctx = {
        task,
        isShut: () => hub.shut,
        put: async () => { put.push('put'); return true; },
        plugin: { settings: DEFAULT_SETTINGS, menuPresenter: { present: () => { } } },
        index: { getTask: () => undefined },
        openSource: null,
        issues: { set: (_source: string, issues: readonly { at: string; text: string }[]) => { said.push(issues.map(({ at, text }) => ({ at, text }))); } },
    } as unknown as FieldGroupContext;
    const g = new DateFieldGroup(root as unknown as HTMLElement, ctx, { labels: { start: 'start', end: 'end', due: 'due' } });
    return { g, root, put, said, hub };
}

describe('DateFieldGroup.setEnabled', () => {
    it('disables every field with its picker and its …, so a press in the hub\'s source mode changes nothing', () => {
        const { g: group, root, put, hub } = dateGroup(() => makeTask({ id: 'row', startDate: '2026-09-29', startTime: '10:00', due: '2026-10-01' }));
        hub.shut = true;
        group.setEnabled(false);

        const controls = [
            ...root.findAll('tv-ctrl__text-input'), ...root.findAll('tv-form__picker-button'),
            ...root.findAll('tv-form__native-picker-input'), ...root.findAll('tv-form__menu-button'),
        ];
        expect(controls).toHaveLength(24);
        expect(controls.every(c => c.disabled)).toBe(true);
        // The hub's date fields have no × in them.
        expect(root.findAll('tv-form__clear-button')).toEqual([]);

        for (const button of [...root.findAll('tv-form__menu-button'), ...root.findAll('tv-form__picker-button')]) button.click();
        expect(root.findAll('tv-ctrl__text-input').map(input => input.value)).toEqual(['2026-09-29', '10:00', '', '', '2026-10-01', '']);
        expect(root.findAll('tv-form__native-picker-input').every(p => p.shown === 0)).toBe(true);
        expect(put).toEqual([]);
    });
});

describe('DateFieldGroup.refresh', () => {
    const group = (values: Partial<Task>) => dateGroup(() => makeTask({ id: 'row', ...values }));

    it('says a rule the values it was made with break, under the field it is of, with nothing typed (the hub as it opens)', () => {
        // @2026-10-14>2026-10-14T02:00: an end time with no start time (rule 4).
        const { g, said } = group({ startDate: '2026-10-14', endDate: '2026-10-14', endTime: '02:00' });
        // Made, it says nothing: the form's slots for its fields are not there yet.
        expect(said).toEqual([]);

        g.refresh();
        const now = said[said.length - 1];
        expect(now).toHaveLength(1);
        expect(now[0].at).toBe('endTime');
        expect(now[0].text.split('\n')[0]).toBe(t('validation.endTimeWithoutStart'));
    });

    it('says nothing of values that keep the rules', () => {
        const { g, said } = group({ startDate: '2026-10-14', startTime: '09:00', endTime: '10:00' });
        g.refresh();
        expect(said.length).toBeGreaterThan(0);
        expect(said.every(issues => issues.length === 0)).toBe(true);
    });
});

describe('DateFieldGroup.ruleBroken', () => {
    /** The row's dates `values`, under a section that gives a start date until `ctx.hasImplicitStartDate` is turned off. */
    function group(values: Partial<Task>) {
        const ctx = { hasImplicitStartDate: true };
        const { g, root } = dateGroup(() => makeTask({ id: 'row', ...values, cascadeContext: ctx.hasImplicitStartDate ? { startDate: '2026-10-01' } : {} }));
        const inputs = root.findAll('tv-ctrl__text-input');
        return { g, ctx, inputs };
    }

    it('names the field a rule is broken at as the values stand under what is inherited now, nothing typed', () => {
        const { g, ctx } = group({ startTime: '10:00' });
        expect(g.ruleBroken()).toEqual([]);
        ctx.hasImplicitStartDate = false;
        expect(g.ruleBroken()).toEqual(['startTime']);
    });

    it('reads the text in the fields, typed and not committed', () => {
        const { g, ctx, inputs } = group({});
        ctx.hasImplicitStartDate = false;
        expect(g.ruleBroken()).toEqual([]);
        inputs[1].value = '10:00';
        expect(g.ruleBroken()).toEqual(['startTime']);
    });

    it('names none while a field does not read', () => {
        const { g, ctx, inputs } = group({ startTime: '10:00' });
        ctx.hasImplicitStartDate = false;
        inputs[0].value = 'not a date';
        expect(g.ruleBroken()).toEqual([]);
    });
});
