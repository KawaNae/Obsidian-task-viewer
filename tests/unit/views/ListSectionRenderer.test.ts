import { describe, it, expect, vi } from 'vitest';
import {
    renderListSection,
    startListSectionRename,
    type ListSectionClasses,
    type ListSectionParams,
} from '../../../src/views/sharedUI/ListSectionRenderer';

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('obsidian');
    return {
        ...actual,
        // Record where the icon was injected: the WebKit rule says it must be a
        // child of the button, never the button itself.
        setIcon: (el: { __iconTarget?: boolean }, icon: string) => {
            iconTargets.push({ el: el as unknown as FakeEl, icon });
        },
    };
});

const iconTargets: { el: FakeEl; icon: string }[] = [];

/**
 * Minimal stand-in for an Obsidian-extended HTMLElement: enough of the
 * creation helpers, class list and event wiring to exercise the renderer
 * without jsdom, the pattern used in tests/unit/views/ScheduleGridRenderer.test.ts.
 */
class FakeEl {
    children: FakeEl[] = [];
    classes = new Set<string>();
    textContent = '';
    tag: string;
    parentElement: FakeEl | null = null;
    type = '';
    value = '';
    listeners = new Map<string, ((e: FakeEvent) => void)[]>();
    focused = false;
    selected = false;

    constructor(tag = 'div', cls = '') {
        this.tag = tag;
        for (const c of cls.split(' ').filter(Boolean)) this.classes.add(c);
    }

    get classList() {
        return { contains: (c: string) => this.classes.has(c) };
    }
    get className(): string { return [...this.classes].join(' '); }
    set className(v: string) {
        this.classes = new Set(v.split(' ').filter(Boolean));
    }
    get childElementCount() { return this.children.length; }
    get ownerDocument() {
        return { createElement: (tag: string) => new FakeEl(tag) };
    }

    private adopt(child: FakeEl): FakeEl {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    createDiv(cls = ''): FakeEl { return this.adopt(new FakeEl('div', cls)); }
    createSpan(arg: string | { text?: string; cls?: string } = ''): FakeEl {
        const opts = typeof arg === 'string' ? { cls: arg } : arg;
        const el = new FakeEl('span', opts.cls ?? '');
        if (opts.text !== undefined) el.textContent = opts.text;
        return this.adopt(el);
    }
    createEl(tag: string, opts: { cls?: string; text?: string } = {}): FakeEl {
        const el = new FakeEl(tag, opts.cls ?? '');
        if (opts.text !== undefined) el.textContent = opts.text;
        return this.adopt(el);
    }
    addClass(c: string): void { this.classes.add(c); }
    removeClass(c: string): void { this.classes.delete(c); }
    addEventListener(type: string, cb: (e: FakeEvent) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(cb);
        this.listeners.set(type, list);
    }
    fire(type: string, e: Partial<FakeEvent> = {}): void {
        const ev: FakeEvent = { stopPropagation: () => {}, preventDefault: () => {}, ...e };
        for (const cb of this.listeners.get(type) ?? []) cb(ev);
    }
    replaceWith(other: FakeEl): void {
        const parent = this.parentElement;
        if (!parent) return;
        parent.children[parent.children.indexOf(this)] = other;
        other.parentElement = parent;
        this.parentElement = null;
    }
    focus(): void { this.focused = true; }
    select(): void { this.selected = true; }
    /** Enter calls blur() to commit, exactly as a real input would. */
    blur(): void { this.focused = false; this.fire('blur'); }
    querySelector(sel: string): FakeEl | null {
        const cls = sel.replace(/^\./, '');
        for (const c of this.children) {
            if (c.classes.has(cls)) return c;
            const found = c.querySelector(sel);
            if (found) return found;
        }
        return null;
    }
    find(cls: string): FakeEl {
        const found = this.querySelector('.' + cls);
        if (!found) throw new Error(`no element with class ${cls}`);
        return found;
    }
}

interface FakeEvent {
    stopPropagation: () => void;
    preventDefault: () => void;
    key?: string;
}

const CLASSES: ListSectionClasses = {
    root: 'sec', collapsed: 'sec--collapsed', header: 'sec__header',
    toggle: 'sec__toggle', name: 'sec__name', count: 'sec__count',
    button: 'sec__btn', body: 'sec__body', nameInput: 'sec__name-input',
};

function render(overrides: Partial<ListSectionParams> = {}) {
    iconTargets.length = 0;
    const container = new FakeEl('div');
    const calls = { collapsed: [] as boolean[], bodies: [] as boolean[], sort: 0, filter: 0, more: 0 };
    const params: ListSectionParams = {
        classes: CLASSES,
        name: 'Today',
        taskCount: 3,
        collapsed: false,
        sortState: undefined,
        filterState: undefined,
        onSortClick: () => { calls.sort++; },
        onFilterClick: () => { calls.filter++; },
        onMoreClick: () => { calls.more++; },
        onCollapsedChange: (c) => calls.collapsed.push(c),
        renderBody: (body, opts) => {
            calls.bodies.push(opts.resetPaging);
            (body as unknown as FakeEl).createDiv('task-card');
        },
        ...overrides,
    };
    const handle = renderListSection(container as unknown as HTMLElement, params);
    return { container, calls, handle: handle as unknown as { root: FakeEl; body: FakeEl; nameEl: FakeEl } };
}

describe('renderListSection header', () => {
    it('lays out the toggle, name and count', () => {
        const { handle } = render();
        expect(handle.root.find('sec__toggle').textContent).toBe('▼');
        expect(handle.root.find('sec__name').textContent).toBe('Today');
        expect(handle.root.find('sec__count').textContent).toBe('(3)');
    });

    it('starts collapsed when asked, with the collapsed marker and arrow', () => {
        const { handle } = render({ collapsed: true });
        expect(handle.root.classes.has('sec--collapsed')).toBe(true);
        expect(handle.root.find('sec__toggle').textContent).toBe('▶');
    });

    it('puts each icon inside the button rather than in the button itself', () => {
        // WebKit does not paint an SVG that is an immediate child of an
        // inline-flex button, which is what these header buttons are.
        const { handle } = render();
        const buttons = handle.root.find('sec__header').children.filter(c => c.tag === 'button');
        expect(buttons).toHaveLength(3);
        expect(iconTargets.map(t => t.icon)).toEqual(['arrow-up-down', 'filter', 'more-horizontal']);
        for (const target of iconTargets) {
            expect(buttons).not.toContain(target.el);
            expect(buttons).toContain(target.el.parentElement);
        }
    });

    it('marks the sort and filter buttons active only when they carry rules', () => {
        const plain = render();
        const header = plain.handle.root.find('sec__header');
        const [sortBtn, filterBtn] = header.children.filter(c => c.tag === 'button');
        expect(sortBtn.classes.has('is-sorted')).toBe(false);
        expect(filterBtn.classes.has('is-filtered')).toBe(false);

        const active = render({
            sortState: { rules: [{ property: 'due', direction: 'asc' }] },
            filterState: { filters: [{ property: 'tag', operator: 'includes', value: ['x'] }], logic: 'and' },
        } as Partial<ListSectionParams>);
        const activeHeader = active.handle.root.find('sec__header');
        const [aSort, aFilter] = activeHeader.children.filter(c => c.tag === 'button');
        expect(aSort.classes.has('is-sorted')).toBe(true);
        expect(aFilter.classes.has('is-filtered')).toBe(true);
    });

    it('reports button clicks with the button as the anchor', () => {
        const anchors: string[] = [];
        const { handle } = render({
            onSortClick: (el) => anchors.push('sort:' + (el as unknown as FakeEl).tag),
            onFilterClick: (el) => anchors.push('filter:' + (el as unknown as FakeEl).tag),
            onMoreClick: (el) => anchors.push('more:' + (el as unknown as FakeEl).tag),
        });
        const buttons = handle.root.find('sec__header').children.filter(c => c.tag === 'button');
        buttons[0].fire('click');
        buttons[1].fire('click');
        buttons[2].fire('click');
        expect(anchors).toEqual(['sort:button', 'filter:button', 'more:button']);
    });
});

describe('renderListSection collapse', () => {
    it('paints the body once on the initial expanded render, without resetting paging', () => {
        const { calls } = render();
        expect(calls.bodies).toEqual([false]);
    });

    it('leaves the body empty while collapsed', () => {
        const { calls, handle } = render({ collapsed: true });
        expect(calls.bodies).toEqual([]);
        expect(handle.body.childElementCount).toBe(0);
    });

    it('paints on first manual expand, resetting paging to the first page', () => {
        const { calls, handle } = render({ collapsed: true });
        handle.root.find('sec__header').fire('click');
        expect(calls.bodies).toEqual([true]);
        expect(calls.collapsed).toEqual([false]);
        expect(handle.root.find('sec__toggle').textContent).toBe('▼');
    });

    it('does not repaint a body that already holds cards', () => {
        const { calls, handle } = render();          // painted once, expanded
        const header = handle.root.find('sec__header');
        header.fire('click');                        // collapse
        header.fire('click');                        // expand again
        expect(calls.bodies).toEqual([false]);       // no second paint
        expect(calls.collapsed).toEqual([true, false]);
    });

    it('does not paint an empty list on expand', () => {
        const { calls, handle } = render({ collapsed: true, taskCount: 0 });
        handle.root.find('sec__header').fire('click');
        expect(calls.bodies).toEqual([]);
    });
});

describe('startListSectionRename', () => {
    function setup(name = 'Today') {
        const { handle } = render({ name });
        const committed: string[] = [];
        startListSectionRename(
            handle.nameEl as unknown as HTMLElement,
            CLASSES,
            name,
            (n) => committed.push(n),
        );
        const input = handle.root.find('sec__name-input');
        return { handle, input, committed };
    }

    it('swaps the name for a focused, pre-selected input', () => {
        const { input } = setup();
        expect(input.tag).toBe('input');
        expect(input.value).toBe('Today');
        expect(input.focused).toBe(true);
        expect(input.selected).toBe(true);
    });

    it('commits the typed name on blur and restores a plain span', () => {
        const { handle, input, committed } = setup();
        input.value = 'Tomorrow';
        input.fire('blur');
        expect(committed).toEqual(['Tomorrow']);
        expect(handle.root.find('sec__name').textContent).toBe('Tomorrow');
    });

    it('keeps the old name when the input is cleared', () => {
        const { input, committed } = setup();
        input.value = '   ';
        input.fire('blur');
        expect(committed).toEqual(['Today']);
    });

    it('reverts on Escape instead of committing what was typed', () => {
        const { input, committed } = setup();
        input.value = 'discard me';
        input.fire('keydown', { key: 'Escape' });
        expect(committed).toEqual(['Today']);
    });

    it('commits only once even when blur follows Enter', () => {
        const { input, committed } = setup();
        input.value = 'Tomorrow';
        input.fire('keydown', { key: 'Enter' });
        input.fire('blur');
        input.fire('blur');
        expect(committed).toEqual(['Tomorrow']);
    });

    it('stops pointer events from reaching the header collapse handler', () => {
        const { input } = setup();
        for (const type of ['click', 'mousedown', 'pointerdown']) {
            expect(input.listeners.has(type)).toBe(true);
        }
    });
});
