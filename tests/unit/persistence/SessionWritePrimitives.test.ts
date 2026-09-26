import { describe, it, expect, vi } from 'vitest';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { makeTask } from '../helpers/makeTask';
import { writeBench, FILE } from '../helpers/writeBench';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import type { Refusal, WriteOutcome } from '../../../src/utils/FileLines';
import type { Task } from '../../../src/types';

/**
 * Writing primitives behind the timer's session records: where a record lands
 * and at what depth. The record's own notation belongs to the parser and is
 * pinned there.
 */

// ── insertSiblingAfterTask against a fake vault ──
// Session records after the first one are siblings of the record before them,
// so this exercises the real writer: where the line lands, and at what depth.
//
// The file is scanned as `fileText` and the anchor is the task the scan read on
// `line`. `now`, when given, is what the file reads by the time of the write:
// something other than the plugin changed it after the scan.
async function runSiblingInsert(
    fileText: string,
    line: number,
    lineBody: string,
    opts: { afterCompletedRun?: boolean } = {},
    now?: string,
): Promise<{ text: string; index: WriteOutcome; refused: Refusal[] }> {
    const bench = await writeBench(fileText);
    const task = bench.taskAt(line);
    if (now !== undefined) bench.edit(now);
    const index = await bench.writer.applyToTask(plannedOn(task), [
        { kind: 'insert', place: opts.afterCompletedRun ? 'afterCompletedRun' : 'afterSubtree', text: lineBody },
    ]);
    return { text: bench.text(), index, refused: bench.refused };
}

const NEW_SESSION = '- [ ] ⏱️ task A @2026-08-13T16:00';

describe('insertSiblingAfterTask', () => {
    it('lands just past the task, at the task\'s own indentation', async () => {
        const anchor = '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
        const { text, index } = await runSiblingInsert(
            [anchor, '- [ ] next task'].join('\n'), 0,
            NEW_SESSION
        );

        expect(text.split('\n')).toEqual([anchor, NEW_SESSION, '- [ ] next task']);
        expect(index.written).toBe(true);
    });

    it('refuses a record on a row only indented since it was indexed', async () => {
        // A record now takes the same check as every write: a row that
        // changed since the reading — even only indented — is refused, the
        // record not silently pulled back to the depth `originalText` held.
        const read = '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
        const anchor = '    - [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
        const { text, index } = await runSiblingInsert(
            ['- [ ] parent', read].join('\n'), 1,
            NEW_SESSION, {},
            ['- [ ] parent', anchor].join('\n'),
        );

        expect(index.written).toBe(false);
        expect(text.split('\n')).toEqual(['- [ ] parent', anchor]);
    });

    it('preserves a tab-indented vault\'s style', async () => {
        const anchor = '\t- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
        const { text } = await runSiblingInsert(
            ['- [ ] parent', anchor].join('\n'), 1,
            NEW_SESSION
        );

        expect(text.split('\n')[2]).toBe(`\t${NEW_SESSION}`);
    });

    it('clears the task\'s own children', async () => {
        const anchor = '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
        const { text } = await runSiblingInsert(
            [anchor, '    - memo', '    - [ ] sub'].join('\n'), 0,
            NEW_SESSION
        );

        expect(text.split('\n')).toEqual([anchor, '    - memo', '    - [ ] sub', NEW_SESSION]);
    });

    it('leaves the file untouched when the line cannot be resolved', async () => {
        // The task was read, then taken out of the file by something else.
        const other = '- [ ] something else @2026-01-01';
        const { text, index, refused } = await runSiblingInsert(
            ['- [x] task A @2026-08-13', other].join('\n'), 0,
            NEW_SESSION, {},
            other,
        );

        expect(text).toBe(other);
        expect(index.written).toBe(false);
        expect(refused).toEqual([{ file: FILE, reason: { kind: 'changed' }, subject: 'task A' }]);
    });
});

// The timer resumes from whichever record the user's card points at — often not
// the newest one. Without this, a new session would be spliced into the middle
// of the run and the log would stop reading in order.
describe('insertSiblingAfterTask afterCompletedRun', () => {
    const first = '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
    const second = '- [x] ⏱️ task A @2026-08-13T11:00>2026-08-13T12:00';
    const third = '- [x] ⏱️ task A @2026-08-13T14:00>2026-08-13T15:00';
    const anchor = 0;

    it('moves past the completed siblings that follow', async () => {
        const { text, index } = await runSiblingInsert(
            [first, second, third].join('\n'), anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, second, third, NEW_SESSION]);
        expect(index.written).toBe(true);
    });

    it('splits the run when the option is off', async () => {
        const { text } = await runSiblingInsert(
            [first, second, third].join('\n'), anchor, NEW_SESSION
        );

        expect(text.split('\n')).toEqual([first, NEW_SESSION, second, third]);
    });

    it('steps over each completed sibling\'s children too', async () => {
        const { text } = await runSiblingInsert(
            [first, second, '    - memo on the second', third].join('\n'),
            anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, second, '    - memo on the second', third, NEW_SESSION]);
    });

    it('stops at an unfinished sibling', async () => {
        const pending = '- [ ] write up the results';
        const { text } = await runSiblingInsert(
            [first, second, pending, third].join('\n'),
            anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, second, NEW_SESSION, pending, third]);
    });

    // `[x]` is the one fact the parser knows for certain. Anything else — a
    // cancelled `[-]`, an in-progress `[/]`, a line that merely looks like a
    // record — is indistinguishable from something the user wrote by hand.
    it('counts only [x] as completed', async () => {
        for (const status of ['-', '/', '>', 'X']) {
            const other = `- [${status}] ⏱️ task A @2026-08-13T11:00>2026-08-13T12:00`;
            const { text } = await runSiblingInsert(
                [first, other].join('\n'), anchor, NEW_SESSION, { afterCompletedRun: true }
            );
            expect(text.split('\n')).toEqual([first, NEW_SESSION, other]);
        }
    });

    it('stops at a blank line', async () => {
        const { text } = await runSiblingInsert(
            [first, '', second].join('\n'), anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, NEW_SESSION, '', second]);
    });

    it('stops at a shallower line', async () => {
        const nested = `    ${first}`;
        const { text } = await runSiblingInsert(
            ['- [ ] parent', nested, '- [x] unrelated top-level task'].join('\n'),
            1,
            NEW_SESSION,
            { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([
            '- [ ] parent', nested, `    ${NEW_SESSION}`, '- [x] unrelated top-level task',
        ]);
    });

    it('stops at a non-task line', async () => {
        const prose = '- ここから先はメモ';
        const { text } = await runSiblingInsert(
            [first, prose].join('\n'), anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, NEW_SESSION, prose]);
    });

    it('goes past a paragraph line right below the row, which is the row\'s (Obsidian, measurement.md q5)', async () => {
        // A line at column 0 with no blank line above goes on the row's
        // paragraph (a lazy continuation): it is in the row's item.
        const prose = 'ここから先はメモ';
        const { text } = await runSiblingInsert(
            [first, prose].join('\n'), anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, prose, NEW_SESSION]);
    });

    it('appends at the end of the file', async () => {
        const { text, index } = await runSiblingInsert(
            [first, second].join('\n'), anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, second, NEW_SESSION]);
        expect(index.written).toBe(true);
    });
});

// ── child insertion routing ──

const MADE = { written: true, refused: null, made: [], rows: new Map() } as const;

function buildIndexHost(task: Task | undefined) {
    return {
        store: { getTask: () => task },
        scanner: { waitForScan: vi.fn(async () => {}), follow: () => null },
        repository: {
            insertLineAfterTask: vi.fn(async () => MADE),
            applyToTask: vi.fn(async () => MADE),
        },
        withNotify: vi.fn(async (_file: string, fn: () => Promise<unknown>) => await fn()),
        // The dispose guard every write goes through; this index is open.
        disposed: false,
        refuseAfterDispose: proto.refuseAfterDispose,

        copyForWrite: proto.copyForWrite,
        getTask: proto.getTask,

        reportRefusal: () => { /* the notice is not measured here */ },
    };
}

const proto = TaskIndex.prototype as any;

describe('TaskIndex child insertion', () => {
    it('appendChildTask inserts at the end of the subtree, not the head', async () => {
        const host = buildIndexHost(makeTask({ originalText: '\t- [ ] parent' }));
        await proto.appendChildTask.call(host, 'tv-inline:note.md:ln:1', '- [x] session');

        expect(host.repository.insertLineAfterTask).toHaveBeenCalledTimes(1);
        expect(host.repository.applyToTask).not.toHaveBeenCalled();
        // The body is passed through unindented: the depth is resolved by the
        // write layer, which can see the children the task already has.
        expect(host.repository.insertLineAfterTask.mock.calls[0][1]).toBe('- [x] session');
    });

    it('insertLine puts a first child at the head', async () => {
        const host = buildIndexHost(makeTask({ originalText: '- [ ] parent' }));
        await proto.insertLine.call(host, 'tv-inline:note.md:ln:1', '- [ ] child', 'firstChild');

        expect(host.repository.applyToTask.mock.calls[0][1]).toEqual([{ kind: 'insert', place: 'firstChild', text: '- [ ] child' }]);
        expect(host.repository.insertLineAfterTask).not.toHaveBeenCalled();
    });

    // Tasks / dayPlanner tasks are parsed read-only. TaskApi rejects writes to
    // them, but the menu path reaches the write service directly.
    it('insertLine is a no-op for a read-only task', async () => {
        const host = buildIndexHost(makeTask({ isReadOnly: true, parserId: 'tasks-plugin' }));
        await proto.insertLine.call(host, 'tv-inline:note.md:ln:1', '- [ ] child', 'firstChild');

        expect(host.withNotify).not.toHaveBeenCalled();
        expect(host.repository.applyToTask).not.toHaveBeenCalled();
    });

    it('appendChildTask is a no-op for a read-only task', async () => {
        const host = buildIndexHost(makeTask({ isReadOnly: true, parserId: 'day-planner' }));
        await proto.appendChildTask.call(host, 'tv-inline:note.md:ln:1', '- [x] session');

        expect(host.withNotify).not.toHaveBeenCalled();
        expect(host.repository.insertLineAfterTask).not.toHaveBeenCalled();
    });

    it('both are no-ops when the task is unknown', async () => {
        const host = buildIndexHost(undefined);
        await proto.insertLine.call(host, 'missing', '- [ ] child', 'firstChild');
        await proto.appendChildTask.call(host, 'missing', '- [x] session');
        expect(host.withNotify).not.toHaveBeenCalled();
    });
});

describe('TaskIndex.insertLine', () => {
    it('routes to the repository, passing the place through untouched', async () => {
        const host = buildIndexHost(makeTask({ originalText: '- [x] ⏱️ task A @2026-08-13T09:00' }));
        const line = await proto.insertLine.call(
            host, 'tv-inline:note.md:ln:1', NEW_SESSION, 'afterCompletedRun'
        );

        expect(host.repository.applyToTask).toHaveBeenCalledTimes(1);
        expect(host.repository.applyToTask.mock.calls[0][1]).toEqual([
            { kind: 'insert', place: 'afterCompletedRun', text: NEW_SESSION },
        ]);
        expect(line).toBe(true);
    });

    // The line body arrives without indentation on purpose: the writer reads
    // the depth off the file, so nothing here should prepend one.
    it('hands the line body over unindented', async () => {
        const host = buildIndexHost(makeTask({ originalText: '\t- [x] ⏱️ task A' }));
        await proto.insertLine.call(host, 'tv-inline:note.md:ln:1', NEW_SESSION, 'afterSubtree');

        expect(host.repository.applyToTask.mock.calls[0][1]).toEqual([
            { kind: 'insert', place: 'afterSubtree', text: NEW_SESSION },
        ]);
    });

    it('is a no-op for read-only and unknown tasks', async () => {
        const readOnly = buildIndexHost(makeTask({ isReadOnly: true, parserId: 'tasks-plugin' }));
        expect(await proto.insertLine.call(readOnly, 'x', NEW_SESSION, 'afterSubtree')).toBe(false);

        const unknown = buildIndexHost(undefined);
        expect(await proto.insertLine.call(unknown, 'missing', NEW_SESSION, 'afterSubtree')).toBe(false);

        for (const host of [readOnly, unknown]) {
            expect(host.withNotify).not.toHaveBeenCalled();
            expect(host.repository.applyToTask).not.toHaveBeenCalled();
        }
    });
});

describe('TaskWriteService delegation', () => {
    function serviceWith(overrides: Record<string, unknown>) {
        const idx = {
            getTask: (id: string) => (id === 'p' ? makeTask({ id: 'p' }) : undefined),
            ...overrides,
        } as any;
        return { idx, svc: new TaskWriteService(idx) };
    }

    it('appendChildTask reaches the index with the resolved id', async () => {
        const { idx, svc } = serviceWith({ appendChildTask: vi.fn(async () => {}) });

        await svc.appendChildTask('p', '- [x] session');
        expect(idx.appendChildTask).toHaveBeenCalledWith('p', '- [x] session');
    });

    it('insertLine reaches the index and returns whether it wrote', async () => {
        const { idx, svc } = serviceWith({ insertLine: vi.fn(async () => true) });

        const written = await svc.insertLine('p', NEW_SESSION, 'afterCompletedRun');
        expect(idx.insertLine).toHaveBeenCalledWith('p', NEW_SESSION, 'afterCompletedRun', undefined);
        expect(written).toBe(true);
    });

    it('insertLine passes rowId through as undefined when it is not given', async () => {
        const { idx, svc } = serviceWith({ insertLine: vi.fn(async () => false) });

        await svc.insertLine('p', NEW_SESSION, 'afterSubtree');
        expect(idx.insertLine).toHaveBeenCalledWith('p', NEW_SESSION, 'afterSubtree', undefined);
    });
});

// ── child inserts resolve their own indent ──
async function runChildInsert(
    fileText: string,
    line: number,
    lineBody: string,
    mode: 'first' | 'after'
): Promise<{ text: string; index: WriteOutcome }> {
    const bench = await writeBench(fileText);
    const task = bench.taskAt(line);
    const index = mode === 'first'
        ? await bench.writer.applyToTask(plannedOn(task), [{ kind: 'insert', place: 'firstChild', text: lineBody }])
        : await bench.writer.insertLineAfterTask(plannedOn(task), lineBody);
    return { text: bench.text(), index };
}

describe('child inserts take their indent from the file', () => {
    const parent = '- [ ] parent @2026-08-13T09:00';
    const RECORD = '- [x] ⏱️ parent @2026-08-13T10:00>11:00';

    it('follows an existing tab-indented child', async () => {
        const { text } = await runChildInsert(
            [parent, '\t- [ ] existing'].join('\n'), 0, RECORD, 'after'
        );
        expect(text.split('\n')).toEqual([parent, '\t- [ ] existing', '\t' + RECORD]);
    });

    it('follows an existing space-indented child', async () => {
        const { text } = await runChildInsert(
            [parent, '    - [ ] existing'].join('\n'), 0, RECORD, 'after'
        );
        expect(text.split('\n')).toEqual([parent, '    - [ ] existing', '    ' + RECORD]);
    });

    it('falls back to how the rest of the file is written', async () => {
        // The parent has no children yet, but the file is tab-indented. Deriving
        // the unit from the top-level parent line alone would answer 4 spaces.
        const { text } = await runChildInsert(
            [parent, '- [ ] other', '\t- [ ] other child'].join('\n'),
            0, RECORD, 'first'
        );
        expect(text.split('\n')[1]).toBe('\t' + RECORD);
    });

    it('uses a tab when the file has no indentation to read', async () => {
        const { text } = await runChildInsert(parent, 0, RECORD, 'first');
        expect(text.split('\n')[1]).toBe('\t' + RECORD);
    });

    it('ignores indentation supplied by the caller', async () => {
        const { text } = await runChildInsert(
            [parent, '\t- [ ] existing'].join('\n'), 0, '        ' + RECORD, 'after'
        );
        expect(text.split('\n')[2]).toBe('\t' + RECORD);
    });
});

describe('completed-run walk across mixed indentation', () => {
    // Files written before the indent unification can hold both spellings of the
    // same depth. Comparing raw character counts stops the walk at the first
    // sibling spelled the other way, which drops a new record into the middle of
    // the run instead of at its end.
    it('steps over a tab-indented sibling from a space-indented anchor, and takes its spelling', async () => {
        const first = '    - [x] ⏱️ rec @2026-08-13T10:00>10:30';
        const second = '\t- [x] ⏱️ rec @2026-08-13T11:00>11:30';
        const { text } = await runSiblingInsert(
            ['- [ ] parent', first, second].join('\n'),
            1,
            NEW_SESSION,
            { afterCompletedRun: true }
        );

        // At the indentation of the sibling it goes next to, the last of the
        // run (P1: siblings spelled at other columns would take it under them).
        expect(text.split('\n')).toEqual(['- [ ] parent', first, second, '\t' + NEW_SESSION]);
    });

    it('still stops at a genuinely shallower line', async () => {
        const anchor = '\t- [x] ⏱️ rec @2026-08-13T10:00>10:30';
        const { text } = await runSiblingInsert(
            ['- [ ] parent', anchor, '- [x] top level'].join('\n'),
            1,
            NEW_SESSION,
            { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual(['- [ ] parent', anchor, '\t' + NEW_SESSION, '- [x] top level']);
    });
});
