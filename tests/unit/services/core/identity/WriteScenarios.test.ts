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
