import { describe, it, expect, afterEach, vi } from 'vitest';
import type { TimerInstance } from '../../../src/timer/TimerInstance';
import { vaultSession, type VaultSession } from '../helpers/vaultSession';

/**
 * A timer finds the rows it follows across readings by their anchor alone
 * (`TaskIndex.getTaskByAnchor`): the `^id` on a row, when no other row of the
 * file carries it. Not by a name from an earlier reading, not by the row's
 * text, and never a row whose `^id` another row carries too.
 *
 * Each "session" is a fresh index over the same contents: a reload.
 */

const FILE = 'notes/a.md';
const ANCHOR = 'tv-t-a1';

afterEach(() => vi.useRealTimers());

function lines(contents: Map<string, string>): string[] {
    return contents.get(FILE)!.split('\n').filter(line => line.trim() !== '');
}

/** A child-mode timer on the row reading `対象`, as the first session knew it. */
async function timerOn(contents: Map<string, string>, over: Partial<TimerInstance> = {}): Promise<TimerInstance> {
    const first = vaultSession(contents);
    await first.scanAll();
    const target = first.index.getTasks().find(task => task.content === '対象')!;
    const timer = first.creator.createTimer({
        taskId: target.id,
        taskName: target.content,
        taskFile: target.file,
        taskOriginalText: target.originalText,
        timerTargetId: target.anchor,
        timerType: 'countup',
        recordMode: 'child',
        autoStart: true,
    });
    Object.assign(timer, over);
    first.dispose();
    return JSON.parse(JSON.stringify(timer)) as TimerInstance;
}

/** The next session over `contents`, scanned: a reload after the edits. */
async function reload(contents: Map<string, string>): Promise<VaultSession> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5_000);
    const s = vaultSession(contents);
    await s.scanAll();
    return s;
}

async function record(s: VaultSession, timer: TimerInstance): Promise<boolean> {
    const written = await s.recorder.recordSessionEnd(timer);
    await s.settle(FILE);
    return written;
}

describe('a timer finds its target by the anchor, across an edit and a reload', () => {
    const start = ['- [ ] 対象 @2026-09-21 ^tv-t-a1', '- [ ] 下 @2026-09-21', ''].join('\n');

    it.each<[string, (text: string) => string]>([
        ['a line added above', text => `- [ ] 新しい行\n${text}`],
        ['the row indented under a new parent', text => `- [ ] 親\n${text.replace('- [ ] 対象', '    - [ ] 対象')}`],
        ['a twin added above', text => `- [ ] 対象 @2026-09-21\n${text}`],
        ['a twin added below', text => text.replace('- [ ] 下', '- [ ] 対象 @2026-09-21\n- [ ] 下')],
    ])('%s: the record goes under the anchored row', async (_name, edit) => {
        const contents = new Map([[FILE, start]]);
        const timer = await timerOn(contents);
        expect(timer.timerTargetId).toBe(ANCHOR);
        contents.set(FILE, edit(contents.get(FILE)!));

        const s = await reload(contents);
        expect(await record(s, timer)).toBe(true);

        const after = lines(contents);
        const at = after.findIndex(line => line.includes(`^${ANCHOR}`));
        const indentOf = (line: string) => line.length - line.trimStart().length;
        expect(after[at + 1]).toMatch(/- \[x\] /);
        expect(indentOf(after[at + 1])).toBeGreaterThan(indentOf(after[at]));
        // Nothing else was written: one line more than the edit left.
        expect(after).toHaveLength(edit(start).split('\n').filter(l => l.trim() !== '').length + 1);
    });
});

describe('a timer does not write where it cannot name the row by its anchor', () => {
    it('a target ^id that two rows carry: no record under either', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21 ^tv-t-a1', ''].join('\n')]]);
        const timer = await timerOn(contents);
        contents.set(FILE, ['- [ ] 対象 @2026-09-21 ^tv-t-a1', '- [ ] 対象 @2026-09-21 ^tv-t-a1', ''].join('\n'));
        const before = contents.get(FILE);

        const s = await reload(contents);
        expect(await record(s, timer)).toBe(false);
        expect(contents.get(FILE)).toBe(before);
    });

    it('a target without an anchor, after a reload: its text does not find it, so a twin above takes nothing', async () => {
        const contents = new Map([[FILE, ['- [ ] 対象 @2026-09-21', ''].join('\n')]]);
        const timer = await timerOn(contents);
        expect(timer.timerTargetId).toBeUndefined();
        contents.set(FILE, ['- [ ] 対象 @2026-09-21', '- [ ] 対象 @2026-09-21', ''].join('\n'));
        const before = contents.get(FILE);

        const s = await reload(contents);
        expect(await record(s, timer)).toBe(false);
        expect(contents.get(FILE)).toBe(before);
    });

    it('a tail ^id that two rows carry: neither is closed as the running line', async () => {
        const contents = new Map([[FILE, [
            '- [ ] 対象 @2026-09-21 ^tv-t-a1',
            '    - [ ] 対象 @2026-09-21T09:00 ^tv-t-tail',
            '    - [ ] 対象 @2026-09-21T09:00 ^tv-t-tail',
            '',
        ].join('\n')]]);
        const timer = await timerOn(contents, { tailRecordBlockId: 'tv-t-tail' });

        const s = await reload(contents);
        await record(s, timer);
        // Both copies of the running line stay open.
        expect(lines(contents).filter(line => line.includes('^tv-t-tail') && line.includes('- [ ] '))).toHaveLength(2);
    });
});
