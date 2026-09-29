/**
 * Sending a row and its subtree to a note (`NoteOps.send`, 段 B3), in the
 * running Dev vault: to a new note, to a note there is, to a heading of the
 * row's own note, and a send whose note the row came from refuses once the
 * new note is written, which takes the new note away again. The notes' bytes
 * are read back from the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build that sends rows to other notes
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/noteops/send.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
