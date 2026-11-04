import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskCardRenderer } from '../../../src/views/taskcard/TaskCardRenderer';
import { makeSegmentId } from '../../../src/services/display/SegmentIds';
import { heldBy, holdCard } from '../../../src/views/taskcard/CardHold';
import type { ExpandedCards } from '../../../src/views/taskcard/CardKey';
import { CardReconciler } from '../../../src/views/sharedUI/CardReconciler';
import { MenuHandler } from '../../../src/interaction/menu/MenuHandler';
import { DragRouter } from '../../../src/interaction/drag/DragRouter';
import { HandleManager } from '../../../src/views/sharedUI/handles/HandleManager';
import { makeTask } from '../helpers/makeTask';
import type { ChildEntry, DisplayTask, Task, TaskViewerSettings } from '../../../src/types';
import { FakeEl, stubCardDocument } from '../helpers/cardDom';

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
 * The card is drawn into the stand-in DOM of `helpers/cardDom`.
 */

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('obsidian');
    const dom = await import('../helpers/cardDom');
    return {
        ...actual,
        Component: dom.FakeComponent,
        MarkdownRenderer: {
            render: async (_app: unknown, markdown: string, el: FakeEl) => { dom.drawMarkdown(markdown, el); },
        },
    };
});

beforeEach(() => {
    stubCardDocument();
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
            return { ...parent, stated: {}, span: null, dueMs: null, drawn: null, originalTaskId: parent.id, isSplit: false };
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

/** What the cards do, each a recorder a test can replace. */
function recordingActions() {
    return {
        openDetail: vi.fn<(task: Task) => void>(),
        showMenu: vi.fn<(task: Task, x: number, y: number) => void>(),
        showChildMenu: vi.fn<(taskId: string, x: number, y: number) => void>(),
        openInEditor: vi.fn<(task: Task) => void>(),
        doubleTapAction: vi.fn<() => 'detail' | 'menu' | 'open'>(() => 'detail'),
        bindMenu: vi.fn<(card: HTMLElement) => void>(),
    };
}

function setup(settings = settingsWith(), actions = recordingActions()) {
    const idx = index();
    const writes: { id: string; updates: Record<string, unknown> }[] = [];
    const operations = {
        updateTask: vi.fn(async (id: string, updates: Record<string, unknown>) => { writes.push({ id, updates }); return true; }),
    };
    let menu: ((m: unknown) => void) | null = null;
    const menuPresenter = { present: (build: (m: unknown) => void) => { menu = build; } };
    const renderer = new TaskCardRenderer({
        app: {} as never,
        readService: idx.readService as never,
        index: { ...idx.readService, onTaskDeleted: () => () => {} } as never,
        operations: operations as never,
        menuPresenter: menuPresenter as never,
        linkRuntime: { hoverSource: 'test', getHoverParent: () => ({}) } as never,
        getSettings: () => settings,
        getMaskMode: () => false,
        actions,
    });
    const card = new FakeEl('div', 'task-card');
    const key = (r: Reading) => ({ scope: 'cell-1', name: r.parent });
    const draw = (r: Reading) => {
        idx.read(r);
        return renderer.render(card as unknown as HTMLElement, idx.drawn(), settings, { key: key(r), topRight: { mode: 'none' } });
    };
    /** Pick the first item of the status menu last opened. */
    const pickStatus = async () => {
        const items: (() => Promise<void>)[] = [];
        const item = { setTitle: () => item, onClick: (fn: () => Promise<void>) => { items.push(fn); return item; } };
        menu!({ addItem: (cb: (i: typeof item) => void) => cb(item) });
        await items[0]();
    };
    /** Draw the task of `r` changed by `patch`, under the key of OLD. */
    const drawPatched = (r: Reading, patch: Partial<Task>) => {
        idx.read(r);
        renderer.render(card as unknown as HTMLElement, { ...idx.drawn(), ...patch } as DisplayTask, settings, { key: key(OLD), topRight: { mode: 'none' } });
    };
    return { renderer, card, writes, draw, drawPatched, key, pickStatus, actions };
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
        const content = await keptAcrossAReading(s);

        content.querySelector('.task-card__child-menu-btn')!.fire('click');

        expect(s.actions.showChildMenu).toHaveBeenCalledWith(NOW.child, 0, 0);
    });

    it.each(['menu', 'open', 'detail'] as const)('hands the task it has now to a double tap (%s)', async (action) => {
        const got: Task[] = [];
        const actions = recordingActions();
        actions.showMenu.mockImplementation((task) => { got.push(task); });
        actions.openInEditor.mockImplementation((task) => { got.push(task); });
        actions.openDetail.mockImplementation((task) => { got.push(task); });
        actions.doubleTapAction.mockImplementation(() => action);
        const s = setup(settingsWith(), actions);
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

        const expanded = (s.renderer as unknown as { expanded: ExpandedCards }).expanded;
        expect(expanded.keys()).toEqual([s.key(NOW)]);
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

describe('a card drawn again', () => {
    it('takes off the color, the line style and the read-only mark its task lost', () => {
        const s = setup();
        s.drawPatched(OLD, { color: '#ff0000', linestyle: 'dashed', isReadOnly: true });
        expect(s.card.styles.get('--file-accent')).toBeDefined();
        expect(s.card.dataset.fileLinestyle).toBe('dashed');
        expect(s.card.dataset.readOnly).toBe('true');

        s.drawPatched(NOW, {});

        expect([...s.card.styles.keys()]).toEqual([]);
        expect(s.card.dataset.fileLinestyle).toBeUndefined();
        expect(s.card.dataset.readOnly).toBeUndefined();
    });

    it('is given its menu on every draw, kept or drawn anew', () => {
        const s = setup();
        s.drawPatched(OLD, {});
        s.drawPatched(OLD, {});

        expect(s.actions.bindMenu.mock.calls.map(c => c[0])).toEqual([s.card, s.card]);
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

        holdCard(card, drawn(OLD.parent), { scope: 's', name: OLD.parent }, []);
        handler.addTaskContextMenu(card);
        holdCard(card, drawn(NOW.parent), { scope: 's', name: NOW.parent }, []);
        (card as unknown as FakeEl).fire('contextmenu');

        expect(shown.map(t => t.id)).toEqual([NOW.parent]);
    });
});

// ── Finding a kept card ───────────────────────────────────

describe('the reconciler', () => {
    const drawn = (id: string, content = 'same', statusChar = ' ') =>
        ({ ...makeTask({ id, file: 'a.md', content, statusChar }), originalTaskId: id }) as unknown as DisplayTask;

    const lane = (name: string) => ({ scope: 'lane', name });

    /** A container holding one card per task, drawn in the place `lane`. */
    function scopeWith(tasks: DisplayTask[]) {
        const scope = new FakeEl('div');
        const cards = tasks.map(task => {
            const card = scope.createDiv('task-card');
            card.dataset.cardScope = 'lane';
            card.dataset.cardName = task.id;
            holdCard(card as unknown as HTMLElement, task, lane(task.id), []);
            return card;
        });
        const reconciler = new CardReconciler();
        reconciler.detach(scope as unknown as HTMLElement);
        return { reconciler, cards };
    }

    it('finds a card of the last reading by what it shows', () => {
        const { reconciler, cards } = scopeWith([drawn(OLD.parent)]);

        expect(reconciler.acquire(lane(NOW.parent), drawn(NOW.parent))).toBe(cards[0]);
        expect(reconciler.pendingCount).toBe(0);
    });

    it('gives twins the cards in the order they were drawn', () => {
        const { reconciler, cards } = scopeWith([drawn(OLD.parent), drawn(OLD.child)]);

        expect(reconciler.acquire(lane(NOW.parent), drawn(NOW.parent))).toBe(cards[0]);
        expect(reconciler.acquire(lane(NOW.child), drawn(NOW.child))).toBe(cards[1]);
    });

    it('finds none for a row that shows something else', () => {
        const { reconciler } = scopeWith([drawn(OLD.parent, 'before')]);

        expect(reconciler.acquire(lane(NOW.parent), drawn(NOW.parent, 'after'))).toBeUndefined();
        expect(reconciler.acquire(lane(NOW.parent), drawn(NOW.parent, 'before', 'x'))).toBeUndefined();
    });

    it('finds none in another scope', () => {
        const { reconciler } = scopeWith([drawn(OLD.parent)]);

        expect(reconciler.acquire({ scope: 'other', name: NOW.parent }, drawn(NOW.parent))).toBeUndefined();
    });

    it('finds a segment\'s card by its date, not another segment\'s', () => {
        const scope = new FakeEl('div');
        const segment = (id: string, date: string) => ({ ...drawn(id), id: makeSegmentId(id, date) }) as DisplayTask;
        const cards = ['2026-09-25', '2026-09-26'].map(date => {
            const card = scope.createDiv('task-card');
            card.dataset.cardScope = 'lane';
            holdCard(card as unknown as HTMLElement, segment(OLD.parent, date), lane(makeSegmentId(OLD.parent, date)), []);
            return card;
        });
        const reconciler = new CardReconciler();
        reconciler.detach(scope as unknown as HTMLElement);

        expect(reconciler.acquire(lane(makeSegmentId(NOW.parent, '2026-09-26')), segment(NOW.parent, '2026-09-26'))).toBe(cards[1]);
        expect(reconciler.acquire(lane(makeSegmentId(NOW.parent, '2026-09-25')), segment(NOW.parent, '2026-09-25'))).toBe(cards[0]);
    });

    it('takes a card by its key first, and does not give it twice', () => {
        const { reconciler, cards } = scopeWith([drawn(OLD.parent), drawn(NOW.parent)]);

        expect(reconciler.acquire(lane(NOW.parent), drawn(NOW.parent))).toBe(cards[1]);
        expect(reconciler.acquire(lane(NOW.child), drawn(NOW.child))).toBe(cards[0]);
        expect(reconciler.acquire(lane('x'), drawn('x'))).toBeUndefined();
    });
});

// ── Drag and handles ───────────────────────────────────

describe('a drag from a handle', () => {
    it('is for the task the card has now', () => {
        const getTask = vi.fn(() => undefined);
        const router = new DragRouter({ index: { getTask } } as never, {} as never, new FakeEl() as never);
        const card = new FakeEl('div', 'task-card');
        holdCard(card as unknown as HTMLElement, makeTask({ id: NOW.parent }) as DisplayTask, { scope: 's', name: NOW.parent }, []);
        const handle = card.createDiv('task-card__handle').createDiv('task-card__handle-btn');

        router.handle({ target: handle } as never);

        expect(getTask).toHaveBeenCalledWith(NOW.parent);
    });
});

describe('the handles', () => {
    it('leave a kept card that is no longer the selected task\'s', () => {
        const container = new FakeEl('div');
        const card = container.createDiv('task-card');
        holdCard(card as unknown as HTMLElement, makeTask({ id: NOW.parent }) as DisplayTask, { scope: 's', name: NOW.parent }, []);
        card.createDiv('task-card__handle');
        const handles = new HandleManager(container as unknown as HTMLElement, { getTask: () => undefined, getStartHour: () => 0 });

        handles.selectTask(OLD.parent);

        expect(card.querySelectorAll('.task-card__handle')).toEqual([]);
    });
});
