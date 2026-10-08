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
import { closeDialog, onDialog, openDialog as openDialogOn, type DialogState } from '../helpers/send-dialog';
import { deleteTestFile, readTestFile, vaultAbsolute, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';

const SRC = 'test-int-send-src.md';
const DST = 'test-int-send-dst.md';
const NEW = 'test-int-send-new';
const RENAMED = 'test-int-send-renamed.md';

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
        const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(SRC)} && t.content === ${JSON.stringify(name)});
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        const before = new Set(document.querySelectorAll('.notice'));
        ${prelude}
        const sent = await plugin.getNoteOps().send({
            rows: [{ taskId: task.id, base: task.subtreeLines }],
            to: ${JSON.stringify(to)},
            frontmatter: ${JSON.stringify(frontmatter)},
        });
        await new Promise(r => setTimeout(r, 300));
        // Those raised since, by the elements: one raised before may be gone by now.
        const notices = [...document.querySelectorAll('.notice')].filter(el => !before.has(el)).map(el => el.textContent);
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
    for (const path of [SRC, DST, `${NEW}.md`, RENAMED]) deleteTestFile(path);
    await waitForFileDeindexed(SRC);
});

describe('sending a row', () => {
    it('to a new note: made of the keys and the row under the heading, a link left in the row\'s place', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['# 送り元', '- [ ] 設計 @2026-09-29 ^e2e', '    - [ ] 下書き', '    メモ', '- [ ] 残る', ''].join('\n'));

        const sent = send('設計', { note: { kind: 'new', path: `${NEW}.md` }, section: SECTION },
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
        const sent = send('取り消す', { note: { kind: 'new', path: `${NEW}.md` }, section: SECTION }, [], `
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
 * Start a count-up on the row of `SRC` whose text is `name`, in `mode`, and
 * answer the timer's id and ^ids once its first line is written.
 */
function startTimer(name: string, mode: 'child' | 'sibling'): { id: string; target: string; tail: string } {
    const result = obsidianEval(`(async () => {
        const plugin = app.plugins.plugins['obsidian-task-viewer'];
        const widget = plugin.getTimerWidget();
        const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(SRC)} && t.content === ${JSON.stringify(name)});
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        const before = new Set(widget.board.values().map(t => t.id));
        widget.startTimer(task, ${JSON.stringify(mode)}, { kind: 'countup' });
        const timer = widget.board.values().find(t => t.measure.type === 'countup' && !before.has(t.id));
        if (!timer) throw new Error('no timer started on ' + ${JSON.stringify(name)});
        const end = Date.now() + 5000;
        while (Date.now() < end && !(timer.tail && !timer.opening)) await new Promise(r => setTimeout(r, 50));
        await new Promise(r => setTimeout(r, 300));
        return JSON.stringify({ id: timer.id, target: timer.subject.anchor, tail: timer.tail });
    })()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as { id: string; target: string; tail: string };
}

/** The note the timer `id` finds its lines in, or null when it is closed. */
function timerFile(id: string): string | null {
    return obsidianEval(`JSON.stringify(app.plugins.plugins['obsidian-task-viewer'].getTimerWidget().board.get(${JSON.stringify(id)})?.file ?? null)`) as string | null;
}

/**
 * The note name the header of the timer `id` shows, once it is `expected`,
 * or what it shows after a wait: the header follows the index's change,
 * which comes a moment after the timer's note changed.
 */
function timerFileShown(id: string, expected: string | null): string | null {
    return obsidianEval(`(async () => {
        const shown = () => document.querySelector('[data-timer-id="${id}"] .timer-widget__title-file')?.textContent ?? null;
        const end = Date.now() + 3000;
        while (Date.now() < end && shown() !== ${JSON.stringify(expected)}) await new Promise(r => setTimeout(r, 50));
        return JSON.stringify(shown());
    })()`) as string | null;
}

/** Press ⏸ (record and suspend) on the timer `id`, or ■ (record and close), and wait for it. */
function stopTimer(id: string, how: 'suspend' | 'close'): void {
    obsidianEval(`(async () => {
        const widget = app.plugins.plugins['obsidian-task-viewer'].getTimerWidget();
        const timer = widget.board.get(${JSON.stringify(id)});
        if (timer) await widget.lifecycle.stop(timer, ${JSON.stringify(how)});
        await new Promise(r => setTimeout(r, 500));
        return JSON.stringify(true);
    })()`);
}

/** Close the timer `id` without recording, if it is open. */
function closeTimer(id: string): void {
    obsidianEval(`(async () => {
        const widget = app.plugins.plugins['obsidian-task-viewer'].getTimerWidget();
        const timer = widget.board.get(${JSON.stringify(id)});
        if (timer) widget.lifecycle.close(timer, true);
        await new Promise(r => setTimeout(r, 500));
        return JSON.stringify(true);
    })()`);
}

describe('sending a row a timer runs on (段 B4)', () => {
    let open: string | null = null;
    afterEach(() => {
        if (open) closeTimer(open);
        open = null;
    });

    it('its lines all sent: the timer follows them, and ⏸ records in the note they went to', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['- [ ] 計る', '- [ ] 残る', ''].join('\n'));
        const timer = startTimer('計る', 'child');
        open = timer.id;
        expect(readTestFile(SRC)).toContain(`^${timer.tail}`);

        const sent = send('計る', { note: { kind: 'new', path: `${NEW}.md` }, section: SECTION });

        expect(sent.result).toEqual({ kind: 'done', note: `${NEW}.md` });
        expect(timerFile(timer.id)).toBe(`${NEW}.md`);
        expect(timerFileShown(timer.id, NEW)).toBe(NEW);
        expect(readTestFile(SRC)).toBe([`- [[${NEW}]]`, '- [ ] 残る', ''].join('\n'));

        stopTimer(timer.id, 'suspend');
        const made = readTestFile(`${NEW}.md`)!.split('\n');
        const record = made.find(line => line.includes(`^${timer.tail}`));
        expect(record).toMatch(/@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}>\d{2}:\d{2}/);
        expect(made.indexOf(record!)).toBeGreaterThan(made.findIndex(line => line.includes('計る')));
        expect(readTestFile(SRC)).toBe([`- [[${NEW}]]`, '- [ ] 残る', ''].join('\n'));
        deleteTestFile(`${NEW}.md`);
    });

    it('its records staying beside the row sent: not sent, nothing written, and told why', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['- [x] 続き', ''].join('\n'));
        const timer = startTimer('続き', 'sibling');
        open = timer.id;
        const before = readTestFile(SRC);

        const sent = send('続き', { note: { kind: 'new', path: `${NEW}.md` }, section: SECTION });

        expect(sent.result.kind).toBe('not-done');
        expect(sent.notices).toHaveLength(1);
        expect(sent.notices[0]).toContain(`^${timer.target}`);
        expect(sent.notices[0]).toContain(`^${timer.tail}`);
        await sleep(300);
        expect(exists(`${NEW}.md`)).toBe(false);
        expect(readTestFile(SRC)).toBe(before);
        expect(timerFile(timer.id)).toBe(SRC);
    });

    it('its note renamed: the timer and the note name its header shows follow the note', async () => {
        deleteTestFile(RENAMED);
        await writeIndexedTestFile(SRC, ['- [ ] 名前が変わる', ''].join('\n'));
        const timer = startTimer('名前が変わる', 'child');
        open = timer.id;
        expect(timerFileShown(timer.id, SRC.replace(/\.md$/, ''))).toBe(SRC.replace(/\.md$/, ''));

        obsidianEval(`(async () => {
            await app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(SRC)}), ${JSON.stringify(RENAMED)});
            return JSON.stringify(true);
        })()`);

        expect(timerFile(timer.id)).toBe(RENAMED);
        expect(timerFileShown(timer.id, RENAMED.replace(/\.md$/, ''))).toBe(RENAMED.replace(/\.md$/, ''));
        closeTimer(timer.id);
        open = null;
        deleteTestFile(RENAMED);
    });
});

/** Open the dialog on the row of `SRC` whose text is `name`, from its card's menu. */
function openDialog(name: string): DialogState {
    return openDialogOn(SRC, name);
}

describe('the send dialog', () => {
    // Some of the dialog's events need the window to have the focus.
    beforeAll(() => { if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']); });
    afterEach(() => { closeDialog(); });

    it('picks the note and the heading from their lists with the pointer, a draft kept, and moves the draft to the heading of its own note', async () => {
        await writeIndexedTestFile(SRC, ['- [ ] 動かす', '    - [ ] 子', '## Done', '- [x] 済み', ''].join('\n'));
        const opened = openDialog('動かす');
        expect(opened).toMatchObject({ open: true, note: '動かす', editors: 2, asking: false });

        const picked = onDialog<DialogState & { draft: string }>(`
            const children = viewOf('children');
            children.dispatch({ changes: { from: children.state.doc.line(1).to, insert: '2' } });
            await pickFrom(0, ${JSON.stringify(SRC.slice(0, -5))}, ${JSON.stringify(SRC.slice(0, -3))});
            await until(() => state().noteSays?.includes('このノート'));
            await pickFrom(1, 'Do', 'Done');
            await until(() => state().says?.includes('Done') && state().canSend);
            return JSON.stringify({ ...state(), draft: children.state.doc.toString() });
        `);
        // A press on either list neither closed the dialog nor asked to throw the draft away.
        expect(picked).toMatchObject({ open: true, closing: false, asking: false, note: SRC.slice(0, -3), heading: 'Done', canSend: true, draft: '- [ ] 子2' });
        expect(picked.noteSays).toBe(`このノート ${SRC}`);
        expect(picked.says).toBe('見出し Done の先頭へ移します');

        const sent = onDialog<{ open: boolean; notices: number }>(`
            const before = new Set(document.querySelectorAll('.notice'));
            panel().querySelector('.tv-form__buttons .mod-cta').click();
            await until(() => !panel());
            await sleep(300);
            return JSON.stringify({ open: !!panel(), notices: [...document.querySelectorAll('.notice')].filter(el => !before.has(el)).length });
        `);
        expect(sent).toEqual({ open: false, notices: 0 });
        expect(readTestFile(SRC)).toBe(['## Done', '- [ ] 動かす', '    - [ ] 子2', '- [x] 済み', ''].join('\n'));
    });

    it('says why each row\'s draft cannot be written under that row, two rows of the same reason each', async () => {
        await writeIndexedTestFile(SRC, ['- [ ] 一つ目', '- [ ] 二つ目', ''].join('\n'));
        const said = onDialog<{ rows: string[][]; canSend: boolean }>(`
            // The menu sends one row; the dialog is asked for both, as a send of two rows is made.
            const ops = plugin.getNoteOps();
            const rows = ['一つ目', '二つ目'].map(name => plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(SRC)} && t.content === name));
            const previewSend = ops.previewSend;
            ops.previewSend = () => previewSend.call(ops, rows.map(row => row.id));
            try {
                if (!plugin.taskHub.cards) {
                    plugin.openTaskHub(rows[0].id);
                    await until(() => document.querySelector('.task-hub'));
                    document.querySelector('.task-hub')?.closest('.tv-overlay__panel')?.querySelector('.tv-overlay__close')?.click();
                    await until(() => !document.querySelector('.task-hub'));
                }
                await plugin.taskHub.cards.menuHandler.showContextMenu(0, 0, rows[0]);
                const menu = plugin.menuPresenter.currentMenu;
                const item = menu?.items.find(one => one.titleEl?.textContent === 'ノートへ送る');
                menu.hide();
                item.callback(new MouseEvent('click'));
                await until(() => panel() && panel().querySelectorAll('.tv-source-editor__parent .cm-content').length === 2);
            } finally {
                ops.previewSend = previewSend;
            }
            // Each row's first line made no task line.
            for (const content of panel().querySelectorAll('.tv-source-editor__parent .cm-content')) {
                const view = content.cmTile?.view ?? content.cmView?.rootView?.view;
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'ただの行' } });
            }
            await sleep(200);
            const rowSays = [...panel().querySelectorAll('.tv-send__row-says')].map(el => [...el.children].map(c => c.className + ': ' + c.textContent));
            return JSON.stringify({ rows: rowSays, canSend: state().canSend });
        `);
        const notTask = 'tv-form__error: 1行目がタスクの行ではありません。';
        expect(said).toEqual({ rows: [[notTask], [notTask]], canSend: false });
    });

    it('shows a subtree it cannot open in the editor as it stands, from the first column, and sends it so', async () => {
        await writeIndexedTestFile(SRC, ['## Done', '- [x] 済み', '    - [ ] 浅い', '      続き', '        - [ ] 子', ''].join('\n'));
        const opened = openDialog('浅い');
        expect(opened).toMatchObject({ open: true, editors: 0, fixed: '- [ ] 浅い\n  続き\n    - [ ] 子' });
        expect(opened.why).toContain('1 行目');

        const sent = onDialog<DialogState>(`
            const [note, heading] = inputs();
            note.value = ${JSON.stringify(SRC.slice(0, -3))};
            note.dispatchEvent(new Event('input', { bubbles: true }));
            heading.value = 'Done';
            heading.dispatchEvent(new Event('input', { bubbles: true }));
            await until(() => state().says?.includes('Done') && state().canSend);
            panel().querySelector('.tv-form__buttons .mod-cta').click();
            await until(() => !panel());
            return JSON.stringify(state());
        `);
        expect(sent.open).toBe(false);
        expect(readTestFile(SRC)).toBe(['## Done', '- [ ] 浅い', '  続き', '    - [ ] 子', '- [x] 済み', ''].join('\n'));
    });
});

/**
 * The note field (`note-suggest/send-field.md`): which note a name, a path
 * or a pick points at, and what is said of it under the field. The notes
 * are made through Obsidian in a folder of their own and taken away at the
 * end; the row is written anew for each send, which takes it away.
 */
describe('the send dialog\'s note field', () => {
    const DIR = 'test-int-send-nf';
    const ROW = '送り先を選ぶ';
    const UNRESOLVED = 'test-int-send-nf-未解決';

    const vaultDo = (body: string) => onDialog(`${body}\nreturn 'ok';`);
    const makeNotes = () => vaultDo(`
        const notes = ${JSON.stringify([
            [`${DIR}/a/同名.md`, ''],
            [`${DIR}/b/同名.md`, ''],
            [`${DIR}/唯一.md`, ''],
            [`${DIR}/別名元.md`, '---\naliases: [送り先の別名]\n---\n'],
            [`${DIR}/links.md`, `[[${UNRESOLVED}]]\n`],
        ])};
        for (const [path, text] of notes) {
            const folder = path.split('/').slice(0, -1).join('/');
            if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
            if (!app.vault.getAbstractFileByPath(path)) await app.vault.create(path, text);
        }
        await until(() => Object.values(app.metadataCache.unresolvedLinks).some(links => ${JSON.stringify(UNRESOLVED)} in links));
    `);
    const takeAway = () => vaultDo(`
        for (const path of ${JSON.stringify([DIR, `${UNRESOLVED}.md`])}) {
            if (!path.startsWith('test-int-send-nf')) throw new Error('not ours: ' + path);
            const f = app.vault.getAbstractFileByPath(path);
            if (f) await app.vault.delete(f, true);
        }
    `);
    /** The row, written anew, and the dialog opened on it. */
    const openOnRow = async () => {
        await writeIndexedTestFile(SRC, [`- [ ] ${ROW}`, ''].join('\n'));
        return openDialog(ROW);
    };
    /** Type `text` in the note field, and the state once the destination is answered for it. */
    const typeNote = (text: string) => onDialog<DialogState>(`
        typeIn(inputs()[0], ${JSON.stringify(text)});
        document.activeElement?.blur();
        await sleep(100);
        await until(() => state().noteSays || state().noteErrors);
        await sleep(200);
        return JSON.stringify(state());
    `);
    /** Press send, and wait for the dialog to close. */
    const sendNow = () => onDialog<DialogState>(`
        panel().querySelector('.tv-form__buttons .mod-cta').click();
        await until(() => !panel());
        await sleep(300);
        return JSON.stringify(state());
    `);
    const lines = (path: string) => (exists(path) ? readTestFile(path) : null);

    beforeAll(() => {
        if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
        takeAway();
        makeNotes();
    });
    afterEach(() => { closeDialog(); });
    afterAll(() => { takeAway(); });

    it('a name one note has: that note, in whatever folder, and the row goes to it', async () => {
        await openOnRow();
        const s = typeNote('唯一');
        expect(s).toMatchObject({ noteSays: `既存のノート ${DIR}/唯一.md`, noteErrors: null, canSend: true });
        expect(sendNow().open).toBe(false);
        expect(lines(`${DIR}/唯一.md`)).toContain(`- [ ] ${ROW}`);
    });

    it('a name no note has: a new note in the folder for new notes, said in a warning', async () => {
        await openOnRow();
        const s = onDialog<DialogState & { tone: string | null }>(`
            typeIn(inputs()[0], 'test-int-send-nf-無い名前');
            document.activeElement?.blur();
            await until(() => state().noteSays?.includes('無い名前'));
            const line = inputs()[0].closest('.tv-form__row').nextElementSibling.firstElementChild;
            return JSON.stringify({ ...state(), tone: line?.className ?? null });
        `);
        expect(s.noteSays).toMatch(/^一致するノートがありません。新しいノート .*test-int-send-nf-無い名前\.md を作ります$/);
        expect(s.tone).toBe('tv-form__warning');
        expect(s.says).toBe('見出し Tasks を作り、その下に置きます');
        expect(s.canSend).toBe(true);
    });

    it('a name two notes have: no send, both paths said; picked from the list, the one picked', async () => {
        await openOnRow();
        const s = typeNote('同名');
        expect(s.canSend).toBe(false);
        expect(s.noteErrors).toBe(`「同名」に当たるノートが 2 件あります（${DIR}/a/同名.md, ${DIR}/b/同名.md）。候補から選んでください`);

        const picked = onDialog<DialogState>(`
            await pickFrom(0, '同名', '同名', ${JSON.stringify(`${DIR}/b/`)});
            await until(() => state().canSend);
            return JSON.stringify(state());
        `);
        expect(picked).toMatchObject({ note: '同名', noteSays: `既存のノート ${DIR}/b/同名.md`, noteErrors: null, canSend: true });
        sendNow();
        expect(lines(`${DIR}/b/同名.md`)).toContain(`- [ ] ${ROW}`);
        expect(lines(`${DIR}/a/同名.md`)).not.toContain(ROW);
    });

    it('a pick let go once the text changes: the text read on its own again', async () => {
        await openOnRow();
        const s = onDialog<DialogState>(`
            await pickFrom(0, '同名', '同名', ${JSON.stringify(`${DIR}/a/`)});
            await until(() => state().canSend);
            typeIn(inputs()[0], '同名x');
            typeIn(inputs()[0], '同名');
            document.activeElement?.blur();
            await until(() => state().noteErrors);
            return JSON.stringify(state());
        `);
        expect(s.canSend).toBe(false);
        expect(s.noteErrors).toContain('「同名」に当たるノートが 2 件あります');
    });

    it('a path whose folder is not there: the note and the folder made, and the row goes to it', async () => {
        await openOnRow();
        const s = typeNote(`${DIR}/新しい/作る`);
        expect(s.noteSays).toBe(`新しいノート ${DIR}/新しい/作る.md を作ります フォルダ ${DIR}/新しい も作ります`);
        expect(s.canSend).toBe(true);
        sendNow();
        expect(lines(`${DIR}/新しい/作る.md`)).toContain(`- [ ] ${ROW}`);
    });

    it('an alias picked: its note named in the field, and the row goes to that note', async () => {
        await openOnRow();
        const s = onDialog<DialogState>(`
            await pickFrom(0, '送り先の別名', '送り先の別名');
            await until(() => state().canSend);
            return JSON.stringify(state());
        `);
        expect(s).toMatchObject({ note: '別名元', noteSays: `既存のノート ${DIR}/別名元.md` });
        sendNow();
        expect(lines(`${DIR}/別名元.md`)).toContain(`- [ ] ${ROW}`);
    });

    it('an unresolved link picked: a new note by its name, made as the row goes to it', async () => {
        await openOnRow();
        const s = onDialog<DialogState>(`
            await pickFrom(0, ${JSON.stringify(UNRESOLVED)}, ${JSON.stringify(UNRESOLVED)});
            await until(() => state().canSend && state().noteSays);
            return JSON.stringify(state());
        `);
        expect(s.note).toBe(UNRESOLVED);
        expect(s.noteSays).toContain(`新しいノート ${UNRESOLVED}.md を作ります`);
        sendNow();
        expect(lines(`${UNRESOLVED}.md`)).toContain(`- [ ] ${ROW}`);
    });
});
