import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskCardRenderer, type RenderOptions } from '../../../../src/views/taskcard/TaskCardRenderer';
import { makeTask } from '../../helpers/makeTask';
import type { ChildEntry, DisplayTask, Task, TaskViewerSettings } from '../../../../src/types';
import { FakeEl, stubCardDocument } from '../../helpers/cardDom';

/**
 * A card nothing is done on, one drawn from its caller's rows
 * (`RenderOptions.rows`), which the index has none of to act on: none of what a card
 * binds to act on its task is bound, whatever the other policies say. Its
 * menu, its double tap, its checkbox and its children's, a child's ⋯, and
 * its links: a link is not followed. The card says so (`data-inert`), and
 * is inert (`inert`): its checkboxes and links take no press, nor the focus
 * a keyboard would press them by.
 *
 * Each is checked against the same card drawn with things done on it, so a
 * binding the test does not see would show there.
 */

const { openLink } = vi.hoisted(() => ({ openLink: vi.fn() }));
vi.mock('../../../../src/utils/NavigationUtils', () => ({ openLink }));

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('obsidian');
    const dom = await import('../../helpers/cardDom');
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
    openLink.mockClear();
});

const PARENT = 'tv-inline:a.md:n:0:2:40:0000000000000001';
const CHILD = 'tv-inline:a.md:n:1:2:40:0000000000000001';

const settings = {
    startHour: 0,
    childCollapseThreshold: 5,
    enableCardFileLink: true,
    enableStatusMenu: true,
    reuseExistingTab: true,
    statusDefinitions: [
        { char: ' ', label: 'Todo', isComplete: false },
        { char: 'x', label: 'Done', isComplete: true },
    ],
} as unknown as TaskViewerSettings;

/**
 * A card of a parent with one child task, drawn with `options`; `collapse`
 * draws its children in the collapsed section, and `fromRows` draws it from
 * its rows handed in (`RenderOptions.rows`) in place of the index.
 */
function draw(options: Partial<RenderOptions>, collapse = false, fromRows = false) {
    const child = { ...makeTask({ id: CHILD, file: 'a.md', line: 1, content: 'child' }), childEntries: [] as ChildEntry[] };
    const parent = {
        ...makeTask({ id: PARENT, file: 'a.md', line: 0, content: 'parent [[b]]', childIds: [CHILD] }),
        childEntries: [{ kind: 'task', taskId: CHILD, bodyLine: 1 }] as ChildEntry[],
    };
    const tasks = new Map<string, Task>([[PARENT, parent], [CHILD, child]]);
    const readService = {
        getTask: (id: string) => tasks.get(id),
        getDisplayTask: (id: string) => tasks.get(id),
        getChildEntries: (task: Task) => (task as DisplayTask).childEntries ?? [],
    };
    const actions = {
        openDetail: vi.fn(),
        showMenu: vi.fn(),
        showChildMenu: vi.fn(),
        openInEditor: vi.fn(),
        doubleTapAction: vi.fn(() => 'detail' as const),
        bindMenu: vi.fn(),
    };
    const updateTask = vi.fn(async () => ({ written: true }));
    const renderer = new TaskCardRenderer({
        app: { workspace: { trigger: () => { } } } as never,
        readService: readService as never,
        index: { ...readService, onTaskDeleted: () => () => { } } as never,
        operations: { updateTask } as never,
        menuPresenter: { present: vi.fn() } as never,
        linkRuntime: { hoverSource: 'test', getHoverParent: () => ({}) } as never,
        getSettings: () => settings,
        getMaskMode: () => false,
        actions,
    });
    const card = new FakeEl('div', 'task-card');
    const shown: DisplayTask = { ...parent, stated: {}, span: null, dueMs: null, drawn: null, originalTaskId: PARENT, isSplit: false } as DisplayTask;
    renderer.render(card as unknown as HTMLElement, shown, { ...settings, childCollapseThreshold: collapse ? 1 : 5 }, {
        key: { scope: 'hub', name: PARENT },
        topRight: { mode: 'none' },
        alwaysLinks: true,
        ...options,
        ...(fromRows && { rows: (id: string) => tasks.get(id) }),
    });
    return {
        card,
        actions,
        updateTask,
        boxes: card.querySelectorAll('input'),
        links: card.querySelectorAll('a.internal-link'),
        menuButtons: card.querySelectorAll('.task-card__child-menu-btn'),
    };
}

const clickListeners = (el: FakeEl) => el.listeners.get('click')?.length ?? 0;

describe('a card things are done on', () => {
    it('binds its menu and its double tap, wires each checkbox, draws a child\'s ⋯, and follows its links', () => {
        const c = draw({});
        expect(c.card.dataset.inert).toBeUndefined();
        expect(c.card.getAttribute('inert')).toBeNull();
        expect(c.actions.bindMenu).toHaveBeenCalledTimes(1);
        expect(clickListeners(c.card)).toBeGreaterThan(0);
        expect(c.boxes).toHaveLength(2);
        expect(c.boxes.every(box => clickListeners(box) > 0)).toBe(true);
        expect(c.menuButtons).toHaveLength(1);

        c.boxes[0].fire('click');
        expect(c.updateTask).toHaveBeenCalledTimes(1);
        c.links[0].fire('click');
        expect(openLink).toHaveBeenCalledTimes(1);
    });
});

describe('a card drawn from rows handed in, nothing done on it', () => {
    for (const collapse of [false, true]) {
        it(`binds no menu nor double tap, wires no checkbox, draws no child's ⋯, and follows no link${collapse ? ', its children collapsed' : ''}`, () => {
            const c = draw({ doubleTap: true }, collapse, true);
            expect(c.card.dataset.inert).toBe('true');
            expect(c.card.getAttribute('inert')).toBe('');
            expect(c.actions.bindMenu).not.toHaveBeenCalled();
            expect(clickListeners(c.card)).toBe(0);
            expect(c.boxes).toHaveLength(2);
            expect(c.boxes.every(box => (box.listeners.size) === 0)).toBe(true);
            expect(c.menuButtons).toHaveLength(0);

            for (const box of c.boxes) box.fire('click');
            expect(c.updateTask).not.toHaveBeenCalled();
            expect(c.links.length).toBeGreaterThan(0);
            for (const link of c.links) {
                const preventDefault = vi.fn();
                link.fire('click', { preventDefault });
                expect(preventDefault).toHaveBeenCalled();
            }
            expect(openLink).not.toHaveBeenCalled();
        });
    }
});
