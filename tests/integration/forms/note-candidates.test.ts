/**
 * The notes a field suggests, listed and drawn as Obsidian's `[[` lists and
 * draws them (`NoteCandidates`, `candidateView`; `note-suggest/candidates.md`),
 * in the running Dev vault: the send dialog's note, the settings' note
 * templates, and the `[[` of the task name and of the source editor, whose
 * picks write the link Obsidian's `[[` writes (the note a link is spelt
 * from is the unit tests': the vault's link format is not changed here,
 * since one set and put back by a test was seen to come back changed). Each item is Obsidian's complex item (the name, its folder under
 * it at 12px with a `/` at its end, nothing under a note at the root); with
 * nothing typed the most recently modified come first; a note whose name
 * holds what is typed comes above one whose folder alone does; a list of
 * notes holds no image, the send dialog's holds an alias with its mark;
 * picking a template puts its path in.
 *
 * The notes are made through Obsidian (`app.vault.create`), one after
 * another, so their times of change are in the order they were made, and
 * are taken away at the end.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/note-candidates.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { waitForFileIndexed } from '../helpers/test-file-manager';
import { tr } from '../helpers/view-helper';
import { closeDialog, DIALOG, onDialog, openDialog } from '../helpers/send-dialog';

const DIR = 'test-int-nc';
const ROOT_NOTE = 'test-int-nc-root.md';
const SRC = `${DIR}/src.md`;

/** The notes made, in the order they are made (oldest first): path and text. */
const FIXTURES: [string, string][] = [
    [`${DIR}/a/同名ノート.md`, ''],
    [`${DIR}/b/同名ノート.md`, ''],
    [`${DIR}/qqx-name.md`, ''],
    // Made after the one its name matches: newer, and still below it.
    [`${DIR}/qqx/inner.md`, ''],
    [`${DIR}/別名元.md`, '---\naliases: [別名アルファ]\n---\n'],
    [`${DIR}/見出し元.md`, '# 見出しアルファ\n\n## 見出しベータ\n'],
    // A link to a note there is not.
    [`${DIR}/links.md`, '[[test-int-nc-未作成]]\n'],
    [ROOT_NOTE, ''],
    [SRC, '- [ ] 候補を見る\n'],
];

function run<T>(code: string): T {
    const result = obsidianEval(code);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** Take away what the tests made, through Obsidian; each path checked to be one of ours first. */
function cleanUp(): void {
    run(`(async () => {
        for (const path of ${JSON.stringify([ROOT_NOTE, DIR])}) {
            if (!path.startsWith('test-int-nc')) throw new Error('not ours: ' + path);
            const f = app.vault.getAbstractFileByPath(path);
            if (f) await app.vault.delete(f, true);
        }
        return JSON.stringify(true);
    })()`);
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    // Some of the dialog's events need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
    cleanUp();
    run(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        for (const [path, text] of ${JSON.stringify(FIXTURES)}) {
            const folder = path.split('/').slice(0, -1).join('/');
            if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
            await app.vault.create(path, text);
            await sleep(30);
        }
        // An image beside them, which a list of notes does not hold.
        await app.vault.createBinary(${JSON.stringify(`${DIR}/画像.png`)}, new Uint8Array([137, 80, 78, 71]).buffer);
        return JSON.stringify(true);
    })()`);
    await waitForFileIndexed(SRC);
});

afterAll(() => {
    cleanUp();
});

interface Item { title: string; note: string | null }

describe('the send dialog\'s note', () => {
    afterEach(() => { closeDialog(); });

    it('lists the notes as Obsidian\'s items: the name, the folder under it, nothing under a note at the root; an alias with its mark; no image', () => {
        openDialog(SRC, '候補を見る');
        const listed = onDialog<{ items: (Item & { complex: boolean; noteEl: boolean; noteSize: string; titleSize: string; marked: boolean; flair: string | null })[] }>(`
            typeIn(inputs()[0], ${JSON.stringify(`${DIR} `)});
            typeIn(inputs()[0], ${JSON.stringify(DIR)});
            await until(() => items().length > 0 && items().every(el => el.querySelector('.suggestion-title')));
            await sleep(100);
            return JSON.stringify({ items: items().map(el => ({
                ...itemOf(el),
                complex: el.classList.contains('mod-complex') && !!el.querySelector('.suggestion-content > .suggestion-title + .suggestion-note'),
                noteEl: !!el.querySelector('.suggestion-note'),
                noteSize: getComputedStyle(el.querySelector('.suggestion-note')).fontSize,
                titleSize: getComputedStyle(el.querySelector('.suggestion-title')).fontSize,
                marked: !!el.querySelector('.suggestion-highlight'),
                flair: el.querySelector('.suggestion-aux .suggestion-flair')?.getAttribute('aria-label') ?? null,
            })) });
        `);
        const ours = listed.items.filter(one => `${one.note}${one.title}`.startsWith('test-int-nc'));
        expect(ours.map(one => [one.title, one.note])).toEqual(expect.arrayContaining([
            ['同名ノート', `${DIR}/a/`],
            ['同名ノート', `${DIR}/b/`],
            ['inner', `${DIR}/qqx/`],
            ['test-int-nc-root', ''],
        ]));
        expect(listed.items.every(one => one.complex && one.noteEl)).toBe(true);
        expect(listed.items.some(one => one.title === '画像.png')).toBe(false);
        expect(ours.every(one => one.marked)).toBe(true);
        // The alias matches by itself, not by its note's path: typed in full, it is listed with its mark.
        const alias = onDialog<(Item & { flair: string | null })[]>(`
            typeIn(inputs()[0], '別名アルファ');
            await until(() => items().some(el => itemOf(el).title === '別名アルファ'));
            return JSON.stringify(items().map(el => ({ ...itemOf(el), flair: el.querySelector('.suggestion-aux .suggestion-flair')?.getAttribute('aria-label') ?? null })));
        `);
        expect(alias).toContainEqual({ title: '別名アルファ', note: `${DIR}/別名元`, flair: 'エイリアス' });
        const sizes = new Set(listed.items.map(one => one.noteSize));
        expect([...sizes]).toEqual(['12px']);
        expect(parseFloat(listed.items[0].titleSize)).toBeGreaterThan(12);
    });

    it('with nothing typed, the most recently modified first; typed, a name\'s match above a folder\'s', () => {
        openDialog(SRC, '候補を見る');
        const lists = onDialog<{ empty: [string, number][]; qqx: Item[] }>(`
            typeIn(inputs()[0], '');
            await until(() => items().length > 0 && items().every(el => el.querySelector('.suggestion-title')));
            await sleep(100);
            // A note by its folder and name, an alias by its note's path; an unresolved link has no time.
            const mtime = el => {
                const { title, note } = itemOf(el);
                const path = el.querySelector('.suggestion-flair') ? note : note + title;
                return [path, app.vault.getAbstractFileByPath(path + '.md')?.stat.mtime ?? -1];
            };
            const empty = items().map(mtime).filter(([, time]) => time >= 0);
            typeIn(inputs()[0], 'qqx');
            await until(() => items().some(el => itemOf(el).title === 'inner'));
            await sleep(100);
            return JSON.stringify({ empty, qqx: items().map(itemOf) });
        `);
        expect(lists.empty.length).toBeGreaterThan(5);
        expect(lists.empty).toEqual([...lists.empty].sort((a, b) => b[1] - a[1]));
        const titles = lists.qqx.map(one => one.title);
        expect(titles.indexOf('qqx-name')).toBeGreaterThanOrEqual(0);
        expect(titles.indexOf('qqx-name')).toBeLessThan(titles.indexOf('inner'));
    });
});

describe('the settings\' note template', () => {
    afterEach(() => {
        run(`(async () => { if (app.setting.activeTab) app.setting.close(); await new Promise(r => setTimeout(r, 300)); return 'ok'; })()`);
    });

    it('lists the notes alone, and a pick puts the note\'s path in and keeps it', () => {
        const name = tr('settings.notes.weeklyNoteTemplate');
        const picked = run<{ items: Item[]; value: string; kept: string }>(`(async () => {
            ${'' /* the settings as a person opens them */}
            const sleep = ms => new Promise(r => setTimeout(r, ms));
            const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
            const plugin = app.plugins.plugins['obsidian-task-viewer'];
            const before = plugin.settings.weeklyNoteTemplate;
            const settingsTab = () => app.setting.activeTab?.id === 'obsidian-task-viewer' ? app.setting.activeTab.containerEl : null;
            app.setting.open();
            app.setting.openTabById('obsidian-task-viewer');
            await until(() => settingsTab()?.isConnected && settingsTab().querySelector('.tv-settings__nav-btn'));
            settingsTab().querySelector('.tv-settings__nav-btn[data-tab-id="notes"]').click();
            await sleep(100);
            const panel = [...settingsTab().querySelectorAll('.tv-settings__panel')].find(p => p.style.display !== 'none');
            const setting = [...panel.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === ${JSON.stringify(name)});
            const input = setting.querySelector('.setting-item-control input');
            input.focus();
            input.value = ${JSON.stringify(`${DIR}/`)};
            input.dispatchEvent(new Event('input', { bubbles: true }));
            // The settings may stand in a window of their own, where the list opens.
            const items = () => [...new Set([document, input.ownerDocument])].flatMap(doc => [...doc.querySelectorAll('.suggestion-container .suggestion-item')]);
            if (!(await until(() => items().some(el => el.querySelector('.suggestion-title')?.textContent === 'qqx-name')))) throw new Error('no qqx-name listed');
            const listed = items().map(el => ({ title: el.querySelector('.suggestion-title')?.textContent ?? el.textContent, note: el.querySelector('.suggestion-note')?.textContent ?? null }));
            const item = items().find(el => el.querySelector('.suggestion-title')?.textContent === 'qqx-name');
            const r = item.getBoundingClientRect();
            const at = { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4, button: 0 };
            item.dispatchEvent(new MouseEvent('mousedown', at));
            item.dispatchEvent(new MouseEvent('mouseup', at));
            item.dispatchEvent(new MouseEvent('click', at));
            await sleep(300);
            const out = { items: listed, value: input.value, kept: plugin.settings.weeklyNoteTemplate };
            plugin.settings.weeklyNoteTemplate = before;
            await plugin.saveSettings();
            return JSON.stringify(out);
        })()`);
        expect(picked.items.some(one => one.title === '画像.png')).toBe(false);
        expect(picked.items.map(one => [one.title, one.note])).toEqual(expect.arrayContaining([['同名ノート', `${DIR}/a/`], ['inner', `${DIR}/qqx/`]]));
        expect(picked.value).toBe(`${DIR}/qqx-name.md`);
        expect(picked.kept).toBe(`${DIR}/qqx-name.md`);
    });
});

/**
 * The hub opened on the row of SRC, its name field and its source editor;
 * after the send dialog's prelude (`DIALOG`: `press`, `items`, `itemOf`,
 * `typeIn`). The name's text is put back before the hub closes, so nothing
 * is written.
 */
const HUB = `${DIALOG}
const hub = () => document.querySelector('.tv-overlay:not(.is-closing) .task-hub');
const nameInput = () => hub()?.querySelector('.tv-form__name-section input') ?? null;
const hubView = which => {
    const el = hub()?.querySelector('.tv-source-editor__' + which + ' .cm-content');
    return el ? (el.cmTile?.view ?? el.cmView?.rootView?.view ?? null) : null;
};
const openHub = async () => {
    const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(SRC)} && t.content === '候補を見る');
    if (!task) throw new Error('no row');
    plugin.openTaskHub(task.id);
    await until(() => nameInput());
    await sleep(100);
};
/** Type \`text\` after the name, pick the item titled \`pick\` (under \`note\`, when given), and read the name. */
const pickInName = async (text, pick, note) => {
    typeIn(nameInput(), '候補を見る ' + text);
    const item = () => items().find(el => itemOf(el).title === pick && (note === undefined || itemOf(el).note === note));
    if (!(await until(() => item()))) throw new Error('no ' + pick + ' in the list of ' + text);
    press(item());
    await sleep(100);
    const written = nameInput().value;
    typeIn(nameInput(), '候補を見る');
    await until(() => !document.querySelector('.suggestion-container'));
    return written;
};
`;

function onHub<T>(body: string): T {
    return run<T>(`(async () => { ${HUB}\n${body}\n})()`);
}

function closeHub(): void {
    onHub(`
        if (nameInput()) typeIn(nameInput(), '候補を見る');
        hub()?.closest('.tv-overlay__panel')?.querySelector('.tv-overlay__close')?.click();
        await sleep(100);
        document.querySelector('.task-hub__source-actions .tv-form__discard')?.click();
        await until(() => !document.querySelector('.task-hub') && !document.querySelector('.suggestion-container'));
        return 'ok';
    `);
}

describe('the task name\'s [[', () => {
    afterEach(() => { closeHub(); });

    it('lists every kind Obsidian lists, as its items: notes, an image, an alias with its mark, an unresolved link; the hint says nothing of ^', () => {
        const listed = onHub<{ items: (Item & { complex: boolean; noteSize: string; flair: string | null })[]; alias: (Item & { flair: string | null })[]; hint: string | null }>(`
            await openHub();
            typeIn(nameInput(), '候補を見る [[' + ${JSON.stringify(DIR)});
            await until(() => items().some(el => itemOf(el).title === '画像.png'));
            await sleep(100);
            const read = el => ({ ...itemOf(el), complex: el.classList.contains('mod-complex'), noteSize: getComputedStyle(el.querySelector('.suggestion-note')).fontSize, flair: el.querySelector('.suggestion-aux .suggestion-flair')?.getAttribute('aria-label') ?? null });
            const shownItems = items().map(read);
            const hint = document.querySelector('.suggestion-container .task-name-suggest__footer')?.textContent ?? null;
            typeIn(nameInput(), '候補を見る [[別名アルファ');
            await until(() => items().some(el => itemOf(el).title === '別名アルファ'));
            const alias = items().map(read);
            return JSON.stringify({ items: shownItems, alias, hint });
        `);
        expect(listed.items.map(one => [one.title, one.note])).toEqual(expect.arrayContaining([
            ['同名ノート', `${DIR}/a/`],
            ['同名ノート', `${DIR}/b/`],
            ['画像.png', `${DIR}/`],
            ['test-int-nc-未作成', ''],
        ]));
        expect(listed.items.every(one => one.complex)).toBe(true);
        expect([...new Set(listed.items.map(one => one.noteSize))]).toEqual(['12px']);
        expect(listed.alias).toContainEqual(expect.objectContaining({ title: '別名アルファ', note: `${DIR}/別名元`, flair: 'エイリアス' }));
        expect(listed.hint).toBe(tr('modal.taskNameHint.file'));
        expect(listed.hint).not.toContain('^');
    });

    it('a pick writes the link Obsidian\'s [[ writes', () => {
        const written = onHub<Record<string, string>>(`
            await openHub();
            return JSON.stringify({
                namesake: await pickInName('[[同名', '同名ノート', ${JSON.stringify(`${DIR}/b/`)}),
                alias: await pickInName('[[別名アルファ', '別名アルファ'),
                image: await pickInName('[[画像', '画像.png'),
                unresolved: await pickInName('[[test-int-nc-未作', 'test-int-nc-未作成'),
                heading: await pickInName('[[見出し元#ベータ', '見出しベータ'),
            });
        `);
        expect(written).toEqual({
            namesake: `候補を見る [[${DIR}/b/同名ノート|同名ノート]]`,
            alias: '候補を見る [[別名元|別名アルファ]]',
            image: '候補を見る [[画像.png]]',
            unresolved: '候補を見る [[test-int-nc-未作成]]',
            heading: '候補を見る [[見出し元#見出しベータ]]',
        });
    });
});

describe('the source editor\'s [[', () => {
    afterEach(() => { closeHub(); });

    it('draws Obsidian\'s items, the folder under the name, and a pick writes what the name\'s list writes', () => {
        const result = onHub<{ items: (Item & { cls: string; noteShown: boolean; labelShown: boolean })[]; line: string }>(`
            await openHub();
            document.querySelectorAll('.task-hub__mode-toggle button')[1].click();
            await until(() => hubView('parent'));
            const view = hubView('parent');
            view.focus();
            view.dispatch({ selection: { anchor: view.state.doc.length } });
            view.dispatch({ ...view.state.replaceSelection(' [[同名'), userEvent: 'input.type' });
            const options = () => [...(hub()?.querySelectorAll('.cm-tooltip-autocomplete li') ?? [])];
            await until(() => options().length >= 2);
            await sleep(100);
            const shownItems = options().map(li => ({
                ...itemOf(li),
                cls: li.className,
                noteShown: getComputedStyle(li.querySelector('.suggestion-note')).display !== 'none' && li.querySelector('.suggestion-note').getBoundingClientRect().height > 0,
                labelShown: getComputedStyle(li.querySelector('.cm-completionLabel')).display !== 'none',
            }));
            const b = options().find(li => itemOf(li).note === ${JSON.stringify(`${DIR}/b/`)});
            b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
            await sleep(200);
            return JSON.stringify({ items: shownItems, line: hubView('parent').state.doc.toString() });
        `);
        expect(result.items.map(one => [one.title, one.note])).toEqual(expect.arrayContaining([
            ['同名ノート', `${DIR}/a/`],
            ['同名ノート', `${DIR}/b/`],
        ]));
        expect(result.items.every(one => one.cls.includes('suggestion-item') && one.cls.includes('mod-complex') && one.noteShown && !one.labelShown)).toBe(true);
        expect(result.line).toBe(`- [ ] 候補を見る [[${DIR}/b/同名ノート|同名ノート]]`);
    });
});

