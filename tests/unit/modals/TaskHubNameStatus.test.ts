import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { TaskHubForm } from '../../../src/modals/hub/TaskHubForm';
import { RowHost } from '../../../src/modals/hub/RowHost';
import { getStatusLabel } from '../../../src/constants/statusOptions';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import type { WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { FocusDoc, FocusEl, asEl } from '../helpers/focusDom';

/**
 * The hub's name and status, as the form is built and used in a stand-in
 * DOM (`focusDom`): what each writes, on which key, and what it does not
 * while an IME converts, while the form is shut, or over a name that does
 * not read; what a close saves; what a change from outside shows. The form
 * stands on a row's host (`RowHost`), which writes each change at once and
 * follows the row in a stand-in index.
 */

/** The parts of `document` the status menu's items draw their titles with. */
function stubElement(): Record<string, unknown> {
    return {
        style: {},
        classList: { add: () => { } },
        setAttribute: () => { },
        appendChild: () => { },
    };
}

beforeAll(() => {
    vi.stubGlobal('Element', FocusEl);
    vi.stubGlobal('document', {
        createDocumentFragment: () => ({ appendChild: () => { } }),
        createElement: () => stubElement(),
    });
});
afterAll(() => { vi.unstubAllGlobals(); });

interface MenuItem { checked: boolean; pick: () => void }

/** A hub's form on a task, its writes answered as `written` says; `change` is the index changing the row. */
function setUp(task: Task = makeTask({ id: 'task-1', content: '元の名前', statusChar: ' ' }), written = true) {
    const doc = new FocusDoc();
    const root = doc.root();
    const updateTask = vi.fn(async (): Promise<WriteAnswer> => (written ? { written: true } : { written: false, refused: null }));
    const menus: { items: MenuItem[]; anchor: unknown }[] = [];
    const present = vi.fn((build: (menu: unknown) => void, anchor: unknown) => {
        const items: MenuItem[] = [];
        const menu = {
            addItem: (cb: (item: unknown) => void) => {
                const one: MenuItem = { checked: false, pick: () => { } };
                const item = {
                    setTitle: () => item,
                    setChecked: (on: boolean) => { one.checked = on; return item; },
                    onClick: (fn: () => void) => { one.pick = fn; return item; },
                };
                cb(item);
                items.push(one);
                return menu;
            },
        };
        build(menu);
        menus.push({ items, anchor });
    });
    let copy: Task | undefined;
    const listeners: ((taskId?: string) => void)[] = [];
    const app = { keymap: { pushScope: () => { }, popScope: () => { } } } as never;
    const plugin = { settings: DEFAULT_SETTINGS, menuPresenter: { present } } as never;
    const index = {
        getTasks: () => [],
        getTask: () => copy,
        onChange: (listener: (taskId?: string) => void) => { listeners.push(listener); return () => { }; },
    } as never;
    const host = new RowHost(task, { app, plugin, index, operations: { updateTask } as never }, () => { });
    const form = new TaskHubForm(asEl(root), host, { app, plugin, index });
    host.attach({ redrawPreview: () => { }, close: () => { } });
    const change = (row: Task | undefined) => {
        copy = row;
        for (const listener of listeners) listener(task.id);
    };
    const name = form.fieldElement('name') as unknown as FocusEl;
    const pill = form.fieldElement('status') as unknown as FocusEl;
    return { doc, root, host, form, change, name, pill, updateTask, present, menus };
}

const key = (el: FocusEl, init: { key: string; keyCode?: number; isComposing?: boolean }) =>
    el.dispatchEvent(Object.assign(new Event('keydown'), { keyCode: 0, isComposing: false, ...init }));
const event = (el: FocusEl, type: string) => el.dispatchEvent(new Event(type));
/** The pill's label: the text after its checkbox preview. */
const pillLabel = (pill: FocusEl) => pill.children[1]?.text;
const labelOf = (char: string) => getStatusLabel(char, DEFAULT_SETTINGS.statusDefinitions);
/** The classes of the form's elements, in the order they are in the DOM (the focus order). */
const order = (el: FocusEl): string[] => el.children.flatMap(child => [...child.classes, ...order(child)]);

describe('the hub\'s name', () => {
    it('is the input of the name section, first in the form, holding the row\'s name', () => {
        const s = setUp();
        expect(s.root.find('tv-form__name-section')?.children).toContain(s.name);
        expect(s.name.value).toBe('元の名前');
        const classes = order(s.root);
        expect(classes.indexOf('tv-form__name-section')).toBeLessThan(classes.indexOf('task-hub__status-pill'));
    });

    it('writes the name typed on Enter, once', async () => {
        const s = setUp();
        s.name.focus();
        s.name.type('新しい名前');
        s.name.enter();
        await s.host.drained();

        expect(s.updateTask).toHaveBeenCalledTimes(1);
        expect(s.updateTask).toHaveBeenCalledWith('task-1', { content: '新しい名前' }, { tellRefusal: false });
    });

    it('writes the name typed on leaving the field, once', async () => {
        const s = setUp();
        s.name.focus();
        s.name.type('新しい名前');
        s.pill.focus();
        await s.host.drained();

        expect(s.updateTask).toHaveBeenCalledTimes(1);
        expect(s.updateTask).toHaveBeenCalledWith('task-1', { content: '新しい名前' }, { tellRefusal: false });
    });

    it('writes nothing on an Enter an IME commits a conversion with, in each way a browser sends it, and writes on the next', async () => {
        const s = setUp();
        s.name.focus();
        s.name.type('新しい名前');
        key(s.name, { key: 'Enter', keyCode: 13, isComposing: true });
        key(s.name, { key: 'Enter', keyCode: 229 });
        event(s.name, 'compositionstart');
        key(s.name, { key: 'Enter', keyCode: 13 });
        event(s.name, 'compositionend');
        expect(s.updateTask).not.toHaveBeenCalled();

        s.name.enter();
        await s.host.drained();
        expect(s.updateTask).toHaveBeenCalledTimes(1);
    });

    it('writes nothing for a name that does not read, says why under it, and keeps the hub open over it', () => {
        const s = setUp();
        s.name.focus();
        s.name.type('新しい名前 @2026-01-01');
        s.name.enter();

        expect(s.updateTask).not.toHaveBeenCalled();
        expect(s.name.classes.has('tv-ctrl__text-input--invalid')).toBe(true);
        expect(s.root.find('tv-form__name-section')?.find('tv-form__says')?.children.length).toBeGreaterThan(0);
        expect(s.form.beforeClose()).toBe('stay');
        expect(s.name.value).toBe('新しい名前 @2026-01-01');
    });

    it('is saved by a close with no blur, once, and the close waits for the write', async () => {
        const s = setUp();
        s.name.focus();
        s.name.type('新しい名前');

        const answer = s.form.beforeClose();
        expect(s.updateTask).toHaveBeenCalledTimes(1);
        expect(s.updateTask).toHaveBeenCalledWith('task-1', { content: '新しい名前' }, { tellRefusal: false });
        expect(await answer).toBe('close');
    });

    it('takes a name from outside when nothing is typed in it, and keeps what is typed when something is', () => {
        const s = setUp();
        s.change(makeTask({ id: 'task-1', content: '外の名前', statusChar: ' ' }));
        expect(s.name.value).toBe('外の名前');

        s.name.focus();
        s.name.type('打ちかけ');
        s.change(makeTask({ id: 'task-1', content: 'もう一度外', statusChar: ' ' }));
        expect(s.name.value).toBe('打ちかけ');
    });

    it('takes no edit while the form is shut, and takes them again once it opens', async () => {
        const s = setUp();
        s.host.setSourceOpen(true);
        expect(s.name.disabled).toBe(true);
        s.name.type('新しい名前');
        s.name.enter();
        expect(s.updateTask).not.toHaveBeenCalled();

        s.host.setSourceOpen(false);
        expect(s.name.disabled).toBe(false);
    });

    it('lets a close go at once while the form is shut, saving nothing and not waiting for a write under way', () => {
        const s = setUp();
        s.name.focus();
        s.name.type('新しい名前');
        s.name.enter();
        expect(s.updateTask).toHaveBeenCalledTimes(1);

        s.change(undefined);
        s.name.type('もう一度');
        expect(s.form.beforeClose()).toBe('close');
        expect(s.updateTask).toHaveBeenCalledTimes(1);
    });

    it('takes the focus when the form is asked to focus it', () => {
        const s = setUp();
        s.form.focusField('name');
        expect(s.doc.activeElement).toBe(s.name);
    });
});

describe('the hub\'s status', () => {
    it('is a button in the row after the name, showing the row\'s status', () => {
        const s = setUp(makeTask({ id: 'task-1', statusChar: 'x' }));
        expect(s.pill.classes.has('task-hub__status-pill')).toBe(true);
        expect(s.pill.attrs.get('type')).toBe('button');
        expect(pillLabel(s.pill)).toBe(labelOf('x'));
    });

    it('opens the statuses under the button on a click, the row\'s checked, and writes the one picked, showing it at once', async () => {
        const s = setUp();
        event(s.pill, 'click');

        expect(s.menus).toHaveLength(1);
        expect(s.menus[0].anchor).toEqual({ kind: 'belowRect', rect: s.pill.getBoundingClientRect() });
        const defs = DEFAULT_SETTINGS.statusDefinitions;
        expect(s.menus[0].items.map(i => i.checked)).toEqual(defs.map(d => d.char === ' '));

        const done = defs.findIndex(d => d.char === 'x');
        s.menus[0].items[done].pick();
        expect(pillLabel(s.pill)).toBe(labelOf('x'));
        await s.host.drained();
        expect(s.updateTask).toHaveBeenCalledTimes(1);
        expect(s.updateTask).toHaveBeenCalledWith('task-1', { statusChar: 'x' }, { tellRefusal: false });
    });

    it('writes nothing when the status picked is the row\'s', () => {
        const s = setUp();
        event(s.pill, 'click');
        s.menus[0].items[DEFAULT_SETTINGS.statusDefinitions.findIndex(d => d.char === ' ')].pick();
        expect(s.updateTask).not.toHaveBeenCalled();
    });

    it('opens the statuses on the down arrow and on the form\'s Enter, and not on an Enter an IME commits with', () => {
        const s = setUp();
        key(s.pill, { key: 'ArrowDown' });
        expect(s.menus).toHaveLength(1);
        s.pill.enter();
        expect(s.menus).toHaveLength(2);
        key(s.pill, { key: 'Enter', keyCode: 229 });
        key(s.pill, { key: 'ArrowUp' });
        expect(s.menus).toHaveLength(2);
    });

    it('shows a status from outside', () => {
        const s = setUp();
        s.change(makeTask({ id: 'task-1', content: '元の名前', statusChar: 'x' }));
        expect(pillLabel(s.pill)).toBe(labelOf('x'));
    });

    it('opens no menu while the form is shut, disabled and marked so, and opens one again once it opens', () => {
        const s = setUp();
        s.change(undefined);
        expect(s.pill.disabled).toBe(true);
        expect(s.pill.classes.has('is-disabled')).toBe(true);
        event(s.pill, 'click');
        expect(s.present).not.toHaveBeenCalled();

        s.change(makeTask({ id: 'task-1', content: '元の名前', statusChar: ' ' }));
        expect(s.pill.disabled).toBe(false);
        expect(s.pill.classes.has('is-disabled')).toBe(false);
        event(s.pill, 'click');
        expect(s.present).toHaveBeenCalledTimes(1);
    });

    it('writes nothing when a status is picked from a menu opened before the form was shut', () => {
        const s = setUp();
        event(s.pill, 'click');
        expect(s.menus).toHaveLength(1);

        s.change(undefined);
        s.menus[0].items[DEFAULT_SETTINGS.statusDefinitions.findIndex(d => d.char === 'x')].pick();
        expect(s.updateTask).not.toHaveBeenCalled();
        expect(pillLabel(s.pill)).toBe(labelOf(' '));
    });

    it('takes the focus when the form is asked to focus it', () => {
        const s = setUp();
        s.form.focusField('status');
        expect(s.doc.activeElement).toBe(s.pill);
    });
});
