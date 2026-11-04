import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskCardRenderer, type RenderOptions } from '../../../../src/views/taskcard/TaskCardRenderer';
import { makeTask } from '../../helpers/makeTask';
import { FakeEl, FakeText, stubCardDocument } from '../../helpers/cardDom';
import type { ChildEntry, DisplayTask, Task, TaskViewerSettings } from '../../../../src/types';

/**
 * The link to a card's note. Obsidian is handed the task's line alone (its
 * status, overdue mark and name) and the card puts the link into what it
 * drew, at the end of the parent's line: ` : ` and an `a.internal-link` in a
 * `task-card__file-link`. Written into the markdown after the name, the
 * link's path was read with the name as one inline, and an `_` in each made
 * an emphasis that took the link apart.
 *
 * Every way a card is drawn ends in the same line: alone, compact, with its
 * children under the line, and with them collapsed.
 */

const drawn: string[] = [];

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('obsidian');
    const dom = await import('../../helpers/cardDom');
    return {
        ...actual,
        Component: dom.FakeComponent,
        MarkdownRenderer: {
            render: async (_app: unknown, markdown: string, el: FakeEl) => {
                drawn.push(markdown);
                dom.drawMarkdown(markdown, el);
            },
        },
    };
});

beforeEach(() => {
    drawn.length = 0;
    stubCardDocument();
});

const FILE = 'KnowledgeNotes/イラスト_絵の練習.md';
const TARGET = 'KnowledgeNotes/イラスト_絵の練習';
const NAME = 'イラスト練習_2026-11-05';

function settingsWith(overrides: Partial<TaskViewerSettings> = {}): TaskViewerSettings {
    return {
        startHour: 0,
        childCollapseThreshold: 3,
        enableCardFileLink: true,
        enableStatusMenu: true,
        reuseExistingTab: false,
        statusDefinitions: [
            { char: ' ', label: 'Todo', isComplete: false },
            { char: 'x', label: 'Done', isComplete: true },
        ],
        ...overrides,
    } as unknown as TaskViewerSettings;
}

/** A parent in `FILE` with `children` child tasks, as a view hands it over. */
function scene(patch: Partial<Task> = {}, children = 0) {
    const kids = Array.from({ length: children }, (_, i) => ({
        ...makeTask({ id: `kid-${i}`, file: FILE, line: i + 1, content: `子_${i}` }),
        childEntries: [] as ChildEntry[],
    }));
    const parent = {
        ...makeTask({ id: 'parent', file: FILE, line: 0, content: NAME, ...patch }),
        childEntries: kids.map(k => ({ kind: 'task', taskId: k.id, bodyLine: k.line })) as ChildEntry[],
    };
    const tasks = new Map<string, Task>([[parent.id, parent], ...kids.map(k => [k.id, k] as [string, Task])]);
    const readService = {
        getTask: (id: string) => tasks.get(id),
        getDisplayTask: (id: string) => tasks.get(id),
        getChildEntries: (task: Task) => (task as DisplayTask).childEntries ?? [],
    };
    const display: DisplayTask = { ...parent, stated: {}, span: null, dueMs: null, drawn: null, originalTaskId: parent.id, isSplit: false } as unknown as DisplayTask;
    return { readService, display };
}

function setup(s: ReturnType<typeof scene>, opts: { masked?: boolean; settings?: TaskViewerSettings } = {}) {
    const settings = opts.settings ?? settingsWith();
    const workspace = { trigger: vi.fn(), openLinkText: vi.fn(async () => {}) };
    const renderer = new TaskCardRenderer({
        app: { workspace } as never,
        readService: s.readService as never,
        index: { ...s.readService, onTaskDeleted: () => () => {} } as never,
        operations: { updateTask: vi.fn(async () => true) } as never,
        menuPresenter: { present: () => {} } as never,
        linkRuntime: { hoverSource: 'test', getHoverParent: () => ({}) } as never,
        getSettings: () => settings,
        getMaskMode: () => opts.masked ?? false,
        actions: {
            openDetail: vi.fn(), showMenu: vi.fn(), showChildMenu: vi.fn(), openInEditor: vi.fn(),
            doubleTapAction: () => 'detail', bindMenu: vi.fn(),
        },
    });
    const card = new FakeEl('div', 'task-card');
    const draw = (options: Partial<RenderOptions> = {}) => {
        renderer.render(card as unknown as HTMLElement, s.display, settings, { key: { scope: 's', name: 'parent' }, topRight: { mode: 'none' }, ...options });
    };
    /** The parent's list item. */
    const parentItem = () => card.querySelector(':scope > .task-card__content > ul > li')!;
    return { card, draw, parentItem, workspace };
}

/** What a node is, to read a line's nodes in order. */
function kind(n: FakeEl | FakeText): string {
    if (n instanceof FakeText) return `"${n.textContent}"`;
    return [n.tagName, ...n.classes].join('.');
}

/** The note's link of a line: its separator and its link. */
function fileLink(item: FakeEl) {
    const span = item.querySelector(':scope > .task-card__file-link');
    if (!span) return null;
    const a = span.querySelector('a.internal-link')!;
    return {
        nodes: span.childNodes.map(kind),
        href: a.getAttribute('data-href'),
        attrHref: a.getAttribute('href'),
        text: a.textContent,
    };
}

describe('the link to a card\'s note', () => {
    const ways: [string, number, Partial<RenderOptions>][] = [
        ['alone', 0, {}],
        ['compact', 0, { compact: true }],
        ['with its child under the line', 1, {}],
        ['with its children collapsed', 3, {}],
    ];

    it.each(ways)('is not in the markdown Obsidian draws (%s)', (_way, children, options) => {
        const s = setup(scene({}, children));
        s.draw(options);

        expect(drawn.length).toBeGreaterThan(0);
        for (const markdown of drawn) expect(markdown).not.toContain('[[');
        expect(drawn[0].split('\n')[0]).toBe(`- [ ] ${NAME}`);
    });

    it.each(ways)('ends the parent\'s line, after its name (%s)', (_way, children, options) => {
        const s = setup(scene({}, children));
        s.draw(options);

        const item = s.parentItem();
        const line = item.childNodes.map(kind);
        const nested = children > 0 && children < 3 && !options.compact;
        expect(line).toEqual([
            'input.task-list-item-checkbox',
            `"${NAME}"`,
            'span.task-card__file-link',
            ...(nested ? ['ul'] : []),
        ]);
        expect(fileLink(item)).toEqual({ nodes: ['" : "', 'a.internal-link'], href: TARGET, attrHref: TARGET, text: 'イラスト_絵の練習' });
    });

    it('stands alone after the box of a task with no name', () => {
        const s = setup(scene({ content: '' }));
        s.draw();

        expect(drawn).toEqual(['- [ ] ']);
        expect(s.parentItem().childNodes.map(kind)).toEqual(['input.task-list-item-checkbox', 'span.task-card__file-link']);
        expect(fileLink(s.parentItem())!.nodes).toEqual(['a.internal-link']);
    });

    it('opens and previews the note as the card\'s other links do', () => {
        const s = setup(scene());
        s.draw();
        const a = s.card.querySelector('.task-card__file-link a.internal-link')!;

        a.fire('mouseover');
        a.fire('click');

        expect(s.workspace.trigger).toHaveBeenCalledWith('hover-link', expect.objectContaining({ linktext: TARGET, sourcePath: FILE }));
        expect(s.workspace.openLinkText).toHaveBeenCalledWith(TARGET, FILE, true);
    });
});

describe('the mask over a card', () => {
    it('hides the note\'s link with its separator', () => {
        const s = setup(scene({ mask: '伏せ字' }), { masked: true });
        s.draw();

        const item = s.parentItem();
        expect(item.querySelector('.task-card__file-link')!.style.display).toBe('none');
        expect(item.querySelector(':scope > .task-card__file-link')!.textContent).toBe(' : イラスト_絵の練習');
        expect(item.texts().filter(t => !t.parentElement!.closest('.task-card__file-link')).map(t => t.textContent)).toEqual(['伏せ字']);
    });

    it('hides a link the user wrote, and keeps a mask with a colon before it', () => {
        const s = setup(scene({ content: 'メモ [[別のノート]]', mask: '伏せ: 字' }), { masked: true });
        s.draw();

        const item = s.parentItem();
        const userLink = item.querySelector(':scope > a.internal-link')!;
        expect(userLink.style.display).toBe('none');
        expect(item.childNodes.map(kind)).toEqual(['input.task-list-item-checkbox', '"伏せ: 字"', 'a.internal-link', 'span.task-card__file-link']);
    });
});
