/**
 * The editor's line button, in the running E2E vault: a tv-inline task has
 * the task's menu, a Tasks task none, and a checkbox in a note the views do
 * not read the checkbox's menu, which has no Convert to Inline.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/editor/line-button.test.ts
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { obsidianEval } from '../helpers/cli-helper';
import { deleteTestFile, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';
import { overrideSettings, tr, type HeldSettings } from '../helpers/view-helper';
import { UNTIL, waitForFileDeindexed } from '../helpers/waits';

const MENU_FILE = 'test-int-linemenu.md';
const IGNORED_FILE = 'test-int-linemenu-ignored.md';

const MENU_NOTE = [
    '- [ ] インライン @2031-01-15',
    '- [ ] タスクス 📅 2031-01-15',
    '',
].join('\n');

const IGNORED_NOTE = [
    '---',
    'tv-ignore: true',
    '---',
    '- [ ] 範囲外',
    '',
].join('\n');

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
${UNTIL}
const R = (window.__tvLineButtonE2E ??= {});
const menuTitles = () => (plugin.menuPresenter.currentMenu?.items ?? []).map(i => i.titleEl?.textContent ?? '').filter(Boolean);
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** Close the menu and the leaves the test opened. */
function cleanUp(): void {
    run(`
        plugin.menuPresenter.dismiss();
        for (const name of Object.keys(R)) { R[name]?.detach(); delete R[name]; }
        return 'ok';
    `);
}

afterEach(() => { cleanUp(); });

afterAll(async () => {
    for (const file of [MENU_FILE, IGNORED_FILE]) {
        deleteTestFile(file);
        await waitForFileDeindexed(file);
    }
});

describe('the editor\'s line button', () => {
    let held: HeldSettings<'enableTasksPlugin' | 'editorMenuForTasks' | 'editorMenuForCheckboxes'> | undefined;
    afterAll(() => { held?.restore(); });

    it('a tv-inline task has the task\'s menu, a Tasks task none, a checkbox out of the read range the checkbox\'s', async () => {
        held = overrideSettings({ enableTasksPlugin: true, editorMenuForTasks: true, editorMenuForCheckboxes: true });
        await writeIndexedTestFile(MENU_FILE, MENU_NOTE);
        // The index leaves this note out (tv-ignore), so there is no listing of it to wait for.
        writeTestFile(IGNORED_FILE, IGNORED_NOTE);
        const steps = run<Record<string, unknown>>(`
            const open = async (path, name) => {
                await until(() => app.vault.getAbstractFileByPath(path));
                const leaf = app.workspace.getLeaf('tab');
                await leaf.openFile(app.vault.getAbstractFileByPath(path), { state: { mode: 'source', source: true } });
                R[name] = leaf;
                await sleep(800);
                return leaf;
            };
            /** Each line's text, and whether a button stands at its end. */
            const lines = leaf => [...leaf.view.contentEl.querySelectorAll('.cm-line')]
                .filter(l => l.textContent.includes('[ ]') || l.querySelector('.task-list-item-checkbox') || l.textContent.trim())
                .map(l => ({ text: l.textContent.replace(/\\s+$/, ''), button: !!l.querySelector('.tv-editor-menu-btn') }));
            const press = async (leaf, text) => {
                const line = [...leaf.view.contentEl.querySelectorAll('.cm-line')].find(l => l.textContent.includes(text));
                line.querySelector('.tv-editor-menu-btn').click();
                await until(() => menuTitles().length > 0);
                const titles = menuTitles();
                plugin.menuPresenter.dismiss();
                await sleep(100);
                return titles;
            };
            const read = await open(${JSON.stringify(MENU_FILE)}, 'menu');
            const ignored = await open(${JSON.stringify(IGNORED_FILE)}, 'ignored');
            return JSON.stringify({
                read: lines(read),
                ignored: lines(ignored),
                taskMenu: await press(read, 'インライン'),
                checkboxMenu: await press(ignored, '範囲外'),
                parsers: plugin.getIndex().getTasks().filter(t => t.file === ${JSON.stringify(MENU_FILE)}).map(t => t.parserId),
            });
        `);
        const buttonOf = (rows: unknown, text: string) => (rows as { text: string; button: boolean }[]).find(row => row.text.includes(text))?.button;
        expect(steps.parsers).toEqual(['tv-inline', 'tasks-plugin']);
        expect(buttonOf(steps.read, 'インライン')).toBe(true);
        expect(buttonOf(steps.read, 'タスクス')).toBe(false);
        expect(buttonOf(steps.ignored, '範囲外')).toBe(true);
        expect(steps.taskMenu).toContain(tr('menu.addChildTask'));
        expect(steps.checkboxMenu).toEqual([
            expect.stringContaining('[ ]'),
            tr('menu.duplicate'),
            tr('menu.deleteTask'),
        ]);
    });
});
