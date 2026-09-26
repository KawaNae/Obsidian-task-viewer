import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskCardRenderer } from '../../../src/views/taskcard/TaskCardRenderer';
import { heldBy, holdCard } from '../../../src/views/taskcard/CardHold';
import { CardReconciler } from '../../../src/views/sharedUI/CardReconciler';
import { MenuHandler } from '../../../src/interaction/menu/MenuHandler';
import { DragRouter } from '../../../src/interaction/drag/DragRouter';
import { HandleManager } from '../../../src/views/sharedUI/handles/HandleManager';
import { makeTask } from '../helpers/makeTask';
import type { ChildEntry, DisplayTask, Task, TaskViewerSettings } from '../../../src/types';

/**
 * A card is kept across readings of its file (its signature leaves the name
 * out, and the reconciler finds it by what it shows), so what it binds never
 * holds a name: each handler reads the hold, which every draw sets to the task
 * it draws.
 *
 * The cards here are drawn once from one reading, then drawn again from the
 * next reading of the same content under new names, and used. Every write and
 * every callback must carry the new name.
 *
 * Vitest runs in node without a DOM, so the card is drawn into a stand-in
 * that has only what the renderer touches, with the few selectors it asks.
 */

// ── A stand-in for the DOM ───────────────────────────────────

type Listener = (e: FakeEvent) => void;
interface FakeEvent {
    target?: FakeEl;
    clientX?: number;
    clientY?: number;
    pageX?: number;
    pageY?: number;
    preventDefault(): void;
    stopPropagation(): void;
}

class FakeEl {
    tagName: string;
    classes = new Set<string>();
    dataset: Record<string, string> = {};
    attrs = new Map<string, string>();
    children: FakeEl[] = [];
    parentElement: FakeEl | null = null;
    listeners = new Map<string, Listener[]>();
    checked = false;
    textContent = '';
    innerHTML = '';
    style: Record<string, string> = {};
    classList = {
        add: (...cs: string[]) => cs.forEach(c => this.classes.add(c)),
        remove: (...cs: string[]) => cs.forEach(c => this.classes.delete(c)),
        contains: (c: string) => this.classes.has(c),
        toggle: (c: string, on?: boolean) => { this.toggleClass(c, on ?? !this.classes.has(c)); },
    };

    constructor(tag = 'div', cls = '') {
        this.tagName = tag;
        cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
    }

    get firstChild(): FakeEl | null { return this.children[0] ?? null; }
    get className(): string { return [...this.classes].join(' '); }
    set className(cls: string) { this.classes = new Set(cls.split(/\s+/).filter(Boolean)); }
    get isConnected(): boolean { return true; }

    createDiv(cls = ''): FakeEl { return this.appendChild(new FakeEl('div', cls)); }
    createSpan(cls = ''): FakeEl { return this.appendChild(new FakeEl('span', cls)); }
    addClass(c: string): void { this.classes.add(c); }
    removeClass(c: string): void { this.classes.delete(c); }
    hasClass(c: string): boolean { return this.classes.has(c); }
    toggleClass(c: string, on: boolean): void { if (on) this.classes.add(c); else this.classes.delete(c); }
    setText(t: string): void { this.textContent = t; }
    empty(): void { this.children.forEach(c => { c.parentElement = null; }); this.children = []; }

    appendChild(el: FakeEl): FakeEl {
        el.remove();
        el.parentElement = this;
        this.children.push(el);
        return el;
    }
    insertBefore(el: FakeEl, ref: FakeEl | null): FakeEl {
        el.remove();
        const at = ref ? this.children.indexOf(ref) : -1;
        el.parentElement = this;
        if (at < 0) this.children.push(el); else this.children.splice(at, 0, el);
        return el;
    }
    remove(): void {
        if (!this.parentElement) return;
        const siblings = this.parentElement.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentElement = null;
    }

    getAttribute(name: string): string | null {
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            if (key in this.dataset) return this.dataset[key];
        }
        return this.attrs.get(name) ?? null;
    }
    setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
    removeAttribute(name: string): void { this.attrs.delete(name); }
    getBoundingClientRect() { return { left: 0, bottom: 0, top: 0, right: 0 }; }

    addEventListener(type: string, fn: Listener): void {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }
    removeEventListener(type: string, fn: Listener): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn));
    }
    /** Fire `type` at this element only (no bubbling), as a user would. */
    fire(type: string, init: Partial<FakeEvent> = {}): void {
        const e: FakeEvent = { target: this, clientX: 0, clientY: 0, pageX: 0, pageY: 0, preventDefault() {}, stopPropagation() {}, ...init };
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    }

    matches(selector: string): boolean { return matchesList(this, selector, this); }
    closest(selector: string): FakeEl | null {
        for (let el: FakeEl | null = this; el; el = el.parentElement) if (matchesList(el, selector, el)) return el;
        return null;
    }
    querySelectorAll(selector: string): FakeEl[] {
        const out: FakeEl[] = [];
        const walk = (el: FakeEl) => {
            for (const c of el.children) {
                if (matchesList(c, selector, this)) out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }
    querySelector(selector: string): FakeEl | null { return this.querySelectorAll(selector)[0] ?? null; }
}

/** One compound selector: `tag.class[attr="v"]:not(.class)`, or `:scope`. */
function matchesCompound(el: FakeEl, compound: string, scope: FakeEl): boolean {
    if (compound === ':scope') return el === scope;
    let rest = compound;
    const tag = rest.match(/^[a-z]+/);
    if (tag) {
        if (el.tagName !== tag[0]) return false;
        rest = rest.slice(tag[0].length);
    }
    const parts = rest.match(/\.[\w-]+|\[[^\]]+\]|:not\([^)]*\)/g) ?? [];
    for (const part of parts) {
        if (part.startsWith('.')) {
            if (!el.classes.has(part.slice(1))) return false;
        } else if (part.startsWith('[')) {
            const m = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/)!;
            const value = el.getAttribute(m[1]);
            if (value === null || (m[2] !== undefined && value !== m[2])) return false;
        } else {
            if (matchesCompound(el, part.slice(5, -1), scope)) return false;
        }
    }
    return true;
}

/** A complex selector (compounds joined by ` ` or ` > `), matched right to left. */
function matchesComplex(el: FakeEl, selector: string, scope: FakeEl): boolean {
    const tokens = selector.trim().split(/\s+/);
    const go = (node: FakeEl, i: number): boolean => {
        if (!matchesCompound(node, tokens[i], scope)) return false;
        if (i === 0) return true;
        if (tokens[i - 1] === '>') {
            return !!node.parentElement && go(node.parentElement, i - 2);
        }
        for (let up = node.parentElement; up; up = up.parentElement) if (go(up, i - 1)) return true;
        return false;
    };
    return go(el, tokens.length - 1);
}

function matchesList(el: FakeEl, selectors: string, scope: FakeEl): boolean {
    return selectors.split(',').some(s => matchesComplex(el, s, scope));
}

/**
 * Markdown as the stand-in draws it: one list, a `li.task-list-item` with a
 * checkbox per `- [c]` line, a plain `li` per other `- ` line.
 */
function drawMarkdown(markdown: string, el: FakeEl): void {
    const ul = el.appendChild(new FakeEl('ul'));
    for (const line of markdown.split('\n')) {
        const task = line.match(/^\s*- \[(.)\] (.*)$/);
        if (task) {
            const li = ul.appendChild(new FakeEl('li', 'task-list-item'));
            const box = li.appendChild(new FakeEl('input', 'task-list-item-checkbox'));
            box.setAttribute('type', 'checkbox');
            box.checked = task[1] !== ' ';
            if (task[1] !== ' ') { box.setAttribute('data-task', task[1]); li.setAttribute('data-task', task[1]); }
            li.textContent = task[2];
            continue;
        }
        const item = line.match(/^\s*- (.*)$/);
        if (item) ul.appendChild(new FakeEl('li')).textContent = item[1];
    }
}

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('obsidian');
    class Component {
        load() {}
        unload() {}
        addChild<T>(c: T): T { return c; }
        removeChild<T>(c: T): T { return c; }
        register(_fn: () => void) {}
    }
    return {
        ...actual,
        Component,
        MarkdownRenderer: {
            render: async (_app: unknown, markdown: string, el: FakeEl) => { drawMarkdown(markdown, el); },
        },
    };
});

beforeEach(() => {
    vi.stubGlobal('document', {
        createElement: (tag: string) => new FakeEl(tag),
        createDocumentFragment: () => new FakeEl('fragment'),
    });
});

// ── Two readings of one file ───────────────────────────────────

/** A parent row and its child row, named by one reading of their file. */
const OLD = { parent: 'tv-inline:a.md:n:0:2:40:0000000000000001', child: 'tv-inline:a.md:n:1:2:40:0000000000000001' };
/** The same rows, named by the next reading (another content key). */
const NOW = { parent: 'tv-inline:a.md:n:0:2:41:0000000000000002', child: 'tv-inline:a.md:n:1:2:41:0000000000000002' };
type Reading = typeof OLD;

/** An index over one reading at a time: a name of another reading answers nothing. */
function index() {
    let reading: Reading = OLD;
    const tasks = () => {
        const child = { ...makeTask({ id: reading.child, file: 'a.md', line: 1, content: 'child' }), childEntries: [] as ChildEntry[] };
        const parent = {
            ...makeTask({ id: reading.parent, file: 'a.md', line: 0, content: 'parent' }),
            childEntries: [{ kind: 'task', taskId: reading.child, bodyLine: 1 }] as ChildEntry[],
        };
        return new Map<string, Task>([[parent.id, parent], [child.id, child]]);
    };
    const readService = {
        getTask: (id: string) => tasks().get(id),
        getDisplayTask: (id: string) => tasks().get(id),
        getChildEntries: (task: Task) => (task as DisplayTask).childEntries ?? [],
    };
    return {
        readService,
        read(next: Reading) { reading = next; },
        /** The parent as a view hands it to the renderer. */
        drawn(): DisplayTask {
            const parent = tasks().get(reading.parent)!;
            return { ...parent, effectiveStartDate: '', originalTaskId: parent.id, isSplit: false } as unknown as DisplayTask;
        },
    };
}

function settingsWith(overrides: Partial<TaskViewerSettings> = {}): TaskViewerSettings {
    return {
        startHour: 0,
        childCollapseThreshold: 5,
        enableCardFileLink: false,
        enableStatusMenu: true,
        statusDefinitions: [
            { char: ' ', label: 'Todo', isComplete: false },
            { char: 'x', label: 'Done', isComplete: true },
        ],
        ...overrides,
    } as unknown as TaskViewerSettings;
}

function setup(settings = settingsWith()) {
    const idx = index();
    const writes: { id: string; updates: Record<string, unknown> }[] = [];
    const writeService = {
        updateTask: vi.fn(async (id: string, updates: Record<string, unknown>) => { writes.push({ id, updates }); return true; }),
        onTaskDeleted: () => () => {},
    };
    let menu: ((m: unknown) => void) | null = null;
    const menuPresenter = { present: (build: (m: unknown) => void) => { menu = build; } };
    const renderer = new TaskCardRenderer(
        {} as never, idx.readService as never, writeService as never, menuPresenter as never,
        { hoverSource: 'test', getHoverParent: () => ({}) } as never,
        () => settings,
    );
    const card = new FakeEl('div', 'task-card');
    const key = (r: Reading) => `kanban::cell-1::${r.parent}`;
    const draw = (r: Reading) => {
        idx.read(r);
        return renderer.render(card as unknown as HTMLElement, idx.drawn(), settings, { cardInstanceId: key(r), topRight: { mode: 'none' } });
    };
    /** Pick the first item of the status menu last opened. */
    const pickStatus = async () => {
        const items: (() => Promise<void>)[] = [];
        const item = { setTitle: () => item, onClick: (fn: () => Promise<void>) => { items.push(fn); return item; } };
        menu!({ addItem: (cb: (i: typeof item) => void) => cb(item) });
        await items[0]();
    };
    return { renderer, card, writes, draw, key, pickStatus };
}

/** Draw from OLD, then from NOW; the card must be kept, not drawn anew. */
async function keptAcrossAReading(s: ReturnType<typeof setup>) {
    await s.draw(OLD);
    const content = s.card.querySelector(':scope > .task-card__content');
    await s.draw(NOW);
    expect(s.card.querySelector(':scope > .task-card__content')).toBe(content);
    return content!;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// ── The card's handlers ───────────────────────────────────

describe('a card kept across a reading', () => {
    it('ticks its task by the name it has now', async () => {
        const s = setup();
        const content = await keptAcrossAReading(s);
        const box = content.querySelectorAll('input[type="checkbox"]')[0];

        box.checked = true;
        box.fire('click');
        await settle();

        expect(s.writes).toEqual([{ id: NOW.parent, updates: { statusChar: 'x' } }]);
    });

    it('sets its task\'s status from the menu by the name it has now', async () => {
        const s = setup();
        const content = await keptAcrossAReading(s);

        content.querySelectorAll('input[type="checkbox"]')[0].fire('contextmenu');
        await s.pickStatus();

        expect(s.writes.map(w => w.id)).toEqual([NOW.parent]);
    });

    it('ticks a child by the name the child has now', async () => {
        const s = setup();
        const content = await keptAcrossAReading(s);
        const box = content.querySelectorAll('input[type="checkbox"]')[1];

        box.checked = true;
        box.fire('click');
        await settle();

        expect(s.writes).toEqual([{ id: NOW.child, updates: { statusChar: 'x' } }]);
    });

    it('sets a child\'s status from the menu by the name the child has now', async () => {
        const s = setup();
        const content = await keptAcrossAReading(s);

        content.querySelectorAll('input[type="checkbox"]')[1].fire('contextmenu');
        await s.pickStatus();

        expect(s.writes.map(w => w.id)).toEqual([NOW.child]);
    });

    it('opens a child\'s menu by the name the child has now', async () => {
        const s = setup();
        const opened = vi.fn();
        s.renderer.setChildMenuCallback(opened);
        const content = await keptAcrossAReading(s);

        content.querySelector('.task-card__child-menu-btn')!.fire('click');

        expect(opened).toHaveBeenCalledWith(NOW.child, 0, 0);
    });

    it.each(['menu', 'open', 'detail'] as const)('hands the task it has now to a double tap (%s)', async (action) => {
        const s = setup();
        const got: Task[] = [];
        s.renderer.setContextMenuCallback((task) => got.push(task));
        s.renderer.setOpenInEditorCallback((task) => got.push(task));
        s.renderer.setDetailCallback((task) => got.push(task));
        s.renderer.setDoubleTapActionGetter(() => action);
        await keptAcrossAReading(s);

        const target = new FakeEl('span');
        s.card.fire('click', { target });
        s.card.fire('click', { target });

        expect(got.map(t => t.id)).toEqual([NOW.parent]);
    });

    it('keeps a collapsed section\'s expansion under the key it has now', async () => {
        const s = setup(settingsWith({ childCollapseThreshold: 1 }));
        const content = await keptAcrossAReading(s);

        content.querySelector('.task-card__children-toggle')!.fire('click');

        const expanded = (s.renderer as unknown as { expandedTaskIds: Set<string> }).expandedTaskIds;
        expect([...expanded]).toEqual([s.key(NOW)]);
    });

    it('ticks a child in a collapsed section by the name the child has now', async () => {
        const s = setup(settingsWith({ childCollapseThreshold: 1 }));
        const content = await keptAcrossAReading(s);
        const box = content.querySelector('.task-card__children')!.querySelectorAll('input[type="checkbox"]')[0];

        box.checked = true;
        box.fire('click');
        await settle();

        expect(s.writes).toEqual([{ id: NOW.child, updates: { statusChar: 'x' } }]);
    });

    it('acts by the name of its last draw until it is drawn again', async () => {
        const s = setup();
        await s.draw(OLD);
        const box = s.card.querySelectorAll('input[type="checkbox"]')[0];

        box.checked = true;
        box.fire('click');
        await settle();

        // The file was read again, the card not yet drawn: the write goes by
        // the name the card shows, and the write layer refuses or follows it.
        expect(s.writes.map(w => w.id)).toEqual([OLD.parent]);
        expect(heldBy(s.card as unknown as HTMLElement)!.name).toBe(OLD.parent);
    });
});

describe('a card whose DOM a user\'s action changed', () => {
    // The card is drawn next for a row that shows what it showed before the
    // action — a twin that took the card, or the row whose write did not
    // land yet — so its signature is the same. It is drawn anew all the same.

    it('is drawn anew after its box was ticked', async () => {
        const s = setup();
        await s.draw(OLD);
        const box = s.card.querySelectorAll('input[type="checkbox"]')[0];
        box.checked = true;
        box.fire('click');
        await settle();

        await s.draw(OLD);
        expect(s.card.querySelectorAll('input[type="checkbox"]')[0].checked).toBe(false);
    });

    it('is drawn anew after a child\'s box was ticked', async () => {
        const s = setup();
        await s.draw(OLD);
        const box = s.card.querySelectorAll('input[type="checkbox"]')[1];
        box.checked = true;
        box.fire('click');
        await settle();

        await s.draw(OLD);
        expect(s.card.querySelectorAll('input[type="checkbox"]')[1].checked).toBe(false);
    });

    it('is drawn anew after its children were opened', async () => {
        const s = setup(settingsWith({ childCollapseThreshold: 1 }));
        await s.draw(OLD);
        s.card.querySelector('.task-card__children-toggle')!.fire('click');
        expect(s.card.querySelector('.task-card__children')!.hasClass('task-card__children--expanded')).toBe(true);

        // The next reading's key is not the one opened, and the index does
        // not follow the old name to it: the card is drawn closed.
        await s.draw(NOW);
        expect(s.card.querySelector('.task-card__children')!.hasClass('task-card__children--collapsed')).toBe(true);
    });
});

describe('the card\'s context menu', () => {
    it('opens for the task of the card\'s latest draw', () => {
        const handler = Object.create(MenuHandler.prototype) as MenuHandler;
        const shown: Task[] = [];
        Object.assign(handler, {
            boundCards: new WeakSet(),
            plugin: { settings: { longPressThreshold: 500 } },
            showContextMenu: (_x: number, _y: number, task: Task) => { shown.push(task); },
        });
        const card = new FakeEl('div', 'task-card') as unknown as HTMLElement;
        const drawn = (id: string) => ({ ...makeTask({ id }), originalTaskId: id }) as unknown as DisplayTask;

        holdCard(card, drawn(OLD.parent), 'k', []);
        handler.addTaskContextMenu(card);
        holdCard(card, drawn(NOW.parent), 'k', []);
        (card as unknown as FakeEl).fire('contextmenu');

        expect(shown.map(t => t.id)).toEqual([NOW.parent]);
    });
});

// ── Finding a kept card ───────────────────────────────────

describe('the reconciler', () => {
    const drawn = (id: string, content = 'same', statusChar = ' ') =>
        ({ ...makeTask({ id, file: 'a.md', content, statusChar }), originalTaskId: id }) as unknown as DisplayTask;

    /** A scope holding one card per task, drawn under `scope::name`. */
    function scopeWith(tasks: DisplayTask[]) {
        const scope = new FakeEl('div');
        const cards = tasks.map(task => {
            const card = scope.createDiv('task-card');
            card.dataset.cardInstanceId = `lane::${task.id}`;
            holdCard(card as unknown as HTMLElement, task, card.dataset.cardInstanceId, []);
            return card;
        });
        const reconciler = new CardReconciler();
        reconciler.detach(scope as unknown as HTMLElement);
        return { reconciler, cards };
    }

    it('finds a card of the last reading by what it shows', () => {
        const { reconciler, cards } = scopeWith([drawn(OLD.parent)]);

        expect(reconciler.acquire(`lane::${NOW.parent}`, drawn(NOW.parent))).toBe(cards[0]);
        expect(reconciler.pendingCount).toBe(0);
    });

    it('gives twins the cards in the order they were drawn', () => {
        const { reconciler, cards } = scopeWith([drawn(OLD.parent), drawn(OLD.child)]);

        expect(reconciler.acquire(`lane::${NOW.parent}`, drawn(NOW.parent))).toBe(cards[0]);
        expect(reconciler.acquire(`lane::${NOW.child}`, drawn(NOW.child))).toBe(cards[1]);
    });

    it('finds none for a row that shows something else', () => {
        const { reconciler } = scopeWith([drawn(OLD.parent, 'before')]);

        expect(reconciler.acquire(`lane::${NOW.parent}`, drawn(NOW.parent, 'after'))).toBeUndefined();
        expect(reconciler.acquire(`lane::${NOW.parent}`, drawn(NOW.parent, 'before', 'x'))).toBeUndefined();
    });

    it('finds none in another scope', () => {
        const { reconciler } = scopeWith([drawn(OLD.parent)]);

        expect(reconciler.acquire(`other::${NOW.parent}`, drawn(NOW.parent))).toBeUndefined();
    });

    it('takes a card by its key first, and does not give it twice', () => {
        const { reconciler, cards } = scopeWith([drawn(OLD.parent), drawn(NOW.parent)]);

        expect(reconciler.acquire(`lane::${NOW.parent}`, drawn(NOW.parent))).toBe(cards[1]);
        expect(reconciler.acquire(`lane::${NOW.child}`, drawn(NOW.child))).toBe(cards[0]);
        expect(reconciler.acquire(`lane::x`, drawn('x'))).toBeUndefined();
    });
});

// ── Drag and handles ───────────────────────────────────

describe('a drag from a handle', () => {
    it('is for the task the card has now', () => {
        const getTask = vi.fn(() => undefined);
        const router = new DragRouter({ readService: { getTask } } as never, {} as never, new FakeEl() as never);
        const card = new FakeEl('div', 'task-card');
        holdCard(card as unknown as HTMLElement, makeTask({ id: NOW.parent }) as DisplayTask, 'k', []);
        const handle = card.createDiv('task-card__handle').createDiv('task-card__handle-btn');

        router.handle({ target: handle } as never);

        expect(getTask).toHaveBeenCalledWith(NOW.parent);
    });
});

describe('the handles', () => {
    it('leave a kept card that is no longer the selected task\'s', () => {
        const container = new FakeEl('div');
        const card = container.createDiv('task-card');
        holdCard(card as unknown as HTMLElement, makeTask({ id: NOW.parent }) as DisplayTask, 'k', []);
        card.createDiv('task-card__handle');
        const handles = new HandleManager(container as unknown as HTMLElement, { getTask: () => undefined, getStartHour: () => 0 });

        handles.selectTask(OLD.parent);

        expect(card.querySelectorAll('.task-card__handle')).toEqual([]);
    });
});
