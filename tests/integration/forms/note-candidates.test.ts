/**
 * The notes a field suggests, listed and drawn as Obsidian's `[[` lists and
 * draws them (`NoteCandidates`, `candidateView`; `note-suggest/candidates.md`),
 * in the running Dev vault: the send dialog's note and the settings' note
 * templates. Each item is Obsidian's complex item (the name, its folder under
 * it at 12px with a `/` at its end, nothing under a note at the root); with
 * nothing typed the most recently modified come first; a note whose name
 * holds what is typed comes above one whose folder alone does; a list of
 * notes holds no image; picking a template puts its path in.
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
import { closeDialog, onDialog, openDialog } from '../helpers/send-dialog';

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

    it('lists the notes as Obsidian\'s items: the name, the folder under it, nothing under a note at the root; no image, no alias', () => {
        openDialog(SRC, '候補を見る');
        const listed = onDialog<{ items: (Item & { complex: boolean; noteEl: boolean; noteSize: string; titleSize: string; marked: boolean })[] }>(`
            typeIn(inputs()[1], ${JSON.stringify(`${DIR} `)});
            typeIn(inputs()[1], ${JSON.stringify(DIR)});
            await until(() => items().length > 0 && items().every(el => el.querySelector('.suggestion-title')));
            await sleep(100);
            return JSON.stringify({ items: items().map(el => ({
                ...itemOf(el),
                complex: el.classList.contains('mod-complex') && !!el.querySelector('.suggestion-content > .suggestion-title + .suggestion-note'),
                noteEl: !!el.querySelector('.suggestion-note'),
                noteSize: getComputedStyle(el.querySelector('.suggestion-note')).fontSize,
                titleSize: getComputedStyle(el.querySelector('.suggestion-title')).fontSize,
                marked: !!el.querySelector('.suggestion-highlight'),
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
        expect(listed.items.some(one => one.title === '画像.png' || one.title === '別名アルファ')).toBe(false);
        expect(ours.every(one => one.marked)).toBe(true);
        const sizes = new Set(listed.items.map(one => one.noteSize));
        expect([...sizes]).toEqual(['12px']);
        expect(parseFloat(listed.items[0].titleSize)).toBeGreaterThan(12);
    });

    it('with nothing typed, the most recently modified first; typed, a name\'s match above a folder\'s', () => {
        openDialog(SRC, '候補を見る');
        const lists = onDialog<{ empty: [string, number][]; qqx: Item[] }>(`
            typeIn(inputs()[1], '');
            await until(() => items().length > 0 && items().every(el => el.querySelector('.suggestion-title')));
            await sleep(100);
            const mtime = el => {
                const { title, note } = itemOf(el);
                return [note + title, app.vault.getAbstractFileByPath(note + title + '.md')?.stat.mtime ?? -1];
            };
            const empty = items().map(mtime);
            typeIn(inputs()[1], 'qqx');
            await until(() => items().some(el => itemOf(el).title === 'inner'));
            await sleep(100);
            return JSON.stringify({ empty, qqx: items().map(itemOf) });
        `);
        expect(lists.empty.length).toBeGreaterThan(5);
        expect(lists.empty.every(([, mtime]) => mtime > 0)).toBe(true);
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
