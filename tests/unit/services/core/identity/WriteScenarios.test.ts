import { describe, it, expect, vi, afterEach } from 'vitest';
import { vaultSession, type VaultSession } from '../../../helpers/vaultSession';

/**
 * The two writes that used to move IDs under whoever held them, driven through
 * the real write path and the real scan instead of hand-written before/after
 * files.
 *
 * - Bug 1: checking a task with `==> every mon` fires the flow, which writes the
 *   next instance at the head of the sibling group. With `ln:` IDs every line
 *   below shifted, and the hub holding the fired task's ID showed its neighbour.
 * - W2: a child-mode timer writes its session line under the target, pushing
 *   the task below down a line; with `ln:` its ID changed and selections holding
 *   it resolved to nothing.
 */

const FILE = 'verify.md';

let live: VaultSession | undefined;
afterEach(() => {
    live?.dispose();
    live = undefined;
});

function taskLines(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split('\n').filter(line => line.startsWith('- ['));
}

describe('IDs held across a plugin write', () => {
    it('bug 1: the fired task keeps its ID while the next instance lands at the head', async () => {
        const contents = new Map([[FILE, [
            '# verify b1',
            '',
            '- [ ] 前の行 @2026-09-21',
            '- [ ] 週報 @2026-09-21 ==> every mon',
            '- [ ] 後の行 @2026-09-21',
            '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const find = (content: string) => live!.index.getTasks().filter(task => task.content === content);
        const held = { prev: find('前の行')[0].id, weekly: find('週報')[0].id, next: find('後の行')[0].id };

        await live.index.updateTask(held.weekly, { statusChar: 'x' });
        await vi.waitFor(() => expect(taskLines(contents)).toHaveLength(4));
        await live.settle(FILE);

        // The flow wrote the next instance at the head of the group.
        expect(taskLines(contents)[0]).toMatch(/^- \[ \] 週報 @2026-09-28/);

        const fired = live.index.getTask(held.weekly)!;
        expect(fired.content).toBe('週報');
        expect(fired.statusChar).toBe('x');
        expect(fired.startDate).toBe('2026-09-21');
        const fresh = find('週報').find(task => task.startDate === '2026-09-28')!;
        expect(fresh.id).not.toBe(held.weekly);
        expect(live.index.getTask(held.prev)!.content).toBe('前の行');
        expect(live.index.getTask(held.next)!.content).toBe('後の行');
    });

    it('W2: a timer session line written under the target leaves the task below its ID', async () => {
        const contents = new Map([[FILE, [
            '# verify w2',
            '',
            '- [ ] 上のタスク @2026-09-21',
            '- [ ] 下のタスク @2026-09-21',
            '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const top = live.index.getTasks().find(task => task.content === '上のタスク')!;
        const below = live.index.getTasks().find(task => task.content === '下のタスク')!.id;

        const timer = live.creator.createTimer({
            taskId: top.id,
            taskName: top.content,
            taskFile: top.file,
            taskOriginalText: top.originalText,
            timerType: 'countup',
            recordMode: 'child',
            autoStart: true,
        });
        const sessionId = await live.recorder.createChildAtStart(timer);
        await live.settle(FILE);

        const lines = contents.get(FILE)!.split('\n');
        expect(lines.findIndex(line => line.includes('下のタスク'))).toBe(4);
        expect(live.index.getTask(below)!.content).toBe('下のタスク');
        expect(live.index.getTask(top.id)!.childIds).toEqual([sessionId]);
        expect(live.index.getTask(sessionId!)!.parentId).toBe(top.id);
    });
});

/**
 * Checking one of several identical siblings must not trade IDs between them.
 *
 * Checking a line moves it out of the "[ ]" text bucket, so that bucket is
 * n-against-m. Zipping it by position slid every later line onto its
 * neighbour's ID; the card just touched then pointed at the next line, and the
 * next write through it landed there.
 */
describe('identical siblings under a check', () => {
    async function check(session: VaultSession, id: string, statusChar: string): Promise<void> {
        await session.index.updateTask(id, { statusChar });
        await session.settle(FILE);
    }

    function idsInFileOrder(session: VaultSession): string[] {
        return session.index.getTasks()
            .filter(task => task.file === FILE)
            .sort((a, b) => a.line - b.line)
            .map(task => task.id);
    }

    it('case A: two lines sharing a ^id keep their IDs, and a write lands on its own line', async () => {
        const contents = new Map([[FILE, ['- [ ] 複製 @2026-09-21 ^dup1', '- [ ] 複製 @2026-09-21 ^dup1', ''].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const [first, second] = idsInFileOrder(live);

        await check(live, second, 'x');
        expect(idsInFileOrder(live)).toEqual([first, second]);

        await check(live, first, 'x');
        expect(idsInFileOrder(live)).toEqual([first, second]);

        await check(live, first, ' ');
        expect(taskLines(contents)).toEqual(['- [ ] 複製 @2026-09-21 ^dup1', '- [x] 複製 @2026-09-21 ^dup1']);
        expect(idsInFileOrder(live)).toEqual([first, second]);
    });

    it('case B: four identical lines keep their IDs as they are checked one by one', async () => {
        const contents = new Map([[FILE, Array(4).fill('- [ ] ポモドーロ @2026-09-21').concat('').join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const ids = idsInFileOrder(live);

        await check(live, ids[2], 'x');
        expect(idsInFileOrder(live)).toEqual(ids);
        expect(live.index.getTask(ids[2])!.statusChar).toBe('x');

        await check(live, ids[0], 'x');
        expect(idsInFileOrder(live)).toEqual(ids);
        expect(taskLines(contents).map(line => line.slice(0, 5))).toEqual(['- [x]', '- [ ]', '- [x]', '- [ ]']);
    });
});

describe('IDs held across a duplicate', () => {
    it('the original keeps its ID and the copy is a new task', async () => {
        const contents = new Map([[FILE, [
            '- [ ] ポモドーロ @2026-09-21T10:00>11:00',
            '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const original = live.index.getTasks()[0].id;

        await live.index.duplicateTask(original);
        await live.settle(FILE);

        // Two lines the ladder cannot tell apart — it would hand the old ID to
        // whichever came first. The write knew which one it had just made.
        const tasks = live.index.getTasks().sort((a, b) => a.line - b.line);
        expect(tasks).toHaveLength(2);
        expect(tasks[0].id).toBe(original);
        expect(tasks[1].id).not.toBe(original);
    });

    it('keeps the ID of a child whose block the copy carried', async () => {
        // The copied block holds a task child, a note, and a fence with a
        // task-shaped line in it. Which of those are rows is the parser's
        // answer, not the writer's — the claim is built from what was written.
        const contents = new Map([[FILE, [
            '- [ ] 親 @2026-09-21T10:00>11:00',
            '\t- [ ] 子 @2026-09-21',
            '\tmemo',
            '\t```js',
            '\t- [ ] これはコード',
            '\t```',
            '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const before = live.index.getTasks().sort((a, b) => a.line - b.line);
        expect(before).toHaveLength(2);
        const held = { parent: before[0].id, child: before[1].id };

        await live.index.duplicateTask(held.parent);
        await live.settle(FILE);

        const after = live.index.getTasks().sort((a, b) => a.line - b.line);
        expect(after).toHaveLength(4);
        expect(after[0].id).toBe(held.parent);
        expect(after[1].id).toBe(held.child);
        expect(after[2].id).not.toBe(held.parent);
        expect(after[3].id).not.toBe(held.child);
        // The fenced line is nobody's row, before or after.
        expect(after.map(task => task.content)).toEqual(['親', '子', '親', '子']);
    });

    it('a second copy with no scan in between still knows what is new', async () => {
        const contents = new Map([[FILE, ['- [ ] 甲 @2026-09-21T10:00>11:00', ''].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const original = live.index.getTasks()[0].id;

        await live.index.duplicateTask(original);
        await live.index.duplicateTask(original);
        await live.settle(FILE);

        const tasks = live.index.getTasks().sort((a, b) => a.line - b.line);
        expect(tasks).toHaveLength(3);
        expect(tasks[0].id).toBe(original);
        expect(tasks.filter(task => task.id === original)).toHaveLength(1);
    });
});

describe('the duplicate the ladder gets wrong', () => {
    it('a dateless copy above the original leaves the original its ID', async () => {
        // `dayOffset` puts the copy above, and a task with no date has nothing
        // to shift, so the two lines come out identical. By text the ladder
        // cannot choose, and by ordinal it picks the upper one — handing the
        // hub's task to the line that was just written. This is the case stage
        // 2 exists for, and the measurement on a real vault agrees: without a
        // claim, "the old ID goes to the copy and the original is renumbered".
        const contents = new Map([[FILE, ['- [ ] 日付のないタスク', ''].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const original = live.index.getTasks()[0].id;

        await live.index.duplicateTask(original, { dayOffset: 1 });
        await live.settle(FILE);

        const tasks = live.index.getTasks().sort((a, b) => a.line - b.line);
        expect(tasks).toHaveLength(2);
        // The copy is the upper line, and it is the new task.
        expect(tasks[0].id).not.toBe(original);
        expect(tasks[1].id).toBe(original);
    });
});
