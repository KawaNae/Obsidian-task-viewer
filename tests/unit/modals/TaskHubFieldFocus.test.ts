import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { TaskHubForm, selectionOnFocus, tabOf, type TaskHubFocusField } from '../../../src/modals/hub/TaskHubForm';
import { RowHost } from '../../../src/modals/hub/RowHost';
import { focusField } from '../../../src/utils/FieldFocus';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import { makeTask } from '../helpers/makeTask';
import { byKey } from '../helpers/properties';
import { FocusDoc, FocusEl, asEl } from '../helpers/focusDom';
import { forgetMenus, menuShown } from '../../../src/interaction/menu/MenusOnScreen';

/**
 * How the text of each of the hub's fields is met as the focus comes to it,
 * in a stand-in DOM (`focusDom`): a date, a time, a line style and a colour
 * selected whole, a name, a tag, a mask and a property with the caret after
 * them, the status focused alone. The hub opening on a field
 * (`initialFocus`, which the shell focuses) and its menu asking for one
 * (`focusField`) meet it alike, the field's tab chosen: the hub opens on it,
 * and the menu chooses it.
 */

beforeAll(() => {
    vi.stubGlobal('Element', FocusEl);
    vi.stubGlobal('document', {
        createDocumentFragment: () => ({ appendChild: () => { } }),
        createElement: () => ({ style: {}, classList: { add: () => { } }, setAttribute: () => { }, appendChild: () => { } }),
    });
});
afterAll(() => { vi.unstubAllGlobals(); });

/** A hub's form on a row that has a property of one value, opened on `opensOn`'s tab. */
function setUp(opensOn?: TaskHubFocusField) {
    const doc = new FocusDoc();
    Object.assign(doc, { createElement: () => ({ getContext: () => null }) });
    const root = doc.root();
    const task = makeTask({ id: 'task-1', content: 'とても長い名前のタスク', properties: byKey({ owner: { type: 'text', text: 'you', spelling: 'you' } }) });
    const app = { keymap: { pushScope: () => { }, popScope: () => { } } } as never;
    const plugin = { settings: DEFAULT_SETTINGS, menuPresenter: { present: () => { } } } as never;
    const index = { getTasks: () => [], getTask: () => undefined, onChange: () => () => { } } as never;
    const host = new RowHost(task, { app, plugin, index, operations: { updateTask: vi.fn(async () => ({ written: true })) } as never }, () => { });
    const form = new TaskHubForm(asEl(root), host, { app, plugin, index, foot: asEl(root), ...(opensOn && { opensOn }) });
    host.attach({ redrawPreview: () => { }, close: () => { } });
    /** The field's element, given a text so that what of it is selected shows. */
    const field = (name: TaskHubFocusField): FocusEl => {
        const el = form.fieldElement(name) as unknown as FocusEl;
        if (name !== 'status') el.value = 'ある値の文字';
        return el;
    };
    /** The tab chosen now. */
    const selected = () => root.find('tv-tabs')!.findAll('tv-tabs__tab').find(tab => tab.attrs.get('aria-selected') === 'true')!.attrs.get('data-tab');
    return { doc, form, field, selected };
}

const SELECTED: TaskHubFocusField[] = ['start', 'end', 'due', 'linestyle', 'color'];
const CARET_AT_END: TaskHubFocusField[] = ['name', 'tags', 'mask', 'properties', 'property:owner'];

/** What of the field's text is selected: all, the caret after it, or as it was (at its start). */
function textOf(el: FocusEl): 'all' | 'end' | 'start' {
    const length = el.value.length;
    if (el.selectionStart === 0 && el.selectionEnd === length) return 'all';
    if (el.selectionStart === length && el.selectionEnd === length) return 'end';
    return 'start';
}

describe('the text of a hub\'s field as the focus comes to it', () => {
    it('is selected whole in a date, a time, a line style and a colour, and has the caret after it in any other text', () => {
        for (const name of SELECTED) expect(selectionOnFocus(name), name).toBe('all');
        for (const name of CARET_AT_END) expect(selectionOnFocus(name), name).toBe('end');
        expect(selectionOnFocus('property:anything')).toBe('end');
        expect(selectionOnFocus('status')).toBeUndefined();
    });

    describe('as the menu asks for the field', () => {
        it.each(SELECTED)('selects the text of %s whole', (name) => {
            const s = setUp();
            const el = s.field(name);
            s.form.focusField(name);
            expect(s.doc.activeElement).toBe(el);
            expect(textOf(el)).toBe('all');
        });

        it.each(CARET_AT_END)('puts the caret after the text of %s', (name) => {
            const s = setUp();
            const el = s.field(name);
            s.form.focusField(name);
            expect(s.doc.activeElement).toBe(el);
            expect(textOf(el)).toBe('end');
        });

        it('scrolls a long name in its field to its end, the field alone', () => {
            const s = setUp();
            const el = s.field('name');
            el.scrollWidth = 640;
            s.form.focusField('name');
            expect(el.scrollLeft).toBe(640);
        });

        it.each([...SELECTED, ...CARET_AT_END, 'status' as const])('chooses the tab of %s, from the other tab', (name) => {
            const s = setUp(tabOf(name) === 'basic' ? 'tags' : 'name');
            expect(s.selected()).not.toBe(tabOf(name));
            s.form.focusField(name);
            expect(s.selected()).toBe(tabOf(name));
            expect(s.doc.activeElement).toBe(s.field(name));
        });

        it('focuses the status, a button, alone', () => {
            const s = setUp();
            const el = s.field('status');
            s.form.focusField('status');
            expect(s.doc.activeElement).toBe(el);
            expect([el.selectionStart, el.selectionEnd]).toEqual([0, 0]);
        });
    });

    describe('as the hub opens on the field', () => {
        it.each([...SELECTED, ...CARET_AT_END, 'status' as const])('names the element of %s and its text as the menu does', (name) => {
            const opening = setUp();
            const el = opening.field(name);
            const first = opening.form.focusOf(name);
            expect(first?.to).toBe(el);
            focusField(first!, { preventScroll: true });

            const asked = setUp();
            const other = asked.field(name);
            asked.form.focusField(name);

            expect(opening.doc.activeElement).toBe(el);
            expect(textOf(el)).toBe(textOf(other));
            expect(first?.selection).toBe(selectionOnFocus(name));
        });

        it.each([...SELECTED, ...CARET_AT_END, 'status' as const])('is built on the tab of %s', (name) => {
            expect(setUp(name).selected()).toBe(tabOf(name));
        });
    });
});

describe('the hub\'s menu asking for a field while it is still on the screen', () => {
    afterEach(() => { forgetMenus(); });

    /** Let the wait for the menu settle. */
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    it('focuses the field once the menu has gone, not before (a sheet sliding away)', async () => {
        const s = setUp();
        const el = s.field('name');
        const gone = menuShown();
        s.form.focusField('name');
        await flush();
        expect(s.doc.activeElement).not.toBe(el);

        gone();
        await flush();
        expect(s.doc.activeElement).toBe(el);
        expect(textOf(el)).toBe('end');
    });

    it('focuses it at once with no menu on the screen (a menu gone inside its hide)', () => {
        const s = setUp();
        const el = s.field('start');
        s.form.focusField('start');
        expect(s.doc.activeElement).toBe(el);
        expect(textOf(el)).toBe('all');
    });
});
