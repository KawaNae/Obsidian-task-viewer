import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Notice } from 'obsidian';
import { t } from '../../../src/i18n';
import { openLiveVault, type VaultSession } from '../helpers/vaultSession';
import { freezeDate } from '../helpers/fakeDate';
import type { SubtreeLine } from '../../../src/services/persistence/TaskOps';

/**
 * The hub's source mode, through the index (`TaskIndex.replaceSubtree`): a
 * row and its subtree written anew in one write, the names of the rows it
 * keeps following it, and the rows it completes fired in the same write,
 * each on its own, as the editor fires the rows one transaction completed.
 */

freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';

let live: VaultSession | undefined;
beforeEach(() => { Notice.messages.length = 0; });
afterEach(() => { live?.dispose(); live = undefined; });

type Child = [text: string, was: number | null];

async function open(lines: string[]) {
    const { contents, session } = await openLiveVault({ [FILE]: lines }, s => { live = s; });
    const fired: string[] = [];
    const plan = session.executor.planFire.bind(session.executor);
    session.executor.planFire = (...args) => {
        const planned = plan(...args);
        if (planned.kind === 'fires') fired.push(planned.task.content);
        return planned;
    };
    let writes = 0;
    const vault = session.app.vault as unknown as { process: (...args: unknown[]) => Promise<string> };
    const process = vault.process.bind(vault);
    vault.process = (...args) => { writes++; return process(...args); };
    const idOf = (content: string) => session.index.getTasks().find(task => task.content === content)!.id;
    return {
        session,
        fired,
        writes: () => writes,
        lines: () => contents.get(FILE)!.split('\n'),
        idOf,
        /** Replace the subtree of the row `content`, as the index read it. */
        replace: async (content: string, text: string, children: Child[]) => {
            const id = idOf(content);
            const base = session.index.getTask(id)!.subtreeLines!;
            const answer = await session.index.replaceSubtree(id, base, {
                text,
                children: children.map(([line, was]): SubtreeLine => ({ text: line, was })),
            });
            await session.flowSettled(FILE);
            return answer;
        },
    };
}

describe('the names of the rows a replacement keeps', () => {
    it('follow the row and each child line kept; a line written anew is a new row', async () => {
        const note = await open(['- [ ] P', '    - [ ] a', '    - [ ] b', '']);
        const [p, a, b] = ['P', 'a', 'b'].map(note.idOf);

        expect(await note.replace('P', '- [ ] P2', [['    - [ ] a2', 1], ['    - [ ] b', null]])).toEqual({ written: true });

        expect(note.session.index.getTask(p)?.content).toBe('P2');
        expect(note.session.index.getTask(a)?.content).toBe('a2');
        expect(note.session.index.getTask(b)).toBeUndefined();
        expect(note.writes()).toBe(1);
    });
});

describe('a row\'s `^id` in the draft', () => {
    it('is written as the draft says: taken off, the anchor goes; given twice, neither line holds it', async () => {
        const note = await open(['- [ ] P', '    - [ ] a ^x', '    - [ ] b ^y', '']);

        await note.replace('P', '- [ ] P', [['    - [ ] a', 1], ['    - [ ] b ^y', 2], ['    - [ ] c ^y', null]]);

        expect(note.lines()).toEqual(['- [ ] P', '    - [ ] a', '    - [ ] b ^y', '    - [ ] c ^y', '']);
        expect(note.session.index.getTaskByAnchor(FILE, 'x')).toBeUndefined();
        expect(note.session.index.getTaskByAnchor(FILE, 'y')).toBeUndefined();
    });
});

describe('the rows a replacement completes', () => {
    const WEEKLY = '- [ ] 週報 @2026-09-21 ==> every mon';
    const DAILY = '    - [ ] 日報 @2026-09-21 ==> every 1d';

    it('fire in the same write, the row and a child line each once', async () => {
        const note = await open([WEEKLY, DAILY, '']);

        await note.replace('週報', WEEKLY.replace('[ ]', '[x]'), [[DAILY.replace('[ ]', '[x]'), 1]]);

        expect(note.fired).toEqual(['週報', '日報']);
        expect(note.writes()).toBe(1);
        expect(note.lines()).toEqual([
            '- [ ] 週報 @2026-09-28 ==> every mon',
            '- [x] 週報 @2026-09-21',
            '    - [ ] 日報 @2026-09-26 ==> every 1d',
            '    - [x] 日報 @2026-09-21',
            '',
        ]);
        expect(Notice.messages).toEqual([]);
    });

    it('fires a child once where the row\'s move carried it', async () => {
        const note = await open(['# note', '- [ ] T @2026-09-21 ==> move([[#Done]])', DAILY, '## Done', '']);

        await note.replace('T', '- [x] T @2026-09-21 ==> move([[#Done]])', [[DAILY.replace('[ ]', '[x]'), 1]]);

        expect(note.fired).toEqual(['T', '日報']);
        expect(note.writes()).toBe(1);
        expect(note.lines()).toEqual([
            '# note', '## Done',
            '- [x] T @2026-09-21',
            '    - [ ] 日報 @2026-09-26 ==> every 1d',
            '    - [x] 日報 @2026-09-21',
            '',
        ]);
    });

    it('fire nothing for a line the draft wrote anew completed, or one it set down elsewhere', async () => {
        const note = await open(['- [ ] P', '    - [ ] a', DAILY, '']);

        // 日報 goes under `a`: its item is another, so it is a new line.
        await note.replace('P', '- [ ] P', [
            ['    - [ ] a', 1],
            [`    ${DAILY.replace('[ ]', '[x]')}`, 2],
            ['    - [x] 新 @2026-09-21 ==> every 1d', null],
        ]);

        expect(note.fired).toEqual([]);
        expect(note.lines()).toEqual([
            '- [ ] P', '    - [ ] a', '        - [x] 日報 @2026-09-21 ==> every 1d', '    - [x] 新 @2026-09-21 ==> every 1d', '',
        ]);
    });

    it('each stands on its own: a fire that cannot be written is set aside, the others written, and the user told of it once', async () => {
        // 対象's `==>` line holds `sub`: its next instance cannot be written
        // without changing what `sub` is (as in the editor's R1).
        const note = await open([
            '- [ ] P',
            '    - [ ] 対象 @2026-09-21',
            '        - ==> every mon',
            '            - [ ] sub',
            '    - [ ] B @2026-09-21 ==> every tue',
            '',
        ]);

        const answer = await note.replace('P', '- [ ] P', [
            ['    - [x] 対象 @2026-09-21', 1],
            ['        - ==> every mon', 2],
            ['            - [ ] sub', 3],
            ['    - [x] B @2026-09-21 ==> every tue', 4],
        ]);

        expect(answer).toEqual({ written: true });
        expect(note.writes()).toBe(1);
        // B's next instance goes at the head of its siblings.
        expect(note.lines()).toEqual([
            '- [ ] P',
            '    - [ ] B @2026-09-29 ==> every tue',
            '    - [x] 対象 @2026-09-21',
            '        - ==> every mon',
            '            - [ ] sub',
            '    - [x] B @2026-09-21',
            '',
        ]);
        expect(Notice.messages).toEqual([t('notice.flowNotRun', { reason: t('notice.refusedDisturbs'), subject: '- [x] 対象 @2026-09-21' })]);
    });
});

describe('a replacement refused', () => {
    it('writes nothing, fires nothing, and answers why, as the user was told', async () => {
        const note = await open(['- [ ] P ==> every 1d', '    - [ ] a', '']);
        const id = note.idOf('P');
        const base = note.session.index.getTask(id)!.subtreeLines!;
        // A child line written since the draft was opened, by the form.
        await note.session.index.insertLine(id, '- [ ] b', 'firstChild');
        await note.session.flowSettled(FILE);
        const before = note.lines();

        const answer = await note.session.index.replaceSubtree(id, base, { text: '- [x] P ==> every 1d', children: [{ text: '    - [ ] a', was: 1 }] });

        expect(answer).toEqual({ written: false, refused: { file: FILE, reason: { kind: 'changed' }, subject: 'P' } });
        expect(note.lines()).toEqual(before);
        expect(note.fired).toEqual([]);
        expect(Notice.messages).toHaveLength(1);
    });

    it('is not told in a notice when the caller shows it, and is learnt from all the same', async () => {
        const note = await open(['- [ ] P', '    - [ ] a', '']);
        const id = note.idOf('P');
        const base = note.session.index.getTask(id)!.subtreeLines!;
        await note.session.index.insertLine(id, '- [ ] b', 'firstChild');
        await note.session.flowSettled(FILE);
        const index = note.session.index as unknown as { learnFrom: (refusal: unknown) => Promise<void> };
        const learnt: unknown[] = [];
        const learnFrom = index.learnFrom.bind(index);
        index.learnFrom = (refusal) => { learnt.push(refusal); return learnFrom(refusal); };

        const answer = await note.session.index.replaceSubtree(id, base, { text: '- [x] P', children: [{ text: '    - [ ] a', was: 1 }] }, { tellRefusal: false });

        const refused = { file: FILE, reason: { kind: 'changed' }, subject: 'P' };
        expect(answer).toEqual({ written: false, refused });
        expect(Notice.messages).toEqual([]);
        expect(learnt).toEqual([refused]);
    });
});
