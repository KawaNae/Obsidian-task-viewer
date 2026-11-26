import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskCardRenderer, type RenderOptions } from '../../../../src/views/taskcard/TaskCardRenderer';
import { buildChildEntries } from '../../../../src/services/data/ChildEntryBuilder';
import { toDisplayTask, type TaskLookup } from '../../../../src/services/display/DisplayTaskConverter';
import { makeTask } from '../../helpers/makeTask';
import type { Task, TaskViewerSettings } from '../../../../src/types';
import { FakeEl, stubCardDocument } from '../../helpers/cardDom';

/**
 * A card drawn from the rows its caller hands in (`RenderOptions.rows`), in
 * place of the index: its children and theirs, the counts of how many are
 * done, and the overdue mark that a child not done keeps, are all of those
 * rows. The index holds the same names in another state, which none of the
 * card shows. Drawn with no rows, the card is the index's.
 */

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
});

const PARENT = 'tv-inline:a.md:n:0';
const CHILD = 'tv-outside:a.md:1';
const GRAND = 'tv-outside:a.md:2';

const settings = {
    startHour: 0,
    childCollapseThreshold: 5,
    enableCardFileLink: false,
    statusDefinitions: [
        { char: ' ', label: 'Todo', isComplete: false },
        { char: 'x', label: 'Done', isComplete: true },
    ],
} as unknown as TaskViewerSettings;

/** A tree of the parent, done and past its due, a child and its child, each named and in the state `child` and `grand` say. */
function tree(child: Partial<Task>, grand: Partial<Task>): Map<string, Task> {
    return new Map<string, Task>([
        [PARENT, makeTask({ id: PARENT, file: 'a.md', line: 0, content: 'parent', statusChar: 'x', due: '2020-01-01', childIds: [CHILD] })],
        [CHILD, makeTask({ id: CHILD, file: 'a.md', line: 1, parentId: PARENT, childIds: [GRAND], ...child })],
        [GRAND, makeTask({ id: GRAND, file: 'a.md', line: 2, parentId: CHILD, ...grand })],
    ]);
}

/** The index: every child done. */
const indexRows = tree({ content: 'child of the index', statusChar: 'x' }, { content: 'grandchild of the index', statusChar: 'x' });
/** The caller's rows: of the same names, none done. */
const draftRows = tree({ content: 'child of the draft', statusChar: ' ' }, { content: 'grandchild of the draft', statusChar: ' ' });

/** Draw the parent with `options`, from `rows` when given (and the parent of those), else from the index. */
function draw(options: Partial<RenderOptions>, rows?: Map<string, Task>, threshold = 5) {
    const indexLookup: TaskLookup = (id) => indexRows.get(id);
    const readService = {
        getChildEntries: (task: Task) => buildChildEntries(task, indexLookup),
        getDisplayTask: (id: string) => { const row = indexLookup(id); return row && toDisplayTask(row, 0, indexLookup); },
    };
    const bindMenu = vi.fn();
    const renderer = new TaskCardRenderer({
        app: { workspace: { trigger: () => { } } } as never,
        readService: readService as never,
        index: { getTask: indexLookup, onTaskDeleted: () => () => { } } as never,
        operations: { updateTask: vi.fn() } as never,
        menuPresenter: { present: vi.fn() } as never,
        linkRuntime: { hoverSource: 'test', getHoverParent: () => ({}) } as never,
        getSettings: () => settings,
        getMaskMode: () => false,
        actions: {
            openDetail: vi.fn(), showMenu: vi.fn(), showChildMenu: vi.fn(), openInEditor: vi.fn(),
            doubleTapAction: vi.fn(() => 'detail' as const), bindMenu,
        },
    });
    const lookup: TaskLookup | undefined = rows && ((id) => rows.get(id));
    const shown = toDisplayTask((rows ?? indexRows).get(PARENT)!, 0, lookup ?? indexLookup);
    const card = new FakeEl('div', 'task-card');
    renderer.render(card as unknown as HTMLElement, shown, { ...settings, childCollapseThreshold: threshold }, {
        key: { scope: 'hub', name: PARENT },
        topRight: { mode: 'none' },
        ...options,
        ...(lookup && { rows: lookup }),
    });
    return {
        card,
        bindMenu,
        text: card.querySelector('.task-card__content')!.textContent,
        count: card.querySelector('.task-card__child-count')?.textContent ?? null,
        toggle: card.querySelector('.task-card__children-toggle')?.innerHTML ?? null,
    };
}

describe('a card drawn from rows handed in', () => {
    it('shows the children and theirs of those rows, never the index\'s of the same names', () => {
        const c = draw({}, draftRows);
        expect(c.text).toContain('child of the draft');
        expect(c.text).toContain('grandchild of the draft');
        expect(c.text).not.toContain('of the index');
    });

    it('counts the children done among those rows, the compact card\'s count and the collapsed section\'s', () => {
        expect(draw({ compact: true }, draftRows).count).toBe('🚨 0/1');
        expect(draw({}, draftRows, 1).toggle).toContain('🚨 0/2');
    });

    it('is overdue as the children of those rows keep it, a done parent past its due with one not done', () => {
        const c = draw({}, draftRows);
        expect(c.card.dataset.overdue).toBe('past-due');
        expect(c.card.dataset.overdueCause).toBe('child');
    });

    it('is one nothing is done on, with nothing more asked', () => {
        const c = draw({}, draftRows);
        expect(c.card.dataset.inert).toBe('true');
        expect(c.bindMenu).not.toHaveBeenCalled();
    });
});

describe('a card drawn with no rows handed in', () => {
    it('reads the index: its children, their counts, no overdue mark as they are done, and it is acted on', () => {
        const c = draw({});
        expect(c.text).toContain('child of the index');
        expect(c.text).toContain('grandchild of the index');
        expect(c.text).not.toContain('of the draft');
        expect(draw({ compact: true }).count).toBe('1/1');
        expect(draw({}, undefined, 1).toggle).toContain('2/2');
        expect(c.card.dataset.overdue).toBeUndefined();
        expect(c.card.dataset.inert).toBeUndefined();
        expect(c.bindMenu).toHaveBeenCalledTimes(1);
    });
});
