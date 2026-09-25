import { describe, it, expect } from 'vitest';
import { CheckboxWiring } from '../../../src/views/taskcard/CheckboxWiring';
import type { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import type { MenuPresenter } from '../../../src/interaction/menu/MenuPresenter';
import type { ChildRenderItem } from '../../../src/views/taskcard/types';
import type { TaskViewerSettings } from '../../../src/types';

/**
 * checkbox のクリックが書けなかったら、箱の見た目（checked と data-task）を
 * クリック前に戻す。書けたなら触らない。
 *
 * unit の environment は node で jsdom も無いので、CheckboxWiring が触る分だけを
 * 持つ代役で組む。ブラウザはクリックの前に checked を反転させるので、代役でも
 * 反転させてから click を起こす。
 */

class FakeAttrs {
    attrs = new Map<string, string>();
    getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
    setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
    removeAttribute(name: string): void { this.attrs.delete(name); }
}

class FakeCheckbox extends FakeAttrs {
    checked = false;
    isConnected = true;
    private handlers = new Map<string, ((e: unknown) => void)[]>();
    constructor(readonly li: FakeAttrs) { super(); }
    addEventListener(type: string, fn: (e: unknown) => void): void {
        const list = this.handlers.get(type) ?? [];
        list.push(fn);
        this.handlers.set(type, list);
    }
    matches(selector: string): boolean { return selector === 'input.task-list-item-checkbox'; }
    closest(selector: string): FakeAttrs | null { return selector === 'li' ? this.li : null; }
    /** 利用者のクリック: 先に checked が反転し、それから click が届く。 */
    click(): void {
        this.checked = !this.checked;
        for (const fn of this.handlers.get('click') ?? []) fn({});
    }
}

function wiringAnswering(written: boolean) {
    const calls: { id: string; updates: Record<string, unknown> }[] = [];
    const writeService = {
        updateTask: async (id: string, updates: Record<string, unknown>) => {
            calls.push({ id, updates });
            return written;
        },
    } as unknown as TaskWriteService;
    return { wiring: new CheckboxWiring(writeService, {} as MenuPresenter), calls };
}

const settings = { enableStatusMenu: false } as unknown as TaskViewerSettings;

/** updateTask の答えが返り、then が走り終えるまで待つ。 */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function childBox(initial: { checked: boolean; dataTask?: string }) {
    const li = new FakeAttrs();
    const box = new FakeCheckbox(li);
    box.checked = initial.checked;
    if (initial.dataTask) {
        box.setAttribute('data-task', initial.dataTask);
        li.setAttribute('data-task', initial.dataTask);
    }
    const container = { querySelectorAll: () => [box] } as unknown as HTMLElement;
    const items = [{ isCheckbox: true, handler: { taskId: 'child-1' } }] as unknown as ChildRenderItem[];
    return { box, li, container, items };
}

describe('parent checkbox', () => {
    it('puts the tick back when the write was not made', async () => {
        const { wiring, calls } = wiringAnswering(false);
        const box = new FakeCheckbox(new FakeAttrs());
        wiring.wireParentCheckbox(box as unknown as Element, () => 'parent-1', settings);

        box.click();
        expect(box.checked).toBe(true);
        await settle();

        expect(calls).toEqual([{ id: 'parent-1', updates: { statusChar: 'x' } }]);
        expect(box.checked).toBe(false);
    });

    it('keeps the tick when the write was made', async () => {
        const { wiring } = wiringAnswering(true);
        const box = new FakeCheckbox(new FakeAttrs());
        wiring.wireParentCheckbox(box as unknown as Element, () => 'parent-1', settings);

        box.click();
        await settle();

        expect(box.checked).toBe(true);
    });

    it('leaves a box that is no longer on the page alone', async () => {
        const { wiring } = wiringAnswering(false);
        const box = new FakeCheckbox(new FakeAttrs());
        wiring.wireParentCheckbox(box as unknown as Element, () => 'parent-1', settings);

        box.click();
        box.isConnected = false;
        await settle();

        expect(box.checked).toBe(true);
    });
});

describe('child checkbox', () => {
    it('puts checked and data-task back when ticking was not written', async () => {
        const { wiring, calls } = wiringAnswering(false);
        const { box, li, container, items } = childBox({ checked: false });
        wiring.wireChildCheckboxes(container, items, settings, () => 'child-1');

        box.click();
        expect(box.getAttribute('data-task')).toBe('x');
        await settle();

        expect(calls).toEqual([{ id: 'child-1', updates: { statusChar: 'x' } }]);
        expect(box.checked).toBe(false);
        expect(box.getAttribute('data-task')).toBeNull();
        expect(li.getAttribute('data-task')).toBeNull();
    });

    it('puts a custom status back when unticking was not written', async () => {
        const { wiring } = wiringAnswering(false);
        const { box, li, container, items } = childBox({ checked: true, dataTask: '/' });
        wiring.wireChildCheckboxes(container, items, settings, () => 'child-1');

        box.click();
        expect(box.getAttribute('data-task')).toBeNull();
        await settle();

        expect(box.checked).toBe(true);
        expect(box.getAttribute('data-task')).toBe('/');
        expect(li.getAttribute('data-task')).toBe('/');
    });

    it('keeps the new state when the write was made', async () => {
        const { wiring } = wiringAnswering(true);
        const { box, li, container, items } = childBox({ checked: false });
        wiring.wireChildCheckboxes(container, items, settings, () => 'child-1');

        box.click();
        await settle();

        expect(box.checked).toBe(true);
        expect(box.getAttribute('data-task')).toBe('x');
        expect(li.getAttribute('data-task')).toBe('x');
    });
});
