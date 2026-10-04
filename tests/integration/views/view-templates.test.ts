/**
 * View templates, in the running Dev vault: a view saved from its settings
 * menu (Save view...) as a note in the view template folder, that note
 * opened again through Load view... and through a URI, and Copy URI, which
 * names a template instead of writing the config while a folder is set.
 *
 * The folder is set to one of the test's own for the tests, so the Dev
 * vault's setting and its templates decide nothing, and put back after them;
 * the folder and its notes are deleted. The views count the tasks of a note
 * of the test's own, tagged so that only they pass the view's filter and its
 * pinned list. Menu items are picked by the text the vault's locale shows.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/view-templates.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import {
    PRELUDE, closeViews, copyUri, ev, openUri, openView, overrideSettings, readSettings, tr, visualDay,
    type HeldSettings,
} from '../helpers/view-helper';

/** The test's own template folder, two levels deep so that saving makes both. */
const ROOT = 'test-int-view-templates';
const FOLDER = `${ROOT}/views`;
const FILE = 'test-int-view-templates.md';
const NAME = 'E2E saved timeline';
const NOTE = `${FOLDER}/${NAME}.md`;

/** The fields of Timeline's config (`TimelineSchema.config`): what a template holds. */
const CONFIG_KEYS = [
    'customName', 'filterState', 'maskMode', 'astronomyDisplay', 'showSidebar', 'pinnedLists',
    'daysToShow', 'zoomLevel', 'showAllDay', 'showTimeline',
] as const;

const TAGGED = { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: ['tvvt'] }] };
const LIST = {
    id: 'list-e2e-vt',
    name: 'vt list',
    filterState: { logic: 'and', filters: [{ property: 'tag', operator: 'includes', value: ['tvvtx'] }] },
};

/** The view's config as `getState` saves it: its state without the transient fields. */
function configOf(state: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(CONFIG_KEYS.filter(k => state[k] !== undefined).map(k => [k, state[k]]));
}

interface Drawn {
    state: Record<string, unknown>;
    /** Task cards outside the sidebar. */
    cards: number;
    /** The pinned lists drawn: their names and counts. */
    lists: { name: string | null; count: string | null }[];
}

/** Run `body` in the view `name` (with `gear()`, its settings menu opened), and read it once drawn. */
function op(name: string, body = ''): Drawn {
    return ev<Drawn>(`(async () => {
        ${PRELUDE}
        const gear = async () => { click(${JSON.stringify(name)}, 'button:has(> svg.lucide-settings)'); await wait(100); };
        ${body}
        await wait(700);
        const el = V(${JSON.stringify(name)}).contentEl;
        return JSON.stringify({
            state: V(${JSON.stringify(name)}).getState(),
            cards: [...el.querySelectorAll('.task-card')].filter(c => !c.closest('.pinned-list')).length,
            lists: [...el.querySelectorAll('.pinned-list')].map(s => ({
                name: s.querySelector('.pinned-list__name')?.textContent ?? null,
                count: s.querySelector('.pinned-list__count')?.textContent ?? null,
            })),
        });
    })()`);
}

/**
 * Save the view `name` from its settings menu, as `as`, through the name
 * dialog, and wait until the vault has read the note's frontmatter.
 * Returns the name the dialog offered.
 */
function saveView(name: string, as: string): string {
    return ev<string>(`(async () => {
        ${PRELUDE}
        click(${JSON.stringify(name)}, 'button:has(> svg.lucide-settings)');
        await wait(100);
        menuItem(i => i.titleEl?.textContent === ${JSON.stringify(tr('toolbar.saveView'))});
        await wait(200);
        const input = [...document.querySelectorAll('.input-modal input')].pop();
        if (!input) throw new Error('no name dialog');
        const offered = input.value;
        input.value = ${JSON.stringify(as)};
        key(input, 'Enter');
        const path = ${JSON.stringify(NOTE)};
        for (let i = 0; i < 30; i++) {
            await wait(100);
            const f = app.vault.getAbstractFileByPath(path);
            if (f && app.metadataCache.getFileCache(f)?.frontmatter?.['_tv-view']) break;
        }
        await wait(300);
        if (document.querySelector('.input-modal')) throw new Error('the name dialog stayed open');
        return JSON.stringify(offered);
    })()`);
}

/** The titles of Load view...'s submenu of the view `name`. */
function loadTitles(name: string): string[] {
    return ev<string[]>(`(async () => {
        ${PRELUDE}
        click(${JSON.stringify(name)}, 'button:has(> svg.lucide-settings)');
        await wait(100);
        const load = menuItems().find(i => i.titleEl?.textContent === ${JSON.stringify(tr('toolbar.loadView'))});
        const titles = load?.submenu?.items.map(i => i.titleEl?.textContent ?? '') ?? null;
        closeMenus();
        return JSON.stringify(titles);
    })()`);
}

/** The notes in the template folder. */
function notesInFolder(): string[] {
    return ev<string[]>(`(() => {
        const f = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)});
        return JSON.stringify(f?.children?.map(c => c.path) ?? []);
    })()`);
}

/** A note as saved: its frontmatter lines and its JSON block. */
function parseNote(text: string): { frontmatter: string[]; data: unknown } {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    const json = /```json\n([\s\S]*?)\n```/.exec(text);
    return { frontmatter: fm ? fm[1].split('\n') : [], data: json ? JSON.parse(json[1]) : null };
}

/** The query of a URI Copy URI wrote. */
function query(uri: string): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(uri.slice(uri.indexOf('?') + 1)));
}

function removeFolder(): void {
    ev(`(async () => {
        const f = app.vault.getAbstractFileByPath(${JSON.stringify(ROOT)});
        if (f) await app.vault.delete(f, true);
        return JSON.stringify(true);
    })()`);
}

let held: HeldSettings<'viewTemplateFolder'>;

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    const live = ev<boolean>(`(() => typeof app.plugins.plugins['obsidian-task-viewer'].viewEvents?.rollIfChanged === 'function')()`);
    if (!live) throw new Error('The Dev vault runs an older build: run `npm run build` and reload the plugin.');
    removeFolder();
    held = overrideSettings({ viewTemplateFolder: FOLDER });
    const today = visualDay(readSettings(['startHour']).startHour as number);
    expect(await writeIndexedTestFile(FILE, [
        `- [ ] vt one @${today} #tvvt`,
        `- [ ] vt two @${today} #tvvt #tvvtx`,
        `- [ ] vt untagged @${today}`,
        '',
    ].join('\n'))).toBe(true);
});

afterAll(async () => {
    await closeViews();
    removeFolder();
    held?.restore();
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe('Save view...', () => {
    let saved: Drawn;

    beforeAll(() => {
        openView('vt-src', 'timeline-view', {
            daysToShow: 4, zoomLevel: 1.5, showSidebar: true, filterState: TAGGED, pinnedLists: [LIST],
        });
    });

    it('writes the view as a note in the folder, named as the dialog was answered, and names the view after it', () => {
        const before = op('vt-src');
        // The view's filter lets the two tagged tasks through, its list the one of them.
        expect(before.cards).toBe(2);
        expect(before.lists).toEqual([{ name: LIST.name, count: '(1)' }]);
        expect(before.state.customName).toBeUndefined();

        const offered = saveView('vt-src', NAME);
        expect(offered).toBe(tr('view.timeline'));
        expect(notesInFolder()).toEqual([NOTE]);

        const note = parseNote(readTestFile(NOTE));
        expect(note.frontmatter).toEqual(['_tv-view: timeline', `_tv-name: "${NAME}"`]);
        expect(note.data).toEqual(configOf(before.state));
        expect(note.data).toMatchObject({ daysToShow: 4, zoomLevel: 1.5, showSidebar: true, filterState: TAGGED });
        expect((note.data as Record<string, unknown>).date).toBeUndefined();

        saved = op('vt-src');
        expect(saved.state.customName).toBe(NAME);
        expect(configOf(saved.state)).toEqual({ ...configOf(before.state), customName: NAME });
    });

    it('lists the note under Load view..., which opens the same view in another', () => {
        openView('vt-load', 'timeline-view');
        expect(loadTitles('vt-load')).toContain(NAME);
        const loaded = op('vt-load', `
            await gear();
            const load = menuItems().find(i => i.titleEl?.textContent === ${JSON.stringify(tr('toolbar.loadView'))});
            const item = load.submenu.items.find(i => i.titleEl?.textContent === ${JSON.stringify(NAME)});
            closeMenus();
            item.callback(new MouseEvent('click'));
        `);
        expect(configOf(loaded.state)).toEqual(configOf(saved.state));
        expect(loaded.cards).toBe(saved.cards);
        expect(loaded.lists).toEqual(saved.lists);
    });

    it('copies a URI that names the template, and that URI opens the same view', () => {
        const uri = copyUri('vt-src');
        // With a folder set, the URI names the template in place of the config.
        expect(query(uri)).toEqual({ view: 'timeline', position: 'tab', name: NAME, template: NAME });

        const opened = openUri('vt-uri', query(uri));
        expect(opened.type).toBe('timeline-view');
        expect(configOf(opened.state)).toEqual(configOf(saved.state));
        const drawn = op('vt-uri');
        expect(drawn.cards).toBe(saved.cards);
        expect(drawn.lists).toEqual(saved.lists);

        // The template alone names the view after it.
        const bare = openUri('vt-uri-bare', { view: 'timeline', template: NAME });
        expect(configOf(bare.state)).toEqual(configOf(saved.state));
    });

    it('writes over the note when saved again under its name', () => {
        op('vt-src', `V('vt-src').store.update({ daysToShow: 2 });`);
        const offered = saveView('vt-src', NAME);
        expect(offered).toBe(NAME);
        expect(notesInFolder()).toEqual([NOTE]);
        expect(parseNote(readTestFile(NOTE)).data).toMatchObject({ daysToShow: 2, customName: NAME });
    });
});

describe('Copy URI with a template folder set', () => {
    it("names a template after a view of no name of its own: the view's display name, with no config", () => {
        openView('vt-plain', 'timeline-view', { daysToShow: 5 });
        const uri = copyUri('vt-plain');
        expect(query(uri)).toEqual({ view: 'timeline', position: 'tab', template: tr('view.timeline') });
    });
});
