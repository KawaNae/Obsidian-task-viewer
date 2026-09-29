import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { freezeDate } from '../helpers/fakeDate';
import type { SubtreeLine } from '../../../src/services/persistence/TaskOps';
import type { SendRow } from '../../../src/services/core/TaskIndex';

/**
 * A send to a section of the rows' own note (`TaskIndex.send`, 段 B2): one
 * write, which writes each draft, fires each row a draft completed where it
 * stood, and carries the rows, in the order they stood, to the section.
 */

freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';
const SPACES = { useTab: false, tabSize: 4 };

let live: VaultSession | undefined;
beforeEach(() => { Notice.messages.length = 0; });
afterEach(() => { live?.dispose(); live = undefined; });

type Child = [text: string, was: number | null];

async function open(lines: string[]) {
    const { contents, session } = await openLiveVault({ [FILE]: lines }, s => { live = s; }, { config: SPACES });
    let writes = 0;
    const vault = session.app.vault as unknown as { process: (...args: unknown[]) => Promise<string> };
    const process = vault.process.bind(vault);
    vault.process = (...args) => { writes++; return process(...args); };
    const task = (content: string) => session.index.getTasks().find(one => one.content === content)!;
    return {
        session,
        writes: () => writes,
        lines: () => contents.get(FILE)!.split('\n'),
        task,
        row: (content: string, draft?: { text: string; children: Child[] }): SendRow => {
            const found = task(content);
            return {
                taskId: found.id,
                base: found.subtreeLines!,
                ...(draft ? { draft: { text: draft.text, children: draft.children.map(([text, was]): SubtreeLine => ({ text, was })) } } : {}),
            };
        },
        send: async (rows: SendRow[], heading = 'Tasks', side: 'head' | 'end' = 'head') => {
            const answer = await session.index.send(rows, { path: FILE, section: { heading, level: 2, side } });
            await session.flowSettled(FILE);
            return answer;
        },
    };
}

describe('the rows sent', () => {
    it('go to the head of the section as they are, names and all, in one write', async () => {
        const note = await open(['# note', '- [ ] A ^a', '    - [ ] a1', '    text', '## Tasks', '- [ ] other', '']);
        const [a, a1] = [note.task('A').id, note.task('a1').id];

        const sent = await note.send([note.row('A')]);

        expect(sent).toMatchObject({ kind: 'done', landed: [FILE], refused: [] });
        expect(sent.kind === 'done' && sent.note.path).toBe(FILE);
        expect(note.writes()).toBe(1);
        expect(note.lines()).toEqual(['# note', '## Tasks', '- [ ] A ^a', '    - [ ] a1', '    text', '- [ ] other', '']);
        expect(note.session.index.getTask(a)?.content).toBe('A');
        expect(note.session.index.getTask(a1)?.content).toBe('a1');
        expect(note.session.index.getTaskByAnchor(FILE, 'a')?.content).toBe('A');
    });

    it('go to its end when the settings say so, above the heading below it', async () => {
        const note = await open(['- [ ] A', '## Tasks', '- [ ] other', '', '### Sub', '- [ ] sub', '']);

        await note.send([note.row('A')], 'Tasks', 'end');

        expect(note.lines()).toEqual(['## Tasks', '- [ ] other', '- [ ] A', '', '### Sub', '- [ ] sub', '']);
    });

    it('land in the order they stood, at the head of the section too', async () => {
        const note = await open(['- [ ] A', '- [ ] B', '    - [ ] b', '- [ ] C', '## Tasks', '- [ ] other', '']);

        // Asked in another order: the rows go as they stood.
        await note.send([note.row('C'), note.row('A')]);

        expect(note.lines()).toEqual(['- [ ] B', '    - [ ] b', '## Tasks', '- [ ] A', '- [ ] C', '- [ ] other', '']);
        expect(note.writes()).toBe(1);
    });

    it('in the order they stood at the end of the section, a row below it among them', async () => {
        const note = await open(['- [ ] A', '## Tasks', '- [ ] other', '## Later', '- [ ] Z', '']);

        await note.send([note.row('A'), note.row('Z')], 'Tasks', 'end');

        expect(note.lines()).toEqual(['## Tasks', '- [ ] other', '- [ ] A', '- [ ] Z', '## Later', '']);
    });

    it('take a row inside another one\'s subtree once, with that one', async () => {
        const note = await open(['- [ ] P', '    - [ ] c', '        - [ ] g', '## Tasks', '']);

        await note.send([note.row('c'), note.row('g'), note.row('P')]);

        expect(note.lines()).toEqual(['## Tasks', '- [ ] P', '    - [ ] c', '        - [ ] g', '']);
    });

    it('take a child row out of its parent, to the top of the section', async () => {
        const note = await open(['- [ ] P', '\t- [ ] c', '\t\t- [ ] g', '\t- [ ] d', '## Tasks', '']);

        await note.send([note.row('c')]);

        expect(note.lines()).toEqual(['- [ ] P', '\t- [ ] d', '## Tasks', '- [ ] c', '\t- [ ] g', '']);
    });

    it('make the section\'s heading at the end of the note when it has none', async () => {
        const note = await open(['- [ ] A', '- [ ] B', 'text', '']);

        await note.send([note.row('A')]);

        expect(note.lines()).toEqual(['- [ ] B', 'text', '', '## Tasks', '- [ ] A', '']);
    });

    it('make it past a heading inside a list item, which is none', async () => {
        const note = await open(['- [ ] P', '    ## Tasks', '    - [ ] c', '- [ ] Q', '']);

        await note.send([note.row('P')]);

        expect(note.lines()).toEqual(['- [ ] Q', '', '## Tasks', '- [ ] P', '    ## Tasks', '    - [ ] c', '']);
    });

    it('are numbered where they land, the second after the first', async () => {
        const note = await open(['1. [ ] A', '    - [ ] a', '2. [ ] B', '## Tasks', '1. [ ] x', '2. [ ] y', '']);

        await note.send([note.row('A'), note.row('B')], 'Tasks', 'end');

        expect(note.lines()).toEqual(['## Tasks', '1. [ ] x', '2. [ ] y', '3. [ ] A', '    - [ ] a', '4. [ ] B', '']);
    });

    it('carry their own `==>` lines and a fence in their subtree', async () => {
        const note = await open([
            '- [ ] 親 @2026-09-21', '    - ==> every mon use("w")', '    ```', '    code', '    ```', '## Tasks', '',
            '```tv-gen w', '- [ ] 親', '```', '',
        ]);

        await note.send([note.row('親')]);

        expect(note.lines()).toEqual([
            '## Tasks', '- [ ] 親 @2026-09-21', '    - ==> every mon use("w")', '    ```', '    code', '    ```', '',
            '```tv-gen w', '- [ ] 親', '```', '',
        ]);
    });
});

describe('a draft', () => {
    it('is written where the row stood, then carried: the row\'s text changed, a child added', async () => {
        const note = await open(['- [ ] A', '    - [ ] a1', '## Tasks', '- [ ] other', '']);
        const [a, a1] = [note.task('A').id, note.task('a1').id];

        await note.send([note.row('A', { text: '- [ ] A2', children: [['    - [ ] a1', 1], ['    - [ ] a0', null]] })]);

        expect(note.writes()).toBe(1);
        expect(note.lines()).toEqual(['## Tasks', '- [ ] A2', '    - [ ] a1', '    - [ ] a0', '- [ ] other', '']);
        expect(note.session.index.getTask(a)?.content).toBe('A2');
        expect(note.session.index.getTask(a1)?.content).toBe('a1');
    });

    it('of each row is written, and the rows land in the order they stood', async () => {
        const note = await open(['- [ ] A', '- [ ] B', '    - [ ] b', '## Tasks', '']);

        await note.send([
            note.row('B', { text: '- [ ] B2', children: [] }),
            note.row('A', { text: '- [ ] A2', children: [['    - [ ] a', null]] }),
        ]);

        expect(note.lines()).toEqual(['## Tasks', '- [ ] A2', '    - [ ] a', '- [ ] B2', '']);
    });

    it('refused, nothing is written, and the user told', async () => {
        const note = await open(['- [ ] A', '    ```', '    x', '    ```', 'para', '## Tasks', '']);
        const before = note.lines();

        // The fence left open runs on over `para`, below the subtree.
        const sent = await note.send([note.row('A', { text: '- [ ] A', children: [['    ```', 1], ['    x', 2]] })]);

        expect(sent).toEqual({ kind: 'not-done' });
        expect(note.lines()).toEqual(before);
        expect(Notice.messages).toHaveLength(1);
    });
});

describe('a row the draft completes (判断 10)', () => {
    it('fires where it stood, its next instance staying there, and the completed row goes', async () => {
        const note = await open(['# note', '- [ ] 週報 @2026-09-21 ==> every mon', '    - [ ] 子', '## Tasks', '- [ ] other', '']);
        const sent = await note.send([note.row('週報', { text: '- [x] 週報 @2026-09-21 ==> every mon', children: [['    - [ ] 子', 1]] })]);

        expect(sent.kind).toBe('done');
        expect(note.writes()).toBe(1);
        expect(note.lines()).toEqual([
            '# note',
            '- [ ] 週報 @2026-09-28 ==> every mon',
            '## Tasks',
            '- [x] 週報 @2026-09-21',
            '    - [ ] 子',
            '- [ ] other',
            '',
        ]);
        expect(Notice.messages).toEqual([]);
    });

    it('fires a completed child where it stood, in the row sent: its next instance goes with the row', async () => {
        const note = await open(['- [ ] P', '    - [ ] 日報 @2026-09-21 ==> every 1d', '## Tasks', '']);

        await note.send([note.row('P', { text: '- [ ] P', children: [['    - [x] 日報 @2026-09-21 ==> every 1d', 1]] })]);

        expect(note.lines()).toEqual([
            '## Tasks', '- [ ] P', '    - [ ] 日報 @2026-09-26 ==> every 1d', '    - [x] 日報 @2026-09-21', '',
        ]);
    });

    it('moved by its own fire, is sent on from where the move took it', async () => {
        const note = await open(['- [ ] T @2026-09-21 ==> move([[#Done]])', '## Done', '- [x] old', '## Tasks', '']);

        await note.send([note.row('T', { text: '- [x] T @2026-09-21 ==> move([[#Done]])', children: [] })]);

        expect(note.lines()).toEqual(['## Done', '- [x] old', '## Tasks', '- [x] T @2026-09-21', '']);
        expect(Notice.messages).toEqual([]);
    });

    it('whose fire cannot be planned stays completed, keeps its command, and is sent; the user told once', async () => {
        const note = await open(['- [ ] T @2026-09-21 ==> move([[#Nowhere]])', '## Tasks', '']);

        const sent = await note.send([note.row('T', { text: '- [x] T @2026-09-21 ==> move([[#Nowhere]])', children: [] })]);

        expect(sent.kind).toBe('done');
        expect(note.lines()).toEqual(['## Tasks', '- [x] T @2026-09-21 ==> move([[#Nowhere]])', '']);
        expect(Notice.messages).toHaveLength(1);
    });
});

describe('a send not made', () => {
    it('to a section under two headings of its name: nothing is written, and the user told', async () => {
        const note = await open(['- [ ] A', '## Tasks', '### tasks', '']);
        const before = note.lines();

        expect(await note.send([note.row('A')])).toEqual({ kind: 'not-done' });
        expect(note.lines()).toEqual(before);
        expect(Notice.messages).toHaveLength(1);
    });

    it('when the subtree is not the one the dialog was opened on', async () => {
        const note = await open(['- [ ] A', '    - [ ] a', '## Tasks', '']);
        const row = note.row('A');

        expect(await note.send([{ ...row, base: ['- [ ] A'] }])).toEqual({ kind: 'not-done' });
        expect(note.lines()).toEqual(['- [ ] A', '    - [ ] a', '## Tasks', '']);
    });

    it('to another note: not made yet', async () => {
        const note = await open(['- [ ] A', '']);

        const sent = await note.session.index.send([note.row('A')], { path: 'other.md', section: { heading: 'Tasks', level: 2, side: 'head' } });

        expect(sent).toEqual({ kind: 'not-done' });
        expect(note.writes()).toBe(0);
    });
});
