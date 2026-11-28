/**
 * Sending a row and its subtree to a note (`NoteOps.send`), in the
 * running E2E vault: to a new note, to a note there is, to a heading of the
 * row's own note, and a send whose note the row came from refuses once the
 * new note is written, which takes the new note away again. Then the row
 * moved from its hub, opened in the move from a card's menu: the note and
 * the heading picked from their lists with the pointer while the name's
 * change is held, the heading field left on the settings' heading and
 * emptied, the values the row inherits, and a subtree the source cannot
 * open, moved as it stands. The notes' bytes are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault (path in dev-paths.mjs) open,
 *     with a build that sends rows to other notes
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/noteops/send.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { obsidianEval, sleep } from '../helpers/cli-helper';
import { closeDialog, onDialog, openDialog as openDialogOn, type DialogState } from '../helpers/send-dialog';
import { deleteTestFile, readTestFile, vaultAbsolute, writeIndexedTestFile } from '../helpers/test-file-manager';
import { closeEveryTimer } from '../helpers/timers';
import { tr } from '../helpers/view-helper';
import { waitForFileDeindexed } from '../helpers/waits';

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
 * `NoteOps`, with the values `values` — after `prelude` (statements) has run in
 * Obsidian — and answer what came of it, with the notices it raised.
 */
function send(name: string, to: unknown, values: unknown[] = [], prelude = ''): Sent {
    const result = obsidianEval(`(async () => {
        const plugin = app.plugins.plugins['obsidian-task-viewer'];
        const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(SRC)} && t.content === ${JSON.stringify(name)});
        if (!task) throw new Error('no row ' + ${JSON.stringify(name)});
        const before = new Set(document.querySelectorAll('.notice'));
        ${prelude}
        const sent = await plugin.getNoteOps().send({
            rows: [{ taskId: task.id, base: task.subtreeLines }],
            to: ${JSON.stringify(to)},
            values: ${JSON.stringify(values)},
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

afterAll(async () => {
    for (const path of [SRC, DST, `${NEW}.md`, RENAMED]) deleteTestFile(path);
    await waitForFileDeindexed(SRC);
});

describe('sending a row', () => {
    it('to a new note: made of the keys and the row under the heading, a link left in the row\'s place', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['# 送り元', '- [ ] 設計 @2026-09-29 ^e2e', '    - [ ] 下書き', '    メモ', '- [ ] 残る', ''].join('\n'));

        const sent = send('設計', { note: { kind: 'new', path: `${NEW}.md` }, spot: SECTION },
            [{ key: 'tv-color', to: 'frontmatter', lines: ['tv-color: "blue"'], from: [] }]);

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

        const sent = send('手順', { note: { kind: 'existing', path: DST }, spot: SECTION }, [
            { key: 'tv-color', to: 'frontmatter', lines: ['tv-color: "blue"'], from: [] },
            { key: 'tags', to: 'frontmatter', lines: ['tags:', '  - e2e'], from: [] },
        ]);

        expect(sent.result).toEqual({ kind: 'done', note: DST });
        expect(readTestFile(DST)).toBe(['---', 'tv-color: "red"', 'tags:', '  - e2e', '---', '# 送り先', '', '## Tasks', '1. [ ] 手順 ^s1', '    - [ ] 子', '- [ ] 前からある', ''].join('\n'));
        expect(readTestFile(SRC)).toBe([`1. [[${DST.replace(/\.md$/, '')}]]`, '2. [ ] 次', ''].join('\n'));
    });

    it('with the values it inherits: a built-in in the frontmatter, a custom value above the first heading as spelt, no value as none, the frontmatter\'s custom keys none', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['---', 'tv-color: red', 'note-only: x', '---', '- area:: lab', '## S', '- area::', "- sq:: 'abc'", '- id:: "123"', '- tv-color:: null', '- [ ] 値', ''].join('\n'));

        const candidates = obsidianEval(`(async () => {
            const plugin = app.plugins.plugins['obsidian-task-viewer'];
            const task = plugin.getIndex().getTasks().find(t => t.file === ${JSON.stringify(SRC)} && t.content === '値');
            const preview = await plugin.getNoteOps().previewSend([task.id]);
            return JSON.stringify(preview.candidates);
        })()`) as unknown[];
        const sent = send('値', { note: { kind: 'new', path: `${NEW}.md` }, spot: SECTION }, candidates);

        expect(sent.result).toEqual({ kind: 'done', note: `${NEW}.md` });
        expect(readTestFile(`${NEW}.md`)).toBe(['---', 'tv-color:', '---', '- area::', "- sq:: 'abc'", '- id:: "123"', '', '## Tasks', '- [ ] 値', ''].join('\n'));
        deleteTestFile(`${NEW}.md`);
    });

    it('to a heading of its own note: carried in one write, and not told', async () => {
        await writeIndexedTestFile(SRC, ['- [ ] 動く', '    - [ ] 子', '## Done', '- [x] 済み', ''].join('\n'));

        const sent = send('動く', { note: { kind: 'existing', path: SRC }, spot: { ...SECTION, heading: 'Done' } });

        expect(sent.result).toEqual({ kind: 'done', note: SRC });
        expect(sent.notices).toEqual([]);
        expect(readTestFile(SRC)).toBe(['## Done', '- [ ] 動く', '    - [ ] 子', '- [x] 済み', ''].join('\n'));
    });

    it('whose note is edited just as the new note is written: the new note taken away, the row left, told once', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['- [ ] 取り消す', '    - [ ] 子', ''].join('\n'));

        // The note the row came from is saved from outside at the moment
        // its write comes, after the new note is made.
        const sent = send('取り消す', { note: { kind: 'new', path: `${NEW}.md` }, spot: SECTION }, [], `
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

describe('sending a row a timer runs on', () => {
    afterEach(closeEveryTimer);

    it('its lines all sent: the timer follows them, and ⏸ records in the note they went to', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['- [ ] 計る', '- [ ] 残る', ''].join('\n'));
        const timer = startTimer('計る', 'child');
        expect(readTestFile(SRC)).toContain(`^${timer.tail}`);

        const sent = send('計る', { note: { kind: 'new', path: `${NEW}.md` }, spot: SECTION });

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
        const before = readTestFile(SRC);

        const sent = send('続き', { note: { kind: 'new', path: `${NEW}.md` }, spot: SECTION });

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
        expect(timerFileShown(timer.id, SRC.replace(/\.md$/, ''))).toBe(SRC.replace(/\.md$/, ''));

        obsidianEval(`(async () => {
            await app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(SRC)}), ${JSON.stringify(RENAMED)});
            return JSON.stringify(true);
        })()`);

        expect(timerFile(timer.id)).toBe(RENAMED);
        expect(timerFileShown(timer.id, RENAMED.replace(/\.md$/, ''))).toBe(RENAMED.replace(/\.md$/, ''));
        closeEveryTimer();
        deleteTestFile(RENAMED);
    });
});

/** Open the hub in a move of the row of `SRC` whose text is `name`, from its card's menu. */
function openDialog(name: string): DialogState {
    return openDialogOn(SRC, name);
}

describe('a row moved from the hub the card\'s menu opens', () => {
    // Some of the dialog's events need the window to have the focus.
    beforeAll(() => { if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']); });
    afterEach(() => { closeDialog(); });

    it('opens in the move on the basic tab, picks the note and the heading from their lists with the pointer, the name\'s change held, and moves the row so changed to the heading of its own note', async () => {
        await writeIndexedTestFile(SRC, ['- [ ] 動かす', '    - [ ] 子', '## Done', '- [x] 済み', ''].join('\n'));
        const opened = openDialog('動かす');
        expect(opened).toMatchObject({ open: true, note: '動かす', heading: 'Tasks', asking: false, tab: 'basic', focusOnNote: true });

        const picked = onDialog<DialogState & { draft: string; disk: string }>(`
            const name = nameInput();
            name.focus();
            name.value = '動かす2';
            name.dispatchEvent(new InputEvent('input', { bubbles: true }));
            // The name is taken into the move's draft as the focus leaves it, for the note field.
            await pickFrom(0, ${JSON.stringify(SRC.slice(0, -5))}, ${JSON.stringify(SRC.slice(0, -3))});
            await until(() => state().noteSays === ${JSON.stringify(tr('modal.send.noteSame', { note: SRC }))});
            await pickFrom(1, 'Do', 'Done');
            await until(() => state().says?.includes('Done') && state().canSend);
            return JSON.stringify({ ...state(), draft: nameInput().value, disk: await app.vault.adapter.read(${JSON.stringify(SRC)}) });
        `);
        // A press on either list neither closed the hub nor asked to throw the move away; the name is held, not written.
        expect(picked).toMatchObject({ open: true, closing: false, asking: false, note: SRC.slice(0, -3), heading: 'Done', canSend: true, draft: '動かす2' });
        expect(picked.disk).toBe(['- [ ] 動かす', '    - [ ] 子', '## Done', '- [x] 済み', ''].join('\n'));
        expect(picked.noteSays).toBe(tr('modal.send.noteSame', { note: SRC }));
        expect(picked.says).toBe(tr('modal.send.withinHead', { heading: 'Done' }));

        const sent = onDialog<{ open: boolean; notices: number }>(`
            const before = new Set(document.querySelectorAll('.notice'));
            act().click();
            await until(() => !panel());
            await sleep(300);
            return JSON.stringify({ open: !!panel(), notices: [...document.querySelectorAll('.notice')].filter(el => !before.has(el)).length });
        `);
        expect(sent).toEqual({ open: false, notices: 0 });
        expect(readTestFile(SRC)).toBe(['## Done', '- [ ] 動かす2', '    - [ ] 子', '- [x] 済み', ''].join('\n'));
    });

    describe('the heading field', () => {
        const DST_LINES = ['## Tasks', '- [ ] ある', '## Other', '本文', ''];
        /** The row written anew, the note it goes to, and the dialog opened on the row with that note typed. */
        const openToDst = async () => {
            await writeIndexedTestFile(DST, DST_LINES.join('\n'));
            await writeIndexedTestFile(SRC, ['- [ ] 送る行', ''].join('\n'));
            expect(openDialog('送る行').open).toBe(true);
            return onDialog<DialogState & { placeholder: string | null }>(`
                typeIn(inputs()[0], ${JSON.stringify(DST.slice(0, -3))});
                document.activeElement?.blur();
                await until(() => state().noteSays === ${JSON.stringify(tr('modal.destination.noteExisting', { note: DST }))} && state().canSend);
                return JSON.stringify({ ...state(), placeholder: inputs()[1].placeholder });
            `);
        };
        const pressSend = () => onDialog<DialogState>(`
            act().click();
            await until(() => !panel());
            await sleep(300);
            return JSON.stringify(state());
        `);

        it('opens on the settings\' heading, and untouched sends the row there', async () => {
            const s = await openToDst();
            expect(s).toMatchObject({ heading: 'Tasks', placeholder: tr('modal.destination.headingEmpty'), says: tr('modal.send.toHead', { heading: 'Tasks' }) });

            expect(pressSend().open).toBe(false);
            expect(readTestFile(DST)).toBe(['## Tasks', '- [ ] 送る行', '- [ ] ある', '## Other', '本文', ''].join('\n'));
        });

        it('emptied, sends the row to the end of the note, under no heading', async () => {
            await openToDst();
            const s = onDialog<DialogState>(`
                typeIn(inputs()[1], '');
                document.activeElement?.blur();
                await until(() => state().says === ${JSON.stringify(tr('modal.send.toNoteEnd'))} && state().canSend);
                return JSON.stringify(state());
            `);
            expect(s).toMatchObject({ heading: '', canSend: true });

            expect(pressSend().open).toBe(false);
            expect(readTestFile(DST)).toBe(['## Tasks', '- [ ] ある', '## Other', '本文', '- [ ] 送る行', ''].join('\n'));
        });
    });

    it('lists the values the row inherits under where they are written, the frontmatter\'s before those above the first heading, and writes them there', async () => {
        deleteTestFile(`${NEW}.md`);
        await writeIndexedTestFile(SRC, ['---', 'tv-color: red', '体重[kg]: 60', '---', 'Inherit properties:', '- 時給:: 1450', '', '## 勤務', '- who::', '    - a', '- [ ] 働く', ''].join('\n'));
        expect(openDialog('働く').open).toBe(true);

        const listed = onDialog<{ groups: { label: string; rows: [string, string, boolean][] }[]; canSend: boolean }>(`
            const [note, heading] = inputs();
            note.value = ${JSON.stringify(NEW)};
            note.dispatchEvent(new Event('input', { bubbles: true }));
            heading.value = 'Tasks';
            heading.dispatchEvent(new Event('input', { bubbles: true }));
            await until(() => state().canSend && panel().querySelectorAll('.tv-send__candidates').length === 2);
            const groups = [...panel().querySelectorAll('.tv-send__candidates')].map(group => ({
                label: group.previousElementSibling.textContent,
                rows: [...group.querySelectorAll('.tv-form__row')].map(row => [
                    row.querySelector('.tv-form__label').textContent,
                    row.querySelector('.tv-send__value').textContent,
                    row.querySelector('input').checked,
                ]),
            }));
            return JSON.stringify({ groups, canSend: state().canSend });
        `);
        expect(listed).toEqual({
            groups: [
                { label: tr('modal.send.frontmatter'), rows: [['tv-color', 'red', true]] },
                { label: tr('modal.send.root'), rows: [['時給', '1450', true], ['who', 'a', true]] },
            ],
            canSend: true,
        });

        const sent = onDialog<DialogState>(`
            act().click();
            await until(() => !panel());
            await sleep(300);
            return JSON.stringify(state());
        `);
        expect(sent.open).toBe(false);
        expect(readTestFile(`${NEW}.md`)).toBe(['---', 'tv-color: red', '---', '- 時給:: 1450', '- who::', '    - a', '', '## Tasks', '- [ ] 働く', ''].join('\n'));
        deleteTestFile(`${NEW}.md`);
    });

    it('moves a row whose subtree the source cannot open, as it stands, the focus on the note field', async () => {
        // Moved out from under its parent to another heading: where it stands, under Done, is not offered.
        await writeIndexedTestFile(SRC, ['## Done', '- [x] 済み', '    - [ ] 浅い', '      続き', '        - [ ] 子', '## Later', ''].join('\n'));
        const opened = openDialog('浅い');
        expect(opened).toMatchObject({ open: true, tab: 'basic', focusOnNote: true });
        // The note field takes the focus, the caret after its name.
        const focused = onDialog<{ value: string; start: number | null; end: number | null }>(`
            await until(() => document.activeElement === inputs()[0], 3000, 'the note field is not focused');
            const note = inputs()[0];
            return JSON.stringify({ value: note.value, start: note.selectionStart, end: note.selectionEnd });
        `);
        expect(focused.value).not.toBe('');
        expect([focused.start, focused.end]).toEqual([focused.value.length, focused.value.length]);

        const sent = onDialog<DialogState>(`
            const [note, heading] = inputs();
            note.value = ${JSON.stringify(SRC.slice(0, -3))};
            note.dispatchEvent(new Event('input', { bubbles: true }));
            heading.value = 'Later';
            heading.dispatchEvent(new Event('input', { bubbles: true }));
            await until(() => state().says?.includes('Later') && state().canSend);
            act().click();
            await until(() => !panel());
            return JSON.stringify(state());
        `);
        expect(sent.open).toBe(false);
        expect(readTestFile(SRC)).toBe(['## Done', '- [x] 済み', '## Later', '- [ ] 浅い', '  続き', '    - [ ] 子', ''].join('\n'));
    });
});

/**
 * The note field: which note a name, a path
 * or a pick points at, and what is said of it under the field. The notes
 * are made through Obsidian in a folder of their own and taken away at the
 * end; the row is written anew for each send, which takes it away.
 */
describe('the send dialog\'s note field', () => {
    const DIR = 'test-int-send-nf';
    const ROW = '送り先を選ぶ';
    const UNRESOLVED = 'test-int-send-nf-未解決';
    /** What is said of `同名`, the name of a note in each of two folders. */
    const ambiguous = () => tr('modal.noteAmbiguous', { name: '同名', count: 2, notes: `${DIR}/a/同名.md, ${DIR}/b/同名.md` });

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
        act().click();
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
        expect(s).toMatchObject({ noteSays: tr('modal.destination.noteExisting', { note: `${DIR}/唯一.md` }), noteErrors: null, canSend: true });
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
        // The folder for new notes is the vault's choice: any path that ends in the name.
        const [head, tail] = tr('modal.destination.noteNewByName', { note: '\n' }).split('\n');
        expect(s.noteSays!.startsWith(head) && s.noteSays!.endsWith(`test-int-send-nf-無い名前.md${tail}`)).toBe(true);
        expect(s.tone).toBe('tv-form__warning');
        expect(s.says).toBe(tr('modal.send.toNew', { heading: 'Tasks' }));
        expect(s.canSend).toBe(true);
    });

    it('a name two notes have: no send, both paths said; picked from the list, the one picked', async () => {
        await openOnRow();
        const s = typeNote('同名');
        expect(s.canSend).toBe(false);
        expect(s.noteErrors).toBe(ambiguous());

        const picked = onDialog<DialogState>(`
            await pickFrom(0, '同名', '同名', ${JSON.stringify(`${DIR}/b/`)});
            await until(() => state().canSend);
            return JSON.stringify(state());
        `);
        expect(picked).toMatchObject({ note: '同名', noteSays: tr('modal.destination.noteExisting', { note: `${DIR}/b/同名.md` }), noteErrors: null, canSend: true });
        sendNow();
        expect(lines(`${DIR}/b/同名.md`)).toContain(`- [ ] ${ROW}`);
        expect(lines(`${DIR}/a/同名.md`)).not.toContain(ROW);
    });

    it('a pick let go while the text differs, the text read on its own, and taken again once its text is typed back', async () => {
        await openOnRow();
        const picked = tr('modal.destination.noteExisting', { note: `${DIR}/a/同名.md` });
        const s = onDialog<{ differs: DialogState; back: DialogState }>(`
            await pickFrom(0, '同名', '同名', ${JSON.stringify(`${DIR}/a/`)});
            await until(() => state().canSend);
            typeIn(inputs()[0], '同名x');
            await until(() => state().noteSays?.includes('同名x'));
            const differs = state();
            typeIn(inputs()[0], '同名');
            document.activeElement?.blur();
            await until(() => state().noteSays === ${JSON.stringify(picked)});
            return JSON.stringify({ differs, back: state() });
        `);
        // Two notes go by the name: read on its own it would name neither, so the note named is the one picked.
        expect(s.differs.noteSays).not.toBe(picked);
        expect(s.back).toMatchObject({ note: '同名', noteSays: picked, noteErrors: null, canSend: true });
    });

    it('a path whose folder is not there: the note and the folder made, and the row goes to it', async () => {
        await openOnRow();
        const s = typeNote(`${DIR}/新しい/作る`);
        expect(s.noteSays).toBe(`${tr('modal.destination.noteNew', { note: `${DIR}/新しい/作る.md` })} ${tr('modal.destination.noteFolderMade', { folder: `${DIR}/新しい` })}`);
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
        expect(s).toMatchObject({ note: '別名元', noteSays: tr('modal.destination.noteExisting', { note: `${DIR}/別名元.md` }) });
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
        expect(s.noteSays).toContain(tr('modal.destination.noteNew', { note: `${UNRESOLVED}.md` }));
        sendNow();
        expect(lines(`${UNRESOLVED}.md`)).toContain(`- [ ] ${ROW}`);
    });
});
