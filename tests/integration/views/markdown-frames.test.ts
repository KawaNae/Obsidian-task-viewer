/**
 * The markdown frames of Timeline's and Calendar's sidebar, in the running
 * Dev vault: a frame the view's state holds (`kind: 'markdown'`, a link to a
 * heading of a note, or to the whole note) drawn as a card of the section's
 * markdown under a header row, kept across the panel's draws, and following
 * its note as the note is written to, renamed, deleted and made again.
 *
 * Then the frames as their notes move: a folder renamed, a note renamed
 * while its frame is folded, and one renamed before the panel draws the
 * frame just added (the window's animation frames held meanwhile); a save
 * of the settings that moves the visual day; and the checkboxes of a body,
 * which do not toggle, but for those of a Dataview query.
 *
 * The frames are put into the view's state as the workspace hands it over
 * (`openView`); what they show is read from their DOM, and what the view
 * keeps from `getState` (`sidebar`, `sidebarCollapsed`, `maskMode`). Whether a body was
 * rendered anew is told by a mark put on its element: an element made anew
 * does not have it. The notes are the test's own, under `SyncIgnore/`, and
 * are written, renamed and deleted through the vault, as Obsidian does it.
 *
 * The last part asks Obsidian itself which heading a link names: it renders
 * an embed of each link (`![[note#a#b]]`), which Obsidian resolves by its
 * own `resolveSubpath`, and compares what the embed shows with what the
 * frame of the same link shows.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *   - Dataview enabled in the vault, for its task list in a body
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/markdown-frames.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { deleteNotesUnder, frameLinks as links, framesOf, notesUnder, readFrames, type Reading } from '../helpers/markdown-frames';
import {
    PRELUDE, SETTLE_MS, closeViews, ev, openView, overrideSettings, readSettings, restartView, tr, visualDay, type HeldSettings,
} from '../helpers/view-helper';

/** Every note of the test is under this: nothing else is written to or deleted. */
const PREFIX = 'SyncIgnore/test-int-mdframes';
const TASKS = `${PREFIX}-tasks.md`;
const TAG = 'tvmdframes';

/** The note the tasks of the list frame are in: `count` tasks. */
function tasksNote(count: number): string {
    return [...Array.from({ length: count }, (_, i) => `- [ ] mdframes task ${i + 1} #${TAG}`), ''].join('\n');
}

interface NoteParts {
    /** The line under `## Memo`. */
    memo?: string;
    /** The color `## Memo` declares. */
    color?: string;
    /** The heading line of the second section. */
    plain?: string;
    /** Whether the note has its `## Memo` heading. */
    memoHeading?: boolean;
    /** The mask `## Memo` declares; none when not given. */
    mask?: string;
}

/** A note of two sections, the first with a nested heading and its own style, under a frontmatter that colors the note. */
function note(parts: NoteParts = {}): string {
    const { memo = 'memo one', color = 'teal', plain = '## Plain **bold** [[Link]]', memoHeading = true, mask } = parts;
    return [
        '---',
        'tv-color: purple',
        '---',
        'intro of the note',
        '',
        ...(memoHeading ? ['## Memo'] : []),
        `- tv-color:: ${color}`,
        '- tv-linestyle:: dashed',
        ...(mask === undefined ? [] : [`- tv-mask:: ${mask}`]),
        '',
        `${memo} [[test-int-mdframes-tasks]]`,
        '',
        '### Deep',
        '',
        'deep text',
        '',
        plain,
        '',
        'plain text',
        '',
    ].join('\n');
}

/** The test's notes, written, renamed and deleted through the vault. A path that is not the test's is refused. */
const NOTES = notesUnder(PREFIX);

/** What a snippet run in the view `name` has, besides the prelude's: the view's markdown frames, and the test's notes. */
const names = (name: string): string => framesOf(PREFIX, name);

/** Run `body` in the view `name`, and read its frames once drawn. */
const op = (name: string, body: string, settleMs = SETTLE_MS): Reading => readFrames(PREFIX, name, body, settleMs);

/** Open the ⋯ menu of the frame `id` and run its item `title`. */
function more(id: string, title: string): string {
    return `
        await openMenu(${JSON.stringify(id)});
        menuItem(it => it.titleEl?.textContent === ${JSON.stringify(title)});
    `;
}

/** The titles of the ⋯ menu of the frame `id`, its separators left out. */
function moreTitles(name: string, id: string): string[] {
    return ev<string[]>(`(async () => {
        ${names(name)}
        await openMenu(${JSON.stringify(id)});
        const titles = menuItems().map(it => it.titleEl?.textContent ?? '').filter(Boolean);
        closeMenus();
        return JSON.stringify(titles);
    })()`);
}

/** Delete the notes of the test the vault still has, and its folders. */
const deleteNotes = (): void => deleteNotesUnder(PREFIX);

/**
 * The path a link of the body of the frame `id` is previewed from, as a
 * hover over it tells: the path the body was resolved against.
 */
function hoverSource(name: string, id: string): string | null {
    return ev<string | null>(`(async () => {
        ${names(name)}
        const link = bodyOf(${JSON.stringify(id)})?.querySelector('a.internal-link');
        if (!link) return JSON.stringify(null);
        let source = null;
        const ref = app.workspace.on('hover-link', (p) => { source = p.sourcePath; });
        link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        app.workspace.offref(ref);
        return JSON.stringify(source);
    })()`);
}

const TOP_LEVEL = { property: 'parent', operator: 'isNotSet' };
const LIST = {
    id: 'list',
    name: 'Tasks',
    filterState: { logic: 'and', filters: [TOP_LEVEL, { property: 'tag', operator: 'includes', value: [TAG] }] },
    applyViewFilter: false,
};

let held: HeldSettings<'reuseExistingTab'>;

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    // The stylesheet of a build that draws markdown frames marks the panel's element.
    const live = ev<boolean>(`(() => {
        const probe = document.body.createDiv('tv-sidebar__frames');
        const styled = getComputedStyle(probe).getPropertyValue('--tv-sidebar-frames-styled') !== '';
        probe.remove();
        return styled;
    })()`);
    if (!live) throw new Error('The Dev vault runs an older build: run `npm run build` and reload the plugin.');
    deleteNotes();
    held = overrideSettings({ reuseExistingTab: true });
    expect(await writeIndexedTestFile(TASKS, tasksNote(1))).toBe(true);
});

afterAll(async () => {
    await closeViews();
    held?.restore();
    deleteTestFile(TASKS);
    await waitForFileDeindexed(TASKS);
    deleteNotes();
});

describe.each([
    ['Timeline', 'timeline-view', 'tl'],
    ['Calendar', 'calendar-view', 'cal'],
])("%s's markdown frames", (_label, type, key) => {
    const name = `mf-${key}`;
    /** The note, as a link names it by its whole path, and by its name alone. */
    const NOTE = `${PREFIX}-${key}`;
    const SHORT = NOTE.slice(NOTE.lastIndexOf('/') + 1);
    const MOVED = `${NOTE}-moved`;
    const write = (parts: NoteParts = {}) => `await writeNote(${JSON.stringify(`${NOTE}.md`)}, ${JSON.stringify(note(parts))});`;

    beforeAll(async () => {
        expect(await writeIndexedTestFile(TASKS, tasksNote(1))).toBe(true);
        ev(`(async () => { ${NOTES} ${write()} return JSON.stringify(true); })()`);
        openView(name, type, {
            showSidebar: true,
            sidebar: [
                LIST,
                { kind: 'markdown', id: 'memo', link: `${NOTE}#Memo` },
                { kind: 'markdown', id: 'whole', link: NOTE },
                // The note by its name alone, the heading without its marks.
                { kind: 'markdown', id: 'plain', link: `${SHORT}#plain bold link` },
                { kind: 'markdown', id: 'gone', link: `${PREFIX}-none/Sub#Parent#Child` },
            ],
        });
    });

    it('draws a heading\'s section and a whole note under the name each has, among the lists, in the order of the state', () => {
        const r = op(name, '');
        expect(r.order).toEqual(['list', 'memo', 'whole', 'plain', 'gone']);
        expect(r.empty).toBe(false);
        expect(r.listCount).toBe(1);

        // A heading's section: its text as the note writes it, its body without the heading and the property lines.
        expect(r.frames.memo.name).toBe('Memo');
        expect(r.frames.memo.text).toBe('memo one test-int-mdframes-tasks Deep deep text');
        expect(r.frames.memo.missing).toBeNull();
        expect(r.frames.plain.name).toBe('Plain **bold** [[Link]]');
        expect(r.frames.plain.text).toBe('plain text');

        // The whole note: the note's name, and the note past its frontmatter.
        expect(r.frames.whole.name).toBe(SHORT);
        expect(r.frames.whole.text).toBe('intro of the note Memo memo one test-int-mdframes-tasks Deep deep text Plain bold Link plain text');
    });

    it('styles a card as a task of its section is: the section\'s own color and line style, or the note\'s', () => {
        const r = op(name, '', 0);
        expect([r.frames.memo.color, r.frames.memo.linestyle]).toEqual(['teal', 'dashed']);
        expect([r.frames.plain.color, r.frames.plain.linestyle]).toEqual(['purple', null]);
        expect([r.frames.whole.color, r.frames.whole.linestyle]).toEqual(['purple', null]);
        const shape = ev<{ shapes: number; surface: boolean }>(`(() => {
            ${names(name)}
            const card = frame('memo').querySelector('.markdown-frame__card');
            return JSON.stringify({
                shapes: card.querySelectorAll(':scope > .task-card__shape').length,
                surface: getComputedStyle(card).getPropertyValue('--task-card-surface') !== '',
            });
        })()`);
        expect(shape).toEqual({ shapes: 1, surface: true });
    });

    it('says in the card that a note is not there, under the last name its link writes, and offers no note to open', () => {
        const r = op(name, '', 0);
        expect(r.frames.gone.name).toBe('Child');
        expect(r.frames.gone.missing).toBe(tr('sidebar.noteNotFound'));
        expect(r.frames.gone.text).toBeNull();
        expect(moreTitles(name, 'gone')).toEqual([tr('menu.moveUp'), tr('menu.remove')]);
    });

    it('keeps every body as it is when the tasks change and the panel draws its lists anew', async () => {
        op(name, 'mark();', 0);
        expect(await writeIndexedTestFile(TASKS, tasksNote(2))).toBe(true);
        const r = op(name, '');
        expect(r.listCount).toBe(2);
        expect([r.frames.memo.kept, r.frames.whole.kept, r.frames.plain.kept]).toEqual([true, true, true]);
        expect(r.order).toEqual(['list', 'memo', 'whole', 'plain', 'gone']);
    });

    it('renders anew the frames whose body changed when the note is written to, and no other', () => {
        const r = op(name, `mark(); ${write({ memo: 'memo two' })}`);
        expect(r.frames.memo.text).toBe('memo two test-int-mdframes-tasks Deep deep text');
        expect(r.frames.memo.kept).toBe(false);
        // The whole note holds the section that changed.
        expect(r.frames.whole.text).toContain('memo two');
        expect(r.frames.whole.kept).toBe(false);
        expect(r.frames.plain.kept).toBe(true);
    });

    it('shows a new style and a new heading text without rendering the body anew', () => {
        let r = op(name, `mark(); ${write({ memo: 'memo two', color: 'blue' })}`);
        expect(r.frames.memo.color).toBe('blue');
        // A property line is no part of a body: neither frame's changed.
        expect([r.frames.memo.kept, r.frames.whole.kept, r.frames.plain.kept]).toEqual([true, true, true]);

        // The heading is still the one the link names, its marks and case aside.
        r = op(name, `mark(); ${write({ memo: 'memo two', color: 'blue', plain: '## PLAIN `bold`: link' })}`);
        expect(r.frames.plain.name).toBe('PLAIN `bold`: link');
        expect(r.frames.plain.kept).toBe(true);
        op(name, write({ memo: 'memo two' }));
    });

    it('opens and previews a link of a body as a link of a card: from the frame\'s note', () => {
        const r = ev<{ hover: { linktext: string; sourcePath: string; source: string } | null; opened: string | null }>(`(async () => {
            ${names(name)}
            const link = bodyOf('memo').querySelector('a.internal-link');
            let hover = null;
            const ref = app.workspace.on('hover-link', (p) => { hover = { linktext: p.linktext, sourcePath: p.sourcePath, source: p.source }; });
            link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            app.workspace.offref(ref);

            const before = new Set(app.workspace.getLeavesOfType('markdown'));
            link.click();
            await wait(600);
            const leaf = app.workspace.getLeavesOfType('markdown').find(l => !before.has(l));
            const opened = leaf?.view?.file?.path ?? null;
            leaf?.detach();
            return JSON.stringify({ hover, opened });
        })()`);
        expect(r.hover).toEqual({ linktext: 'test-int-mdframes-tasks', sourcePath: `${NOTE}.md`, source: 'obsidian-task-viewer' });
        expect(r.opened).toBe(TASKS);
    });

    it('offers its note, the moves there are and Remove in its ⋯ menu, and moves among the lists', () => {
        const all = [tr('sidebar.openNote'), tr('menu.moveUp'), tr('menu.moveDown'), tr('menu.remove')];
        expect(moreTitles(name, 'memo')).toEqual(all);

        let r = op(name, `mark(); ${more('memo', tr('menu.moveUp'))}`);
        expect(r.sidebar.map(f => f.id)).toEqual(['memo', 'list', 'whole', 'plain', 'gone']);
        expect(r.order).toEqual(['memo', 'list', 'whole', 'plain', 'gone']);
        expect(moreTitles(name, 'memo')).toEqual(all.filter(title => title !== tr('menu.moveUp')));
        // A frame moved, or passed by another, is the element it was.
        expect([r.frames.memo.kept, r.frames.whole.kept, r.frames.plain.kept]).toEqual([true, true, true]);

        r = op(name, more('plain', tr('menu.moveUp')));
        expect(r.sidebar.map(f => f.id)).toEqual(['memo', 'list', 'plain', 'whole', 'gone']);
        expect(r.order).toEqual(['memo', 'list', 'plain', 'whole', 'gone']);

        r = op(name, more('plain', tr('menu.moveDown')) + more('memo', tr('menu.moveDown')));
        expect(r.sidebar.map(f => f.id)).toEqual(['list', 'memo', 'whole', 'plain', 'gone']);
        expect(r.order).toEqual(['list', 'memo', 'whole', 'plain', 'gone']);
        expect([r.frames.memo.kept, r.frames.whole.kept, r.frames.plain.kept]).toEqual([true, true, true]);
    });

    it('opens its note at the heading from its ⋯ menu: in a new tab, or in the tab that shows the note already', () => {
        const lineOf = (heading: string) => note({ memo: 'memo two' }).split('\n').indexOf(heading);
        const r = ev<{ first: { path: string | null; line: number | null }; again: { leaves: number; line: number | null } }>(`(async () => {
            ${names(name)}
            const path = ${JSON.stringify(`${NOTE}.md`)};
            const shown = () => app.workspace.getLeavesOfType('markdown').filter(l => l.view?.file?.path === path);
            // The line the editor is at; null in a mode that has no cursor.
            const line = (leaf) => leaf.view.getMode() === 'source' ? leaf.view.editor.getCursor().line : null;
            if (shown().length > 0) throw new Error('the note is open already');

            ${more('memo', tr('sidebar.openNote'))}
            await wait(800);
            const leaf = shown()[0];
            const first = { path: leaf?.view?.file?.path ?? null, line: leaf ? line(leaf) : null };

            ${more('plain', tr('sidebar.openNote'))}
            await wait(600);
            const again = { leaves: shown().length, line: leaf ? line(leaf) : null };
            leaf?.detach();
            return JSON.stringify({ first, again });
        })()`);
        expect(r.first.path).toBe(`${NOTE}.md`);
        expect(r.again.leaves).toBe(1);
        if (r.first.line !== null) {
            expect(r.first.line).toBe(lineOf('## Memo'));
            expect(r.again.line).toBe(lineOf('## Plain **bold** [[Link]]'));
        }
    });

    it('folds on a click of its row, keeps its body, and renders a body that changed meanwhile when it is unfolded', () => {
        let r = op(name, `mark(); frame('memo').querySelector('.' + C.header).click();`);
        expect(r.collapsed.memo).toBe(true);
        expect(r.frames.memo.collapsed).toBe(true);
        expect(r.frames.memo.shown).toBe(false);
        expect(r.frames.memo.kept).toBe(true);
        expect(r.frames.whole.collapsed).toBe(false);

        // Written to while folded: the card is left as it is.
        r = op(name, write({ memo: 'memo three' }));
        expect(r.frames.memo.text).toBe('memo two test-int-mdframes-tasks Deep deep text');
        expect(r.frames.memo.kept).toBe(true);
        expect(r.frames.whole.text).toContain('memo three');
    });

    it('is folded on restart, with no body until it is unfolded', () => {
        const restarted = `${name}-2`;
        restartView(name, restarted);
        let r = op(restarted, '');
        expect(r.order).toEqual(['list', 'memo', 'whole', 'plain', 'gone']);
        expect(r.collapsed.memo).toBe(true);
        expect(r.frames.memo.collapsed).toBe(true);
        expect(r.frames.memo.name).toBe('Memo');
        expect(r.frames.memo.text).toBeNull();
        expect(r.frames.whole.text).toContain('memo three');

        r = op(restarted, `frame('memo').querySelector('.' + C.header).click();`);
        // An unfolded frame is saved as no entry.
        expect(r.collapsed.memo).toBeFalsy();
        expect(r.frames.memo.shown).toBe(true);
        expect(r.frames.memo.text).toBe('memo three test-int-mdframes-tasks Deep deep text');
        ev(`(async () => { ${PRELUDE} R[${JSON.stringify(restarted)}].detach(); delete R[${JSON.stringify(restarted)}]; return JSON.stringify(true); })()`);

        r = op(name, `frame('memo').querySelector('.' + C.header).click();`);
        expect(r.collapsed.memo).toBeFalsy();
        expect(r.frames.memo.text).toBe('memo three test-int-mdframes-tasks Deep deep text');
        expect(r.frames.memo.kept).toBe(false);
    });

    it('follows its note when the note is renamed: the link names the new path, the section kept, and the body is rendered from there', () => {
        let r = op(name, `mark(); await renameNote(${JSON.stringify(`${NOTE}.md`)}, ${JSON.stringify(`${MOVED}.md`)});`);
        expect(links(r)).toEqual({
            memo: `${MOVED}#Memo`,
            whole: MOVED,
            plain: `${MOVED}#plain bold link`,
            gone: `${PREFIX}-none/Sub#Parent#Child`,
        });
        expect([r.frames.memo.missing, r.frames.whole.missing, r.frames.plain.missing]).toEqual([null, null, null]);
        expect(r.frames.whole.name).toBe(`${SHORT}-moved`);
        expect(r.frames.memo.text).toBe('memo three test-int-mdframes-tasks Deep deep text');
        // A body is resolved against its note's path: at a new path it is rendered anew.
        expect(r.frames.memo.kept).toBe(false);

        r = op(name, `await renameNote(${JSON.stringify(`${MOVED}.md`)}, ${JSON.stringify(`${NOTE}.md`)});`);
        expect(links(r)).toMatchObject({ memo: `${NOTE}#Memo`, whole: NOTE, plain: `${NOTE}#plain bold link` });
        expect(r.frames.whole.name).toBe(SHORT);
        expect(r.frames.plain.text).toBe('plain text');
    });

    it('says that the section is not there once the note loses the heading, and shows it again once the note has it', () => {
        let r = op(name, write({ memo: 'memo three', memoHeading: false }));
        expect(r.frames.memo.missing).toBe(tr('sidebar.sectionNotFound'));
        expect(r.frames.memo.name).toBe('Memo');
        expect(r.frames.memo.text).toBeNull();
        expect([r.frames.memo.color, r.frames.memo.linestyle]).toEqual([null, null]);
        expect(r.frames.whole.missing).toBeNull();
        expect(r.frames.plain.missing).toBeNull();
        // The note is there to open.
        expect(moreTitles(name, 'memo')).toContain(tr('sidebar.openNote'));

        r = op(name, write({ memo: 'memo three' }));
        expect(r.frames.memo.missing).toBeNull();
        expect(r.frames.memo.text).toBe('memo three test-int-mdframes-tasks Deep deep text');
        expect([r.frames.memo.color, r.frames.memo.linestyle]).toEqual(['teal', 'dashed']);
    });

    it('says that the note is not there once the note is deleted, and shows it again once a note is made at the path', () => {
        let r = op(name, `await deleteNote(${JSON.stringify(`${NOTE}.md`)});`);
        for (const id of ['memo', 'whole', 'plain']) {
            expect(r.frames[id].missing).toBe(tr('sidebar.noteNotFound'));
            expect(r.frames[id].text).toBeNull();
        }
        expect([r.frames.memo.name, r.frames.whole.name, r.frames.plain.name]).toEqual(['Memo', SHORT, 'plain bold link']);
        expect(moreTitles(name, 'memo')).not.toContain(tr('sidebar.openNote'));
        // The frames stay in the state as they were.
        expect(links(r)).toMatchObject({ memo: `${NOTE}#Memo`, whole: NOTE });

        r = op(name, write({ memo: 'memo four' }));
        expect([r.frames.memo.missing, r.frames.whole.missing, r.frames.plain.missing]).toEqual([null, null, null]);
        expect(r.frames.memo.text).toBe('memo four test-int-mdframes-tasks Deep deep text');
        expect(r.frames.whole.name).toBe(SHORT);
        expect(r.frames.plain.name).toBe('Plain **bold** [[Link]]');
    });

    it('reads its note again when the settings are saved: the key a color is declared by is a setting', () => {
        const { scopeKeys } = readSettings(['scopeKeys']) as { scopeKeys: Record<string, string> };
        const keys = overrideSettings({ scopeKeys: { ...scopeKeys, color: 'tvmdf-color' } });
        try {
            const r = op(name, '');
            expect(r.frames.memo.color).toBeNull();
            expect(r.frames.memo.linestyle).toBe('dashed');
        } finally {
            keys.restore();
        }
        const r = op(name, '');
        expect(r.frames.memo.color).toBe('teal');
        expect(r.frames.memo.text).toBe('memo four test-int-mdframes-tasks Deep deep text');
    });

    it('shows a section\'s mask in place of its body while the view masks, and the body again once it does not', () => {
        // A property line is no part of a body: the mask written renders nothing anew.
        let r = op(name, `mark(); ${write({ memo: 'memo four', mask: 'memo masked' })}`);
        expect(r.frames.memo.mask).toBeNull();
        expect(r.frames.memo.kept).toBe(true);

        r = op(name, `mark(); setMask(true);`);
        expect(r.maskMode).toBe(true);
        expect(r.frames.memo.mask).toBe('memo masked');
        expect(r.frames.memo.text).toBeNull();
        // The row's name and the card's style stay.
        expect(r.frames.memo.name).toBe('Memo');
        expect([r.frames.memo.color, r.frames.memo.linestyle]).toEqual(['teal', 'dashed']);
        // A section without a mask keeps its body, the element it was; one not there is said as before.
        expect([r.frames.whole.mask, r.frames.plain.mask]).toEqual([null, null]);
        expect([r.frames.whole.kept, r.frames.plain.kept]).toEqual([true, true]);
        expect(r.frames.gone.missing).toBe(tr('sidebar.noteNotFound'));

        r = op(name, `setMask(false);`);
        expect(r.maskMode).toBe(false);
        expect(r.frames.memo.mask).toBeNull();
        expect(r.frames.memo.text).toBe('memo four test-int-mdframes-tasks Deep deep text');
        expect([r.frames.whole.kept, r.frames.plain.kept]).toEqual([true, true]);
    });

    it('shows the mask the note writes while the view masks: a new value, and the body once the line is gone', () => {
        let r = op(name, `setMask(true); ${write({ memo: 'memo four', mask: 'memo masked again' })}`);
        expect(r.frames.memo.mask).toBe('memo masked again');
        expect(r.frames.memo.text).toBeNull();

        r = op(name, write({ memo: 'memo four' }));
        expect(r.maskMode).toBe(true);
        expect(r.frames.memo.mask).toBeNull();
        expect(r.frames.memo.text).toBe('memo four test-int-mdframes-tasks Deep deep text');

        r = op(name, `setMask(false);`);
        expect(r.maskMode).toBe(false);
    });

    it('is removed from its ⋯ menu, and from the card of a frame that is not there', () => {
        let r = op(name, more('whole', tr('menu.remove')));
        expect(r.sidebar.map(f => f.id)).toEqual(['list', 'memo', 'plain', 'gone']);
        expect(r.order).toEqual(['list', 'memo', 'plain', 'gone']);

        r = op(name, `frame('gone').querySelector('.markdown-frame__missing-remove').click();`);
        expect(r.sidebar.map(f => f.id)).toEqual(['list', 'memo', 'plain']);
        expect(r.order).toEqual(['list', 'memo', 'plain']);
    });

    it('does not say that nothing is added in a sidebar that holds markdown frames only', () => {
        const only = `${name}-only`;
        openView(only, type, { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'memo', link: `${NOTE}#Memo` }] });
        const r = op(only, '');
        expect(r.empty).toBe(false);
        expect(r.order).toEqual(['memo']);
        expect(r.frames.memo.text).toBe('memo four test-int-mdframes-tasks Deep deep text');
    });
});

describe.each([
    ['Timeline', 'timeline-view', 'tl'],
    ['Calendar', 'calendar-view', 'cal'],
])("%s's markdown frames, as their notes move and the day rolls", (_label, type, key) => {
    const name = `mf-moves-${key}`;
    /** A folder of two notes, one in a folder of its own. */
    const DIR = `${PREFIX}-dir-${key}`;
    const DIR_MOVED = `${DIR}-moved`;
    /** The note of the frame folded while it changes. */
    const FOLD = `${PREFIX}-fold-${key}`;
    const FOLD_MOVED = `${FOLD}-moved`;
    /** The note of the frame added and renamed before it is drawn. */
    const ADDED = `${PREFIX}-added-${key}`;
    const MEMO = 'memo one test-int-mdframes-tasks Deep deep text';
    const writeAt = (path: string, parts: NoteParts = {}) => `await writeNote(${JSON.stringify(`${path}.md`)}, ${JSON.stringify(note(parts))});`;
    /** Fold or unfold the frame `id` from its row, unless it is so already. */
    const fold = (id: string, collapsed: boolean) => `
        if (frame(${JSON.stringify(id)}).classList.contains('markdown-frame--collapsed') !== ${collapsed}) {
            frame(${JSON.stringify(id)}).querySelector('.' + C.header).click();
        }
    `;

    beforeAll(() => {
        ev(`(async () => {
            ${NOTES}
            await app.vault.createFolder(${JSON.stringify(`${DIR}/sub`)}).catch(() => {});
            ${writeAt(`${DIR}/a`)}
            ${writeAt(`${DIR}/sub/b`)}
            ${writeAt(FOLD)}
            ${writeAt(ADDED)}
            return JSON.stringify(true);
        })()`);
        openView(name, type, {
            showSidebar: true,
            sidebar: [
                { kind: 'markdown', id: 'a', link: `${DIR}/a#Memo` },
                { kind: 'markdown', id: 'b', link: `${DIR}/sub/b` },
                { kind: 'markdown', id: 'fold', link: `${FOLD}#Memo` },
            ],
        });
    });

    it('follows the notes of a folder renamed: each link names its note\'s new path, and its body is drawn from there', () => {
        const before = op(name, 'mark();');
        expect([before.frames.a.text, before.frames.b.name]).toEqual([MEMO, 'b']);

        const r = op(name, `await renameNote(${JSON.stringify(DIR)}, ${JSON.stringify(DIR_MOVED)});`);
        expect(links(r)).toMatchObject({ a: `${DIR_MOVED}/a#Memo`, b: `${DIR_MOVED}/sub/b` });
        expect([r.frames.a.missing, r.frames.b.missing]).toEqual([null, null]);
        expect(r.frames.a.text).toBe(MEMO);
        expect(r.frames.b.text).toContain(MEMO);
        // Each body is resolved against its note's new path.
        expect([r.frames.a.kept, r.frames.b.kept]).toEqual([false, false]);
        expect(hoverSource(name, 'a')).toBe(`${DIR_MOVED}/a.md`);
        expect(hoverSource(name, 'b')).toBe(`${DIR_MOVED}/sub/b.md`);
    });

    it('keeps no body of a folded frame whose note is renamed, and draws it from the new path once unfolded', () => {
        let r = op(name, `mark(); ${fold('fold', true)}`);
        expect([r.frames.fold.collapsed, r.frames.fold.kept]).toEqual([true, true]);

        r = op(name, `await renameNote(${JSON.stringify(`${FOLD}.md`)}, ${JSON.stringify(`${FOLD_MOVED}.md`)});`);
        expect(links(r).fold).toBe(`${FOLD_MOVED}#Memo`);
        expect(r.frames.fold.collapsed).toBe(true);
        // The body resolved against the old path is taken out, though the frame is folded.
        expect(r.frames.fold.text).toBeNull();

        r = op(name, fold('fold', false));
        expect(r.frames.fold.collapsed).toBe(false);
        expect(r.frames.fold.text).toBe(MEMO);
        expect(hoverSource(name, 'fold')).toBe(`${FOLD_MOVED}.md`);
    });

    it('keeps no mask and no "not there" in a folded frame that is to show its body, and draws the body once unfolded', () => {
        // The mask, shown while the view masks, is taken out when it stops, the frame folded.
        let r = op(name, `${writeAt(FOLD_MOVED, { mask: 'fold masked' })} setMask(true);`);
        expect(r.frames.fold.mask).toBe('fold masked');
        r = op(name, `${fold('fold', true)} setMask(false);`);
        expect(r.maskMode).toBe(false);
        expect([r.frames.fold.collapsed, r.frames.fold.mask, r.frames.fold.text]).toEqual([true, null, null]);
        r = op(name, fold('fold', false));
        expect(r.frames.fold.text).toBe(MEMO);

        // That the note is not there is taken out when the note is made again, the frame folded.
        r = op(name, `await deleteNote(${JSON.stringify(`${FOLD_MOVED}.md`)});`);
        expect(r.frames.fold.missing).toBe(tr('sidebar.noteNotFound'));
        r = op(name, `${fold('fold', true)} ${writeAt(FOLD_MOVED)}`);
        expect([r.frames.fold.collapsed, r.frames.fold.missing, r.frames.fold.text]).toEqual([true, null, null]);
        r = op(name, fold('fold', false));
        expect([r.frames.fold.missing, r.frames.fold.text]).toEqual([null, MEMO]);
    });

    it('follows the note of a frame added and renamed before the panel draws, and renders its body only once the frame is in place', () => {
        // The window's animation frames, in which the panel draws, are held
        // from the frame's adding until the rename has been told.
        const held = ev<{ before: { connected: boolean; body: boolean }; atRename: { connected: boolean } | null; frames: number }>(`(async () => {
            ${names(name)}
            const v = V(${JSON.stringify(name)});
            const win = el.win ?? window;
            const raf = win.requestAnimationFrame;
            const caf = win.cancelAnimationFrame;
            const frames = [];
            let heldCount = 0;
            win.requestAnimationFrame = (cb) => { frames.push(cb); heldCount++; return -frames.length; };
            win.cancelAnimationFrame = (id) => { if (id < 0) frames[-id - 1] = null; else caf.call(win, id); };
            let atRename = null;
            const ref = app.vault.on('rename', () => { atRename ??= { connected: !!el.querySelector('.markdown-frame[data-frame-id="added"]') }; });
            try {
                v.update({ sidebar: [...(v.state.sidebar ?? []), { kind: 'markdown', id: 'added', link: ${JSON.stringify(`${ADDED}#Memo`)} }] }, { draw: false });
                // Its note is read meanwhile; its element, in no document yet, is reached through the panel.
                await wait(300);
                const root = v.sidebarFrames.markdown.elementOf('added');
                const before = { connected: root.isConnected, body: !!root.querySelector('.markdown-frame__content') };
                await renameNote(${JSON.stringify(`${ADDED}.md`)}, ${JSON.stringify(`${ADDED}-moved.md`)});
                return JSON.stringify({ before, atRename, frames: heldCount });
            } finally {
                app.vault.offref(ref);
                win.requestAnimationFrame = raf;
                win.cancelAnimationFrame = caf;
                for (const cb of frames) if (cb) raf.call(win, cb);
            }
        })()`);
        // What the test rests on: no draw ran between the adding and the rename.
        expect(held.frames).toBeGreaterThan(0);
        expect(held.atRename).toEqual({ connected: false });
        // A body is not rendered while its frame is in no document.
        expect(held.before).toEqual({ connected: false, body: false });

        const r = op(name, '');
        expect(links(r).added).toBe(`${ADDED}-moved#Memo`);
        expect(r.order).toEqual(['a', 'b', 'fold', 'added']);
        expect([r.frames.added.missing, r.frames.added.text]).toEqual([null, MEMO]);
        expect(hoverSource(name, 'added')).toBe(`${ADDED}-moved.md`);
    });

    /**
     * The visual day moves on a save only when the start hour is set across
     * the hour now: to an hour still ahead, or to 0 before the start hour.
     * The hour ahead is two on, so the test may run past the end of this
     * one; skipped from 22:00, when two on is no hour of the day.
     */
    const h = new Date().getHours();
    it.skipIf(h >= 22)('reads its note again when a save of the settings moves the visual day', () => {
        const { startHour, scopeKeys } = readSettings(['startHour', 'scopeKeys']) as { startHour: number; scopeKeys: Record<string, string> };
        const rolledHour = h < startHour ? 0 : h + 2;
        expect(visualDay(rolledHour)).not.toBe(visualDay(startHour));

        // One save moves the day and renames the key a color is declared by.
        const saved = overrideSettings({ startHour: rolledHour, scopeKeys: { ...scopeKeys, color: 'tvmdf-color' } });
        try {
            const r = op(name, '');
            expect(r.frames.a.color).toBeNull();
            expect(r.frames.a.linestyle).toBe('dashed');
        } finally {
            saved.restore();
        }
        const r = op(name, '');
        expect(r.frames.a.color).toBe('teal');
    });
});

describe.each([
    ['Timeline', 'timeline-view', 'tl'],
    ['Calendar', 'calendar-view', 'cal'],
])("%s's markdown frame's checkboxes", (_label, type, key) => {
    const name = `mf-boxes-${key}`;
    const BOXES = `${PREFIX}-boxes-${key}`;
    const EMBEDDED = `${PREFIX}-embedded-${key}`;
    const QUERIED = `${PREFIX}-queried-${key}`;
    const BOXES_NOTE = [
        '- [ ] box in the body',
        '',
        '> [!note]',
        '> - [ ] box in a callout',
        '',
        `![[${EMBEDDED.slice(EMBEDDED.lastIndexOf('/') + 1)}]]`,
        '',
        '```dataview',
        `TASK FROM "${QUERIED}"`,
        '```',
        '',
    ].join('\n');
    const EMBEDDED_NOTE = '- [ ] box in an embed\n';
    const QUERIED_NOTE = '- [ ] box in a query\n';

    beforeAll(() => {
        ev(`(async () => {
            ${NOTES}
            await writeNote(${JSON.stringify(`${EMBEDDED}.md`)}, ${JSON.stringify(EMBEDDED_NOTE)});
            await writeNote(${JSON.stringify(`${QUERIED}.md`)}, ${JSON.stringify(QUERIED_NOTE)});
            await writeNote(${JSON.stringify(`${BOXES}.md`)}, ${JSON.stringify(BOXES_NOTE)});
            return JSON.stringify(true);
        })()`);
        openView(name, type, { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'boxes', link: BOXES }] });
    });

    /**
     * Click the checkbox of the body of the frame whose task's text is
     * `text`, found anew; give whether it is checked right after the click
     * and the notes as they are once the click has been answered.
     */
    function clickBox(text: string, settleMs = SETTLE_MS): { found: boolean; checked: boolean | null; notes: Record<string, string> } {
        return ev(`(async () => {
            ${names(name)}
            const box = () => [...bodyOf('boxes').querySelectorAll('input.task-list-item-checkbox')]
                .find(b => b.closest('li')?.textContent.includes(${JSON.stringify(text)}));
            // A query is drawn by its plugin some time after the body.
            for (let i = 0; i < 50 && !box(); i++) await wait(100);
            const b = box();
            let checked = null;
            if (b) { b.click(); checked = b.checked; }
            await wait(${settleMs});
            const notes = {};
            for (const path of ${JSON.stringify([`${BOXES}.md`, `${EMBEDDED}.md`, `${QUERIED}.md`])}) notes[path] = await app.vault.read(noteAt(path));
            return JSON.stringify({ found: !!b, checked, notes });
        })()`);
    }

    it.each([
        ['the body\'s markdown', 'box in the body'],
        ['a callout', 'box in a callout'],
        ['a note embedded in the body', 'box in an embed'],
    ])('does not toggle a checkbox of %s, and leaves the notes as they are', (_where, text) => {
        const r = clickBox(text);
        expect(r.found).toBe(true);
        expect(r.checked).toBe(false);
        expect(r.notes).toEqual({ [`${BOXES}.md`]: BOXES_NOTE, [`${EMBEDDED}.md`]: EMBEDDED_NOTE, [`${QUERIED}.md`]: QUERIED_NOTE });
    });

    it('leaves a checkbox of a Dataview task list to Dataview, which writes the note on each click', () => {
        const dataview = ev<boolean>(`(() => JSON.stringify(!!app.plugins.plugins.dataview))()`);
        if (!dataview) throw new Error('Dataview is not enabled in the Dev vault');
        const line = (r: { notes: Record<string, string> }) => r.notes[`${QUERIED}.md`].split('\n')[0];

        // Dataview refreshes its lists an interval after a note changed. The
        // second click waits that out, so it is on the list as Dataview has
        // it for the note the first click wrote.
        const refreshMs = ev<number>(`(() => JSON.stringify(app.plugins.plugins.dataview.settings.refreshInterval ?? 2500))()`);
        let r = clickBox('box in a query', refreshMs + 1000);
        expect(r.found).toBe(true);
        expect(line(r)).toMatch(/^- \[x\] box in a query/);
        r = clickBox('box in a query', 1500);
        expect(r.found).toBe(true);
        expect(line(r)).toMatch(/^- \[ \] box in a query/);
        expect(r.notes[`${BOXES}.md`]).toBe(BOXES_NOTE);
    });
});

/**
 * A note of the heading shapes a link is asked about. Each heading is
 * followed by a line that names it (`m01`…), so what a frame or an embed
 * shows tells which heading it starts at and where its section ends.
 */
const HEADINGS = [
    'm00',
    '',
    '# Alpha',
    'm01',
    '## Beta',
    'm02',
    '### Gamma',
    'm03',
    '## Dup',
    'm04',
    '# Second',
    'm05',
    '## Dup',
    'm06',
    '### Gamma',
    'm07',
    '## a: b',
    'm08',
    '## C# notes',
    'm09',
    '## [[Link]] here',
    'm10',
    '## **bold** text',
    'm11',
    '## Closed ##',
    'm12',
    '',
    'Setext One',
    '==========',
    'm13',
    '',
    'Setext Two',
    '----------',
    'm14',
    '## Beta',
    'm15',
    '   ## Indented',
    'm16',
    '',
    '    ## Code',
    'm17',
    '',
    '```',
    '## Fenced',
    '```',
    'm18',
    '',
];

/** The subpaths asked, as a link writes them after the note. */
const SUBPATHS = [
    // A name, a path of names, case aside.
    '#Alpha', '#ALPHA', '#Beta', '#Alpha#Beta', '#Alpha#Beta#Gamma', '#Gamma',
    // Two headings of one name: the first, or the one below a heading named before it.
    '#Dup', '#Alpha#Dup', '#Second#Dup', '#Second#Gamma', '#Second#Dup#Gamma',
    // A name found below the heading named before it, outside that heading's section.
    '#Second#Beta', '#Alpha#Setext Two',
    // A path that does not go deeper, and names no heading has.
    '#Beta#Alpha', '#Dup#Dup', '#nope', '#Alpha#nope', '#nope#Beta',
    // Marks in a heading, written in the link with and without them.
    '#a b', '#a: b', '#A  B', '#C notes', '#C# notes', '#Link here', '#[[Link]] here', '#bold text', '#**bold** text',
    // A closing run of `#`, the two setext levels, a heading set in.
    '#Closed', '#Closed ##', '#Setext One', '#Setext Two', '#Setext One#Setext Two', '#Indented',
    // No heading: a line set in as code, a line in a fence.
    '#Code', '#Fenced',
];

/**
 * Write `lines` as the note `NOTE`, and ask which lines of it each of
 * `subpaths` names: of Obsidian, which renders an embed of each link by the
 * renderer a note's reading view has, and of the plugin, which draws a frame
 * of each link in a Timeline kept as `name`. An answer is the m-lines shown,
 * in order; null where the link names no heading (Obsidian's embed then
 * shows the whole note, the frame says the section is not there). A frame
 * not drawn in time, or that says something else, fails the ask.
 */
function askHeadings(name: string, NOTE: string, lines: string[], subpaths: string[]): { frames: Record<string, string | null>; embeds: Record<string, string | null> } {
    const r = ev<{ frames: ({ marks: string } | { missing: string } | null)[]; embeds: (string | null)[] }>(`(async () => {
        ${PRELUDE}
        ${NOTES}
        const path = ${JSON.stringify(`${NOTE}.md`)};
        const subpaths = ${JSON.stringify(subpaths)};
        await writeNote(path, ${JSON.stringify(lines.join('\n'))});
        const file = noteAt(path);
        for (let i = 0; i < 40 && !app.metadataCache.getFileCache(file)?.headings; i++) await wait(100);
        const marks = (n) => (n.textContent.match(/m\\d\\d/g) ?? []).join(' ');

        const leaf = app.workspace.getLeaf('tab');
        await leaf.openFile(file, { active: false });
        let Renderer = leaf.view.previewMode.constructor;
        while (Renderer && !Object.getOwnPropertyNames(Renderer).includes('render')) Renderer = Object.getPrototypeOf(Renderer);
        const Component = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(P))).constructor;
        const component = new Component();
        component.load();
        const box = document.body.createDiv();
        let embeds;
        try {
            // A wikilink, or, for a name that holds what would end one, a markdown link, encoded.
            const embed = (s) => /[\\[\\]]/.test(s) ? '![](' + encodeURI(path + s) + ')' : '![[' + ${JSON.stringify(NOTE)} + s + ']]';
            await Renderer.render(app, subpaths.map(embed).join('\\n\\n'), box, '', component);
            const loaded = () => [...box.querySelectorAll('.internal-embed')].filter(e => e.querySelector('.markdown-embed-content'));
            for (let i = 0; i < 50 && loaded().length < subpaths.length; i++) await wait(100);
            if (loaded().length !== subpaths.length) throw new Error(loaded().length + ' embeds of ' + subpaths.length + ' links');
            embeds = loaded().map(e => { const m = marks(e.querySelector('.markdown-embed-content')); return m.startsWith('m00') ? null : m; });
        } finally {
            component.unload();
            box.remove();
            leaf.detach();
        }

        if (R[${JSON.stringify(name)}]) R[${JSON.stringify(name)}].detach();
        const frameLeaf = app.workspace.getLeaf('tab');
        await frameLeaf.setViewState({ type: 'timeline-view', active: true, state: {
            showSidebar: true,
            sidebar: subpaths.map((s, i) => ({ kind: 'markdown', id: 'h' + i, link: ${JSON.stringify(NOTE)} + s })),
        } });
        R[${JSON.stringify(name)}] = frameLeaf;
        const el = frameLeaf.view.contentEl;
        const drawn = () => [...el.querySelectorAll('.markdown-frame')].filter(f => f.querySelector('.markdown-frame__content, .markdown-frame__missing-reason'));
        for (let i = 0; i < 50 && drawn().length < subpaths.length; i++) await wait(100);
        if (drawn().length !== subpaths.length) throw new Error(drawn().length + ' frames drawn of ' + subpaths.length + ' links');
        await wait(300);
        const frames = subpaths.map((s, i) => {
            const frame = el.querySelector('.markdown-frame[data-frame-id="h' + i + '"]');
            const body = frame?.querySelector('.markdown-frame__content');
            if (body) return { marks: marks(body) };
            const missing = frame?.querySelector('.markdown-frame__missing-reason');
            return missing ? { missing: missing.textContent } : null;
        });
        return JSON.stringify({ frames, embeds });
    })()`);
    // A frame that names no heading says so; one that shows neither a body nor that was not drawn.
    const frames = r.frames.map((frame, i) => {
        if (frame === null) throw new Error(`the frame of ${subpaths[i]} shows neither a body nor what is missing`);
        if ('marks' in frame) return frame.marks;
        if (frame.missing !== tr('sidebar.sectionNotFound')) throw new Error(`the frame of ${subpaths[i]} says "${frame.missing}"`);
        return null;
    });
    const bySubpath = (found: (string | null)[]) => Object.fromEntries(subpaths.map((s, i) => [s, found[i] ?? null]));
    return { frames: bySubpath(frames), embeds: bySubpath(r.embeds) };
}

describe('the heading a link names', () => {
    const name = 'mf-headings';

    it('is the one Obsidian\'s own embed of the link shows, and its section ends where the embed\'s does', () => {
        const { frames, embeds } = askHeadings(name, `${PREFIX}-headings`, HEADINGS, SUBPATHS);
        expect(frames).toEqual(embeds);
        // What the comparison rests on: the embeds told the headings apart.
        expect(embeds).toMatchObject({
            '#Alpha': 'm01 m02 m03 m04',
            '#Alpha#Beta': 'm02 m03',
            '#Dup': 'm04',
            '#Second#Dup': 'm06 m07',
            '#Second#Beta': 'm15',
            '#a b': 'm08',
            '#Link here': 'm10',
            '#Setext One': 'm13 m14 m15 m16 m17 m18',
            '#nope': null,
            '#Code': null,
        });
    });

    it('differs from Obsidian\'s for a paragraph of several lines underlined: a heading to the plugin\'s outline, none to Obsidian', () => {
        const lines = ['m00', '', '# Top', 'm01', '', 'first line', 'second line', '===========', 'm02', '', '## After', 'm03', ''];
        const { frames, embeds } = askHeadings(name, `${PREFIX}-setext`, lines, ['#Top', '#first line second line', '#After']);
        // Obsidian reads the three lines as a paragraph, so the section above runs on through it.
        expect(embeds).toEqual({ '#Top': 'm01 m02 m03', '#first line second line': null, '#After': 'm03' });
        // The outline reads them as a heading of the first level, which ends the section above.
        expect(frames).toEqual({ '#Top': 'm01', '#first line second line': 'm02 m03', '#After': 'm03' });
    });
});
