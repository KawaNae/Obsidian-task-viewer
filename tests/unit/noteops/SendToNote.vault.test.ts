import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice, TFile } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { freezeDate } from '../helpers/fakeDate';
import type { SubtreeLine } from '../../../src/services/persistence/TaskOps';
import type { SendRow } from '../../../src/services/core/TaskIndex';
import type { FrontmatterKey } from '../../../src/services/persistence/writers/SendWriter';

/**
 * A send to another note (`TaskIndex.send`, 段 B3): the note written first —
 * made, or written in one write — then each note the rows came from, each
 * row's subtree replaced by a link to the note; and, when a note the rows
 * came from refuses, what went of its rows taken out of the note again
 * (`archive/2026-09-send.md`, 書き込みの順序と補償).
 */

freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const SPACES = { useTab: false, tabSize: 4 };

let live: VaultSession | undefined;
beforeEach(() => { Notice.messages.length = 0; });
afterEach(() => { live?.dispose(); live = undefined; });

type Child = [text: string, was: number | null];

async function open(files: Record<string, string | string[]>) {
    const { contents, session } = await openLiveVault(files, s => { live = s; }, { config: SPACES });
    const writes: string[] = [];
    // Run before the write to a note, once: an edit from outside, a failure.
    const before = new Map<string, () => void>();
    const vault = session.app.vault as unknown as { process: (file: TFile, fn: (data: string) => string) => Promise<string> };
    const process = vault.process.bind(vault);
    vault.process = async (file, fn) => {
        writes.push(file.path);
        const hook = before.get(file.path);
        before.delete(file.path);
        hook?.();
        return process(file, fn);
    };
    const task = (content: string) => session.index.getTasks().find(one => one.content === content)!;
    return {
        session,
        contents,
        writes,
        /** Before the next write to `path`, do `hook`. */
        beforeWrite: (path: string, hook: () => void) => { before.set(path, hook); },
        text: (path: string) => contents.get(path),
        lines: (path: string) => contents.get(path)?.split('\n'),
        task,
        row: (content: string, draft?: { text: string; children: Child[] }): SendRow => {
            const found = task(content);
            return {
                taskId: found.id,
                base: found.subtreeLines!,
                ...(draft ? { draft: { text: draft.text, children: draft.children.map(([text, was]): SubtreeLine => ({ text, was })) } } : {}),
            };
        },
        send: async (rows: SendRow[], to: { path: string; create?: boolean; frontmatter?: FrontmatterKey[]; heading?: string; side?: 'head' | 'end' }) => {
            const answer = await session.ops.send(rows, {
                path: to.path,
                create: to.create ?? false,
                section: { heading: to.heading ?? 'Tasks', level: 2, side: to.side ?? 'head' },
                frontmatter: to.frontmatter ?? [],
            });
            await session.flowSettled(...contents.keys());
            return answer;
        },
    };
}

describe('to a new note', () => {
    it('makes it of the keys and the row under the heading, and leaves a link in the row\'s place', async () => {
        const note = await open({ 'src.md': ['# s', '- [ ] 設計 ^a', '    - [ ] 下書き', '    メモ', '- [ ] other', ''] });

        const sent = await note.send([note.row('設計')], {
            path: 'Projects/設計.md', create: true,
            frontmatter: [{ key: 'tv-start', yaml: ['tv-start: "2026-09-28"'] }, { key: 'tags', yaml: ['tags:', '  - work'] }],
        });

        expect(sent).toMatchObject({ kind: 'done', subject: '設計', landed: ['src.md'], refused: [], takenBack: true });
        expect(sent.kind === 'done' && sent.note.path).toBe('Projects/設計.md');
        expect(note.lines('Projects/設計.md')).toEqual([
            '---', 'tv-start: "2026-09-28"', 'tags:', '  - work', '---', '', '## Tasks', '- [ ] 設計 ^a', '    - [ ] 下書き', '    メモ', '',
        ]);
        expect(note.lines('src.md')).toEqual(['# s', '- [[設計]]', '- [ ] other', '']);
        expect(note.writes).toEqual(['src.md']);
        expect(Notice.messages).toEqual([]);
        // The row, its ^id with it, is read there.
        expect(note.session.index.getTaskByAnchor('Projects/設計.md', 'a')?.content).toBe('設計');
        expect(note.session.index.getTaskByAnchor('src.md', 'a')).toBeUndefined();
    });

    it('with no keys, makes it of the heading and the row alone', async () => {
        const note = await open({ 'src.md': ['- [ ] A', ''] });

        await note.send([note.row('A')], { path: 'A.md', create: true });

        expect(note.text('A.md')).toBe('## Tasks\n- [ ] A\n');
        expect(note.text('src.md')).toBe('- [[A]]\n');
    });

    it('links it by its path, showing its name, when another note has its name', async () => {
        const note = await open({ 'src.md': ['- [ ] A', ''], 'old/A.md': ['x', ''] });

        await note.send([note.row('A')], { path: 'new/A.md', create: true });

        expect(note.text('src.md')).toBe('- [[new/A|A]]\n');
    });

    it('checked before it is made: refused, no note is made, and no note the rows came from is touched', async () => {
        const note = await open({ 'src.md': ['- [ ] A', '    ```', '    x', '    ```', 'para', ''] });
        const before = note.text('src.md');

        // The fence the draft leaves open runs on over `para`, below the subtree.
        const sent = await note.send([note.row('A', { text: '- [ ] A', children: [['    ```', 1], ['    x', 2]] })], { path: 'A.md', create: true });

        expect(sent).toMatchObject({ kind: 'not-done', refused: { file: 'src.md', reason: { kind: 'disturbs' }, subject: 'A' } });
        expect(note.contents.has('A.md')).toBe(false);
        expect(note.text('src.md')).toBe(before);
        expect(Notice.messages).toHaveLength(1);
    });

    it('that could not be made: refused, told once, the rows left where they stood', async () => {
        const note = await open({ 'src.md': ['- [ ] A', ''], 'a.md': ['x', ''] });

        // A path a note has in another case (stage 0): the vault refuses it.
        const sent = await note.send([note.row('A')], { path: 'A.md', create: true });

        expect(sent).toMatchObject({ kind: 'not-done', refused: { file: 'A.md', reason: { kind: 'failed' } } });
        expect(note.text('src.md')).toBe('- [ ] A\n');
        expect(note.text('a.md')).toBe('x\n');
        expect(Notice.messages).toHaveLength(1);
    });
});

describe('the lines sent', () => {
    it('numbered: the link keeps the row\'s marker, and the row is numbered where it lands', async () => {
        const note = await open({
            'src.md': ['1. [ ] 前', '2. [ ] 設計', '    - [ ] 子', '3. [ ] 後', ''],
            'dst.md': ['## Tasks', '1. [ ] x', '2. [ ] y', ''],
        });

        await note.send([note.row('設計')], { path: 'dst.md', side: 'end' });

        expect(note.lines('src.md')).toEqual(['1. [ ] 前', '2. [[dst]]', '3. [ ] 後', '']);
        expect(note.lines('dst.md')).toEqual(['## Tasks', '1. [ ] x', '2. [ ] y', '3. [ ] 設計', '    - [ ] 子', '']);
    });

    it('a child row, its tabs and spaces mixed: moved left as a block to where it lands, byte for byte, its ^id kept', async () => {
        const note = await open({ 'src.md': ['- [ ] P', '\t- [ ] c ^c', '\t    - [ ] g', '\t\t段落', '\t- [ ] d', ''] });

        await note.send([note.row('c')], { path: 'c.md', create: true });

        expect(note.lines('c.md')).toEqual(['## Tasks', '- [ ] c ^c', '    - [ ] g', '\t段落', '']);
        expect(note.lines('src.md')).toEqual(['- [ ] P', '\t- [[c]]', '\t- [ ] d', '']);
        expect(note.session.index.getTaskByAnchor('c.md', 'c')?.content).toBe('c');
        // The link is read as the parent's child line.
        expect(note.task('P').childLines.map(one => one.text)).toEqual(['- [[c]]']);
    });

    it('carry their `==>` lines and a fence, and the generated block they use stays', async () => {
        const note = await open({
            'src.md': ['- [ ] 親 @2026-09-21', '    - ==> every mon use("w")', '    ```', '    code', '    ```', '', '```tv-gen w', '- [ ] 親', '```', ''],
        });

        await note.send([note.row('親')], { path: '親.md', create: true });

        expect(note.lines('親.md')).toEqual(['## Tasks', '- [ ] 親 @2026-09-21', '    - ==> every mon use("w")', '    ```', '    code', '    ```', '']);
        expect(note.lines('src.md')).toEqual(['- [[親]]', '', '```tv-gen w', '- [ ] 親', '```', '']);
    });

    it('two rows of one note: one write there, each left a link, and they land in the order they stood', async () => {
        const note = await open({ 'src.md': ['- [ ] A', '- [ ] B', '- [ ] C', '    - [ ] c', ''] });

        await note.send([note.row('C'), note.row('A')], { path: 'dst.md', create: true });

        expect(note.lines('dst.md')).toEqual(['## Tasks', '- [ ] A', '- [ ] C', '    - [ ] c', '']);
        expect(note.lines('src.md')).toEqual(['- [[dst]]', '- [ ] B', '- [[dst]]', '']);
        expect(note.writes).toEqual(['src.md']);
    });

    it('rows of two notes: in the order of the notes, each note written once', async () => {
        const note = await open({ 'b.md': ['- [ ] B', ''], 'a.md': ['- [ ] A', ''] });

        const sent = await note.send([note.row('B'), note.row('A')], { path: 'dst.md', create: true });

        expect(sent).toMatchObject({ kind: 'done', landed: ['a.md', 'b.md'] });
        expect(note.lines('dst.md')).toEqual(['## Tasks', '- [ ] A', '- [ ] B', '']);
        expect(note.text('a.md')).toBe('- [[dst]]\n');
        expect(note.text('b.md')).toBe('- [[dst]]\n');
    });

    it('from a note with CRLF and a mark: the note keeps them, and the new note is LF', async () => {
        const note = await open({ 'src.md': '﻿- [ ] A\r\n    - [ ] a\r\n- [ ] B\r\n' });

        await note.send([note.row('A')], { path: 'A.md', create: true });

        expect(note.text('src.md')).toBe('﻿- [[A]]\r\n- [ ] B\r\n');
        expect(note.text('A.md')).toBe('## Tasks\n- [ ] A\n    - [ ] a\n');
    });
});

describe('to a note there is', () => {
    it('adds only the keys it has none of, and leaves those it has as they are', async () => {
        const note = await open({
            'src.md': ['- [ ] A', ''],
            'dst.md': ['---', 'tags:', '  - old', 'k: 1', '---', '# d', ''],
        });

        await note.send([note.row('A')], {
            path: 'dst.md',
            frontmatter: [{ key: 'tags', yaml: ['tags:', '  - new'] }, { key: 'j', yaml: ['j: 2'] }],
        });

        expect(note.lines('dst.md')).toEqual(['---', 'tags:', '  - old', 'k: 1', 'j: 2', '---', '# d', '', '## Tasks', '- [ ] A', '']);
    });

    it('makes a frontmatter for the keys when it has none', async () => {
        const note = await open({ 'src.md': ['- [ ] A', ''], 'dst.md': ['## Tasks', '- [ ] x', ''] });

        await note.send([note.row('A')], { path: 'dst.md', frontmatter: [{ key: 'j', yaml: ['j: 2'] }] });

        expect(note.lines('dst.md')).toEqual(['---', 'j: 2', '---', '## Tasks', '- [ ] A', '- [ ] x', '']);
    });

    it('with two headings of the name: refused before anything is written, told once', async () => {
        const note = await open({ 'src.md': ['- [ ] A', ''], 'dst.md': ['## Tasks', '### tasks', ''] });

        expect(await note.send([note.row('A')], { path: 'dst.md' }))
            .toMatchObject({ kind: 'not-done', refused: { file: 'dst.md', reason: { kind: 'headings', name: 'Tasks', count: 2 }, subject: 'A' } });
        expect(note.text('src.md')).toBe('- [ ] A\n');
        expect(note.text('dst.md')).toBe('## Tasks\n### tasks\n');
        expect(Notice.messages).toHaveLength(1);
    });

    it('its own rows among them: carried in its write, in the order of the notes, and not taken back', async () => {
        const note = await open({ 'a.md': ['- [ ] A', ''], 'dst.md': ['- [ ] D', '## Tasks', ''] });
        note.beforeWrite('a.md', () => note.contents.set('a.md', '- [ ] A\n- [ ] typed\n'));

        const sent = await note.send([note.row('D'), note.row('A')], { path: 'dst.md' });

        expect(sent).toMatchObject({ kind: 'done', landed: ['dst.md'], refused: [{ file: 'a.md', reason: { kind: 'changed' } }], takenBack: true });
        expect(note.lines('dst.md')).toEqual(['## Tasks', '- [ ] D', '']);
        expect(note.text('a.md')).toBe('- [ ] A\n- [ ] typed\n');
    });
});

describe('a draft', () => {
    it('is what goes to the note; the note the row came from is checked against what the dialog opened on', async () => {
        const note = await open({ 'src.md': ['- [ ] A', '    - [ ] a1', ''] });

        await note.send([note.row('A', { text: '- [ ] A2', children: [['    - [ ] a1', 1], ['    - [ ] a0', null]] })], { path: 'A.md', create: true });

        expect(note.lines('A.md')).toEqual(['## Tasks', '- [ ] A2', '    - [ ] a1', '    - [ ] a0', '']);
        expect(note.lines('src.md')).toEqual(['- [[A]]', '']);
    });

    it('that completes the row (判断 10): it fires where it stood, its next instance stays, and the completed row goes', async () => {
        const note = await open({ 'src.md': ['# s', '- [ ] 週報 @2026-09-21 ==> every mon', '    - [ ] 子', ''] });

        const sent = await note.send([note.row('週報', { text: '- [x] 週報 @2026-09-21 ==> every mon', children: [['    - [ ] 子', 1]] })], { path: '週報.md', create: true });

        expect(sent.kind).toBe('done');
        expect(note.lines('src.md')).toEqual(['# s', '- [ ] 週報 @2026-09-28 ==> every mon', '- [[週報]]', '']);
        expect(note.lines('週報.md')).toEqual(['## Tasks', '- [x] 週報 @2026-09-21', '    - [ ] 子', '']);
        expect(Notice.messages).toEqual([]);
    });

    it('that completes a child: its next instance goes with the row', async () => {
        const note = await open({ 'src.md': ['- [ ] P', '    - [ ] 日報 @2026-09-21 ==> every 1d', ''] });

        await note.send([note.row('P', { text: '- [ ] P', children: [['    - [x] 日報 @2026-09-21 ==> every 1d', 1]] })], { path: 'P.md', create: true });

        expect(note.lines('P.md')).toEqual(['## Tasks', '- [ ] P', '    - [ ] 日報 @2026-09-26 ==> every 1d', '    - [x] 日報 @2026-09-21', '']);
        expect(note.lines('src.md')).toEqual(['- [[P]]', '']);
    });

    it('whose row moves by its own fire: the link is left where the move took it', async () => {
        const note = await open({ 'src.md': ['- [ ] T @2026-09-21 ==> move([[#Done]])', '## Done', '- [x] old', ''] });

        await note.send([note.row('T', { text: '- [x] T @2026-09-21 ==> move([[#Done]])', children: [] })], { path: 'T.md', create: true });

        expect(note.lines('src.md')).toEqual(['## Done', '- [[T]]', '- [x] old', '']);
        expect(note.lines('T.md')).toEqual(['## Tasks', '- [x] T @2026-09-21', '']);
    });
});

describe('a note the rows came from, refused once the note is written', () => {
    it('changed since the dialog opened: the new note is taken away', async () => {
        const note = await open({ 'src.md': ['- [ ] A', ''] });
        note.beforeWrite('src.md', () => note.contents.set('src.md', '- [ ] A\n- [ ] typed\n'));

        const sent = await note.send([note.row('A')], { path: 'A.md', create: true });

        expect(sent).toMatchObject({ kind: 'done', landed: [], refused: [{ file: 'src.md', reason: { kind: 'changed' }, subject: 'A' }], takenBack: true });
        expect(note.contents.has('A.md')).toBe(false);
        expect(note.text('src.md')).toBe('- [ ] A\n- [ ] typed\n');
        // Not told here: the caller tells it once, with what became of the rest.
        expect(Notice.messages).toEqual([]);
    });

    it('failed: a note there is is written back to the bytes it had', async () => {
        const note = await open({ 'src.md': ['- [ ] A', ''], 'dst.md': ['---', 'k: 1', '---', '# d', '- [ ] x', ''] });
        const before = note.text('dst.md');
        note.beforeWrite('src.md', () => { throw new Error('EIO'); });

        const sent = await note.send([note.row('A')], { path: 'dst.md', frontmatter: [{ key: 'j', yaml: ['j: 2'] }] });

        expect(sent).toMatchObject({ kind: 'done', landed: [], refused: [{ file: 'src.md', reason: { kind: 'failed' } }], takenBack: true });
        expect(note.text('dst.md')).toBe(before);
        expect(note.text('src.md')).toBe('- [ ] A\n');
        expect(Notice.messages).toEqual([]);
    });

    it('disturbed by the link: the line below the row would read otherwise past it', async () => {
        const note = await open({ 'src.md': ['- [ ] A', '    - b', '    ---', 'x', ''] });

        const sent = await note.send([note.row('A')], { path: 'A.md', create: true });

        expect(sent).toMatchObject({ kind: 'done', landed: [], refused: [{ file: 'src.md', reason: { kind: 'disturbs' } }], takenBack: true });
        expect(note.contents.has('A.md')).toBe(false);
        expect(note.text('src.md')).toBe('- [ ] A\n    - b\n    ---\nx\n');
    });

    it('one of two: only its lines are taken out of the note, the other\'s and the keys stay', async () => {
        const note = await open({ 'a.md': ['- [ ] A', ''], 'b.md': ['- [ ] B', ''], 'c.md': ['- [ ] C', ''] });
        note.beforeWrite('b.md', () => note.contents.set('b.md', '- [ ] B\n- [ ] typed\n'));

        const sent = await note.send([note.row('A'), note.row('B'), note.row('C')], {
            path: 'dst.md', create: true, frontmatter: [{ key: 'j', yaml: ['j: 2'] }],
        });

        expect(sent).toMatchObject({ kind: 'done', landed: ['a.md', 'c.md'], refused: [{ file: 'b.md' }], takenBack: true });
        expect(note.lines('dst.md')).toEqual(['---', 'j: 2', '---', '', '## Tasks', '- [ ] A', '- [ ] C', '']);
        expect(note.text('a.md')).toBe('- [[dst]]\n');
        expect(note.text('b.md')).toBe('- [ ] B\n- [ ] typed\n');
        expect(note.text('c.md')).toBe('- [[dst]]\n');
        expect(note.session.index.getTasks().filter(one => one.file === 'dst.md').map(one => one.content)).toEqual(['A', 'C']);
    });

    it('the note written since: not taken back, and the rows are in both notes', async () => {
        const note = await open({ 'src.md': ['- [ ] A', ''] });
        note.beforeWrite('src.md', () => {
            note.contents.set('src.md', '- [ ] A\n- [ ] typed\n');
            note.contents.set('A.md', note.contents.get('A.md') + 'typed too\n');
        });

        const sent = await note.send([note.row('A')], { path: 'A.md', create: true });

        expect(sent).toMatchObject({ kind: 'done', landed: [], refused: [{ file: 'src.md' }], takenBack: false });
        expect(note.text('A.md')).toBe('## Tasks\n- [ ] A\ntyped too\n');
        expect(note.text('src.md')).toBe('- [ ] A\n- [ ] typed\n');
    });
});
