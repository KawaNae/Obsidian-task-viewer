/**
 * Sending a row and its subtree to a note (`NoteOps.send`, 段 B3), in the
 * running Dev vault: to a new note, to a note there is, to a heading of the
 * row's own note, and a send whose note the row came from refuses once the
 * new note is written, which takes the new note away again. Then the send
 * dialog (段 B5), opened from a card's menu: the note and the heading picked
 * from their lists with the pointer while the rows' editor holds a draft,
 * and a subtree it cannot open in the editor, shown as it stands. The
 * notes' bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build that sends rows to other notes
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/noteops/send.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { isObsidianRunning, obsidianEval, sleep } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, vaultAbsolute, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';

const SRC = 'test-int-send-src.md';
const DST = 'test-int-send-dst.md';
const NEW = 'test-int-send-new';

const SECTION = { heading: 'Tasks', level: 2, side: 'head' };

interface Sent {
    result: { kind: string; note?: string; refused?: string[] };
    notices: string[];
}

/**
 * Send the row of `SRC` whose text is `name` to `to`, through the plugin's
 * `NoteOps`, with `frontmatter` — after `prelude` (statements) has run in
 * Obsidian — and answer what came of it, with the notices it raised.
 */
function send(name: string, to: unknown, frontmatter: unknown[] = [], prelude = ''): Sent {
    const result = obsidianEval(`(async () => {
        const plugin = app.plugins.plugins['obsidian-task-viewer'];
        const task = plugin.getTaskIndex().getTasks().find(t => t.file === ${JSON.stringify(SRC)} && t.content === ${JSON.stringify(name)});
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        const before = document.querySelectorAll('.notice').length;
        ${prelude}
        const sent = await plugin.getNoteOps().send({
            rows: [{ taskId: task.id, base: task.subtreeLines }],
            to: ${JSON.stringify(to)},
            frontmatter: ${JSON.stringify(frontmatter)},
        });
        await new Promise(r => setTimeout(r, 300));
        const notices = [...document.querySelectorAll('.notice')].slice(before).map(el => el.textContent);
        return JSON.stringify({ result: { kind: sent.kind, note: sent.note?.path, refused: sent.refused }, notices });
    })()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as Sent;
}

function exists(path: string): boolean {
    return fs.existsSync(vaultAbsolute(path));
}

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
});

afterAll(async () => {
    for (const path of [SRC, DST, `${NEW}.md`]) deleteTestFile(path);
    await waitForFileDeindexed(SRC);
});

describe('sending a row', () => {
    it('to a new note: made of the keys and the row under the heading, a link left in the row\'s place', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['# 送り元', '- [ ] 設計 @2026-09-29 ^e2e', '    - [ ] 下書き', '    メモ', '- [ ] 残る', ''].join('\n'));

        const sent = send('設計', { note: { kind: 'new', folder: '', name: NEW }, section: SECTION },
            [{ key: 'tv-color', yaml: ['tv-color: "blue"'], from: [], obsidian: false }]);

        expect(sent.result).toEqual({ kind: 'done', note: `${NEW}.md` });
        expect(sent.notices).toHaveLength(1);
        expect(sent.notices[0]).toContain(`${NEW}.md`);
        expect(readTestFile(`${NEW}.md`)).toBe(['---', 'tv-color: "blue"', '---', '', '## Tasks', '- [ ] 設計 @2026-09-29 ^e2e', '    - [ ] 下書き', '    メモ', ''].join('\n'));
        expect(readTestFile(SRC)).toBe(['# 送り元', `- [[${NEW}]]`, '- [ ] 残る', ''].join('\n'));
        deleteTestFile(`${NEW}.md`);
    });

    it('to a note there is: only the keys it lacks added, the row at the head of its section', async () => {
        await writeIndexedTestFile(DST, ['---', 'tv-color: "red"', '---', '# 送り先', '', '## Tasks', '- [ ] 前からある', ''].join('\n'));
        await writeIndexedTestFile(SRC, ['1. [ ] 手順 ^s1', '    - [ ] 子', '2. [ ] 次', ''].join('\n'));

        const sent = send('手順', { note: { kind: 'existing', path: DST }, section: SECTION }, [
            { key: 'tv-color', yaml: ['tv-color: "blue"'], from: [], obsidian: false },
            { key: 'tags', yaml: ['tags:', '  - e2e'], from: [], obsidian: false },
        ]);

        expect(sent.result).toEqual({ kind: 'done', note: DST });
        expect(readTestFile(DST)).toBe(['---', 'tv-color: "red"', 'tags:', '  - e2e', '---', '# 送り先', '', '## Tasks', '1. [ ] 手順 ^s1', '    - [ ] 子', '- [ ] 前からある', ''].join('\n'));
        expect(readTestFile(SRC)).toBe([`1. [[${DST.replace(/\.md$/, '')}]]`, '2. [ ] 次', ''].join('\n'));
    });

    it('to a heading of its own note: carried in one write, and not told', async () => {
        await writeIndexedTestFile(SRC, ['- [ ] 動く', '    - [ ] 子', '## Done', '- [x] 済み', ''].join('\n'));

        const sent = send('動く', { note: { kind: 'existing', path: SRC }, section: { ...SECTION, heading: 'Done' } });

        expect(sent.result).toEqual({ kind: 'done', note: SRC });
        expect(sent.notices).toEqual([]);
        expect(readTestFile(SRC)).toBe(['## Done', '- [ ] 動く', '    - [ ] 子', '- [x] 済み', ''].join('\n'));
    });

    it('whose note is edited just as the new note is written: the new note taken away, the row left, told once', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['- [ ] 取り消す', '    - [ ] 子', ''].join('\n'));

        // The note the row came from is saved from outside at the moment
        // its write comes, after the new note is made.
        const sent = send('取り消す', { note: { kind: 'new', folder: '', name: NEW }, section: SECTION }, [], `
            const process = app.vault.process;
            app.vault.process = async function (file, fn, ...rest) {
                if (file.path === ${JSON.stringify(SRC)}) {
                    app.vault.process = process;
                    await app.vault.modify(file, (await app.vault.read(file)) + '外から\\n');
                }
                return process.call(this, file, fn, ...rest);
            };
        `);

        expect(sent.result.kind).toBe('not-done');
        expect(sent.notices).toHaveLength(1);
        expect(sent.notices[0]).toContain(SRC);
        await sleep(500);
        expect(exists(`${NEW}.md`)).toBe(false);
        expect(readTestFile(SRC)).toBe(['- [ ] 取り消す', '    - [ ] 子', '外から', ''].join('\n'));
    });
});

/**
 * What every snippet on the dialog starts with: the plugin, the dialog as it
 * is drawn, and a press of the pointer as a mouse makes one.
 */
const DIALOG = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const panel = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-send');
const inputs = () => [...(panel()?.querySelectorAll('.tv-send__destination input') ?? [])];
const shown = el => !!el && getComputedStyle(el).display !== 'none';
const viewOf = which => {
    const el = panel()?.querySelector('.tv-source-editor__' + which + ' .cm-content');
    return el ? (el.cmTile?.view ?? el.cmView?.rootView?.view ?? null) : null;
};
const state = () => ({
    open: !!panel(),
    closing: !!document.querySelector('.tv-overlay.is-closing'),
    name: inputs()[0]?.value ?? null,
    folder: inputs()[1]?.value ?? null,
    heading: inputs()[2]?.value ?? null,
    says: shown(panel()?.querySelector('.tv-send__says')) ? panel().querySelector('.tv-send__says').textContent : null,
    asking: shown(panel()?.querySelector('.tv-send__ask')),
    canSend: panel() ? !panel().querySelector('.tv-send__actions .mod-cta').disabled : false,
    editors: panel()?.querySelectorAll('.tv-send__row-list .cm-content').length ?? 0,
    fixed: panel()?.querySelector('.tv-send__fixed pre')?.textContent ?? null,
    why: panel()?.querySelector('.tv-send__fixed .tv-form__info')?.textContent ?? null,
});
const press = el => {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + 4, clientY: r.top + 4, button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    el.dispatchEvent(new MouseEvent('mousedown', at));
    el.dispatchEvent(new PointerEvent('pointerup', at));
    el.dispatchEvent(new MouseEvent('mouseup', at));
    el.dispatchEvent(new MouseEvent('click', at));
};
/** Type \`text\` into the field \`i\` (name, folder, heading), and press the item of its list that reads \`pick\`. */
const pickFrom = async (i, text, pick) => {
    const input = inputs()[i];
    input.focus();
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const item = () => [...document.querySelectorAll('.suggestion-container .suggestion-item')].find(el => el.textContent === pick);
    if (!(await until(() => item()))) throw new Error('no ' + pick + ' in the list of ' + text);
    press(item());
    await sleep(100);
};
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the dialog's prelude. */
function onDialog<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${DIALOG}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

interface DialogState {
    open: boolean;
    closing: boolean;
    name: string | null;
    folder: string | null;
    heading: string | null;
    says: string | null;
    asking: boolean;
    canSend: boolean;
    editors: number;
    fixed: string | null;
    why: string | null;
}

/** Open the dialog on the row of `SRC` whose text is `name`, as its card's menu does. */
function openDialog(name: string): DialogState {
    return onDialog<DialogState>(`
        const task = plugin.getTaskIndex().getTasks().find(t => t.file === ${JSON.stringify(SRC)} && t.content === ${JSON.stringify(name)});
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        await plugin.hubMenuHandler.showContextMenu(0, 0, task);
        const menu = plugin.menuPresenter.currentMenu;
        const item = menu?.items.find(one => one.titleEl?.textContent === 'ノートへ送る');
        if (!item) throw new Error('no send in the menu');
        menu.hide();
        item.callback(new MouseEvent('click'));
        await until(() => panel() && state().canSend);
        return JSON.stringify(state());
    `);
}

/** Close the dialog if it is open, throwing its draft away if it asks. */
function closeDialog(): void {
    onDialog(`
        panel()?.querySelector('.tv-overlay__close')?.click();
        await sleep(100);
        panel()?.querySelector('.tv-send__discard')?.click();
        await until(() => !panel());
        return 'ok';
    `);
}

describe('the send dialog', () => {
    // Some of the dialog's events need the window to have the focus.
    beforeAll(() => { if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']); });
    afterEach(() => { closeDialog(); });

    it('picks the note and the heading from their lists with the pointer, a draft kept, and moves the draft to the heading of its own note', async () => {
        await writeIndexedTestFile(SRC, ['- [ ] 動かす', '    - [ ] 子', '## Done', '- [x] 済み', ''].join('\n'));
        const opened = openDialog('動かす');
        expect(opened).toMatchObject({ open: true, name: '動かす', editors: 2, asking: false });

        const picked = onDialog<DialogState & { draft: string }>(`
            const children = viewOf('children');
            children.dispatch({ changes: { from: children.state.doc.line(1).to, insert: '2' } });
            await pickFrom(0, ${JSON.stringify(SRC.slice(0, -5))}, ${JSON.stringify(SRC)});
            await until(() => state().says?.includes('このノート'));
            await pickFrom(2, 'Do', 'Done');
            await until(() => state().says?.includes('Done') && state().canSend);
            return JSON.stringify({ ...state(), draft: children.state.doc.toString() });
        `);
        // A press on either list neither closed the dialog nor asked to throw the draft away.
        expect(picked).toMatchObject({ open: true, closing: false, asking: false, name: SRC.slice(0, -3), folder: '', heading: 'Done', canSend: true, draft: '- [ ] 子2' });
        expect(picked.says).toContain('このノートの見出し Done');

        const sent = onDialog<{ open: boolean; notices: number }>(`
            const before = document.querySelectorAll('.notice').length;
            panel().querySelector('.tv-send__actions .mod-cta').click();
            await until(() => !panel());
            await sleep(300);
            return JSON.stringify({ open: !!panel(), notices: document.querySelectorAll('.notice').length - before });
        `);
        expect(sent).toEqual({ open: false, notices: 0 });
        expect(readTestFile(SRC)).toBe(['## Done', '- [ ] 動かす', '    - [ ] 子2', '- [x] 済み', ''].join('\n'));
    });

    it('shows a subtree it cannot open in the editor as it stands, from the first column, and sends it so', async () => {
        await writeIndexedTestFile(SRC, ['## Done', '- [x] 済み', '    - [ ] 浅い', '      続き', '        - [ ] 子', ''].join('\n'));
        const opened = openDialog('浅い');
        expect(opened).toMatchObject({ open: true, editors: 0, fixed: '- [ ] 浅い\n  続き\n    - [ ] 子' });
        expect(opened.why).toContain('1 行目');

        const sent = onDialog<DialogState>(`
            const [name, , heading] = inputs();
            name.value = ${JSON.stringify(SRC.slice(0, -3))};
            name.dispatchEvent(new Event('input', { bubbles: true }));
            heading.value = 'Done';
            heading.dispatchEvent(new Event('input', { bubbles: true }));
            await until(() => state().says?.includes('Done') && state().canSend);
            panel().querySelector('.tv-send__actions .mod-cta').click();
            await until(() => !panel());
            return JSON.stringify(state());
        `);
        expect(sent.open).toBe(false);
        expect(readTestFile(SRC)).toBe(['## Done', '- [ ] 浅い', '  続き', '    - [ ] 子', '- [x] 済み', ''].join('\n'));
    });
});
