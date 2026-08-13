import { describe, it, expect, vi } from 'vitest';
import { TaskParser } from '../../../src/services/parsing/TaskParser';
import { createTempTask } from '../../../src/services/data/createTempTask';
import { TFile } from 'obsidian';
import { InlineTaskWriter } from '../../../src/services/persistence/writers/InlineTaskWriter';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

/**
 * Writing primitives behind the timer's session records. The line-array
 * transformation itself lives in FileOperations.buildGroupWrap and is tested
 * there; what is pinned here is the notation of the group line and the routing
 * of the two child-insertion paths.
 */

// ── group line notation ──
// wrapTaskInGroup builds the group line this way rather than concatenating it,
// so that the notation stays owned by the parser.
function groupLineFor(fields: { content: string; startDate: string; endDate?: string }): string {
    return TaskParser.format(createTempTask({
        id: 'session-group:test',
        file: 'note.md',
        content: fields.content,
        statusChar: ' ',
        startDate: fields.startDate,
        endDate: fields.endDate,
    })).trim();
}

describe('session group line', () => {
    it('carries a bare date for work inside one day', () => {
        expect(groupLineFor({ content: 'task A', startDate: '2026-08-13' }))
            .toBe('- [ ] task A @2026-08-13');
    });

    it('expands to a date range once the work spans days', () => {
        expect(groupLineFor({ content: 'task A', startDate: '2026-08-13', endDate: '2026-08-15' }))
            .toBe('- [ ] task A @2026-08-13>2026-08-15');
    });

    it('carries no time component (the records own the time grid)', () => {
        const line = groupLineFor({ content: 'task A', startDate: '2026-08-13', endDate: '2026-08-15' });
        expect(line).not.toContain('T');
    });

    it('does not decorate the content', () => {
        expect(groupLineFor({ content: '⏱️ task A', startDate: '2026-08-13' }))
            .toBe('- [ ] ⏱️ task A @2026-08-13');
    });

    it('is what buildGroupLine produces', () => {
        expect(InlineTaskWriter.buildGroupLine('g', 'note.md', 'task A', '2026-08-13', '2026-08-15'))
            .toBe('- [ ] task A @2026-08-13>2026-08-15');
    });
});

// ── wrapTaskInGroup against a fake vault ──
// Exercises the real writer, so the group-content choice and the wrap itself
// are pinned by what actually lands in the file.
function runWrap(
    fileText: string,
    task: Task,
    opts: { groupStartDate: string; groupEndDate?: string; sessionLine: string; groupContent?: string }
): Promise<string> {
    let content = fileText;
    const file = new TFile();
    const app = {
        vault: {
            getAbstractFileByPath: () => file,
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
        },
    } as any;
    const writer = new InlineTaskWriter(app, new FileOperations(app));
    return writer.wrapTaskInGroup(task, opts).then(() => content);
}

// By the time wrapTaskInGroup runs, the task is the first session *record*:
// self-mode recording prefixes the content with the timer's icon (⏱️ / ⏳ /
// 🍅 / 🔁, TimerRecorder.updateTaskDirectly). That icon marks a record, so it
// must not reach the group line.
describe('wrapTaskInGroup', () => {
    const recordLine = '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
    const record = makeTask({
        content: '⏱️ task A',
        line: 0,
        originalText: recordLine,
        statusChar: 'x',
        startDate: '2026-08-13',
    });
    const SESSION = '- [x] ⏱️ task A @2026-08-13T14:00>2026-08-13T15:00';

    it('names the group with the caller-supplied undecorated content', async () => {
        const result = await runWrap(recordLine, record, {
            groupStartDate: '2026-08-13',
            sessionLine: SESSION,
            groupContent: 'task A',
        });
        expect(result.split('\n')).toEqual([
            '- [ ] task A @2026-08-13',
            `    ${recordLine}`,
            `    ${SESSION}`,
        ]);
    });

    it('falls back to the record content when no group content is given', async () => {
        const result = await runWrap(recordLine, record, {
            groupStartDate: '2026-08-13',
            sessionLine: SESSION,
        });
        expect(result.split('\n')[0]).toBe('- [ ] ⏱️ task A @2026-08-13');
    });

    it('keeps every timer icon out of the group line', async () => {
        for (const icon of ['⏱️', '⏳', '🍅', '🔁', '⏲️']) {
            const line = `- [x] ${icon} task A @2026-08-13T09:00>2026-08-13T10:00`;
            const iconRecord = makeTask({
                content: `${icon} task A`, line: 0, originalText: line,
                statusChar: 'x', startDate: '2026-08-13',
            });
            const result = await runWrap(line, iconRecord, {
                groupStartDate: '2026-08-13',
                sessionLine: SESSION,
                groupContent: 'task A',
            });
            expect(result.split('\n')[0]).toBe('- [ ] task A @2026-08-13');
        }
    });

    it('spans days once the group carries an end date', async () => {
        const result = await runWrap(recordLine, record, {
            groupStartDate: '2026-08-13',
            groupEndDate: '2026-08-15',
            sessionLine: SESSION,
            groupContent: 'task A',
        });
        expect(result.split('\n')[0]).toBe('- [ ] task A @2026-08-13>2026-08-15');
    });

    it('leaves the file untouched when the line cannot be resolved', async () => {
        const other = '- [ ] something else @2026-01-01';
        const result = await runWrap(other, makeTask({
            content: 'task A', line: 9, originalText: recordLine, startDate: '2026-08-13',
        }), { groupStartDate: '2026-08-13', sessionLine: SESSION, groupContent: 'task A' });
        expect(result).toBe(other);
    });
});

// ── insertSiblingAfterTask against a fake vault ──
// Session records after the first one are siblings of the record before them,
// so this exercises the real writer: where the line lands, and at what depth.
function runSiblingInsert(
    fileText: string,
    task: Task,
    lineBody: string,
    opts: { afterCompletedRun?: boolean } = {}
): Promise<{ text: string; index: number }> {
    let content = fileText;
    const file = new TFile();
    const app = {
        vault: {
            getAbstractFileByPath: () => file,
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
        },
    } as any;
    const writer = new InlineTaskWriter(app, new FileOperations(app));
    return writer.insertSiblingAfterTask(task, lineBody, opts)
        .then(index => ({ text: content, index }));
}

const NEW_SESSION = '- [ ] ⏱️ task A @2026-08-13T16:00';

describe('insertSiblingAfterTask', () => {
    it('lands just past the task, at the task\'s own indentation', async () => {
        const anchor = '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
        const { text, index } = await runSiblingInsert(
            [anchor, '- [ ] next task'].join('\n'),
            makeTask({ content: '⏱️ task A', line: 0, originalText: anchor, statusChar: 'x' }),
            NEW_SESSION
        );

        expect(text.split('\n')).toEqual([anchor, NEW_SESSION, '- [ ] next task']);
        expect(index).toBe(1);
    });

    it('reads the indent off the file rather than from the stored line', async () => {
        // The task moved under a parent since it was indexed. Taking the indent
        // from originalText would put the record back at top level, silently
        // pulling it out of the parent it belongs to.
        const anchor = '    - [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
        const { text } = await runSiblingInsert(
            ['- [ ] parent', anchor].join('\n'),
            makeTask({
                content: '⏱️ task A', line: 0, statusChar: 'x',
                originalText: '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00',
            }),
            NEW_SESSION
        );

        expect(text.split('\n')).toEqual(['- [ ] parent', anchor, `    ${NEW_SESSION}`]);
    });

    it('preserves a tab-indented vault\'s style', async () => {
        const anchor = '\t- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
        const { text } = await runSiblingInsert(
            ['- [ ] parent', anchor].join('\n'),
            makeTask({ content: '⏱️ task A', line: 1, originalText: anchor, statusChar: 'x' }),
            NEW_SESSION
        );

        expect(text.split('\n')[2]).toBe(`\t${NEW_SESSION}`);
    });

    it('clears the task\'s own children', async () => {
        const anchor = '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
        const { text } = await runSiblingInsert(
            [anchor, '    - memo', '    - [ ] sub'].join('\n'),
            makeTask({ content: '⏱️ task A', line: 0, originalText: anchor, statusChar: 'x' }),
            NEW_SESSION
        );

        expect(text.split('\n')).toEqual([anchor, '    - memo', '    - [ ] sub', NEW_SESSION]);
    });

    it('leaves the file untouched when the line cannot be resolved', async () => {
        const other = '- [ ] something else @2026-01-01';
        const { text, index } = await runSiblingInsert(
            other,
            makeTask({ content: 'task A', line: 9, originalText: '- [x] task A', startDate: '2026-08-13' }),
            NEW_SESSION
        );

        expect(text).toBe(other);
        expect(index).toBe(-1);
    });
});

// The timer resumes from whichever record the user's card points at — often not
// the newest one. Without this, a new session would be spliced into the middle
// of the run and the log would stop reading in order.
describe('insertSiblingAfterTask afterCompletedRun', () => {
    const first = '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00';
    const second = '- [x] ⏱️ task A @2026-08-13T11:00>2026-08-13T12:00';
    const third = '- [x] ⏱️ task A @2026-08-13T14:00>2026-08-13T15:00';
    const anchor = makeTask({ content: '⏱️ task A', line: 0, originalText: first, statusChar: 'x' });

    it('moves past the completed siblings that follow', async () => {
        const { text, index } = await runSiblingInsert(
            [first, second, third].join('\n'), anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, second, third, NEW_SESSION]);
        expect(index).toBe(3);
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
            makeTask({ content: '⏱️ task A', line: 1, originalText: nested, statusChar: 'x' }),
            NEW_SESSION,
            { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([
            '- [ ] parent', nested, `    ${NEW_SESSION}`, '- [x] unrelated top-level task',
        ]);
    });

    it('stops at a non-task line', async () => {
        const prose = 'ここから先はメモ';
        const { text } = await runSiblingInsert(
            [first, prose].join('\n'), anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, NEW_SESSION, prose]);
    });

    it('appends at the end of the file', async () => {
        const { text, index } = await runSiblingInsert(
            [first, second].join('\n'), anchor, NEW_SESSION, { afterCompletedRun: true }
        );

        expect(text.split('\n')).toEqual([first, second, NEW_SESSION]);
        expect(index).toBe(2);
    });
});

// ── child insertion routing ──

function buildIndexHost(task: Task | undefined) {
    return {
        store: { getTask: () => task },
        settings: { tvFileChildHeader: '', tvFileChildHeaderLevel: 2 },
        syncDetector: { markLocalEdit: vi.fn() },
        scanner: { waitForScan: vi.fn(async () => {}) },
        repository: {
            insertLineAsFirstChild: vi.fn(async () => 0),
            insertLineAfterTask: vi.fn(async () => 0),
            insertLineAfterTvFile: vi.fn(async () => 0),
            insertSiblingAfterTask: vi.fn(async () => 7),
            wrapTaskInGroup: vi.fn(async () => {}),
        },
        withNotify: vi.fn(async (_file: string, fn: () => Promise<unknown>) => await fn()),
    };
}

const proto = TaskIndex.prototype as any;

describe('TaskIndex child insertion', () => {
    it('appendChildTask inserts at the end of the subtree, not the head', async () => {
        const host = buildIndexHost(makeTask({ originalText: '\t- [ ] parent' }));
        await proto.appendChildTask.call(host, 'tv-inline:note.md:ln:1', '- [x] session');

        expect(host.repository.insertLineAfterTask).toHaveBeenCalledTimes(1);
        expect(host.repository.insertLineAsFirstChild).not.toHaveBeenCalled();
        // Indented one level below the parent, in the parent's own style.
        expect(host.repository.insertLineAfterTask.mock.calls[0][1]).toBe('\t\t- [x] session');
    });

    it('insertChildTask still inserts at the head', async () => {
        const host = buildIndexHost(makeTask({ originalText: '- [ ] parent' }));
        await proto.insertChildTask.call(host, 'tv-inline:note.md:ln:1', '- [ ] child');

        expect(host.repository.insertLineAsFirstChild).toHaveBeenCalledTimes(1);
        expect(host.repository.insertLineAfterTask).not.toHaveBeenCalled();
    });

    // Tasks / dayPlanner tasks are parsed read-only. TaskApi rejects writes to
    // them, but the menu path reaches the write service directly.
    it('insertChildTask is a no-op for a read-only task', async () => {
        const host = buildIndexHost(makeTask({ isReadOnly: true, parserId: 'tasks-plugin' }));
        await proto.insertChildTask.call(host, 'tv-inline:note.md:ln:1', '- [ ] child');

        expect(host.withNotify).not.toHaveBeenCalled();
        expect(host.repository.insertLineAsFirstChild).not.toHaveBeenCalled();
        expect(host.syncDetector.markLocalEdit).not.toHaveBeenCalled();
    });

    it('appendChildTask is a no-op for a read-only task', async () => {
        const host = buildIndexHost(makeTask({ isReadOnly: true, parserId: 'day-planner' }));
        await proto.appendChildTask.call(host, 'tv-inline:note.md:ln:1', '- [x] session');

        expect(host.withNotify).not.toHaveBeenCalled();
        expect(host.repository.insertLineAfterTask).not.toHaveBeenCalled();
    });

    it('wrapTaskInGroup routes to the repository for an inline task', async () => {
        const host = buildIndexHost(makeTask({ originalText: '- [x] ⏱️ task A @2026-08-13T09:00>2026-08-13T10:00' }));
        const opts = { groupStartDate: '2026-08-13', sessionLine: '- [x] ⏱️ task A @2026-08-13T14:00' };
        await proto.wrapTaskInGroup.call(host, 'tv-inline:note.md:ln:1', opts);

        expect(host.repository.wrapTaskInGroup).toHaveBeenCalledTimes(1);
        expect(host.repository.wrapTaskInGroup.mock.calls[0][1]).toEqual(opts);
        expect(host.syncDetector.markLocalEdit).toHaveBeenCalledWith('note.md');
    });

    // tv-file tasks already have a permanent group structure (the file itself),
    // so they accumulate children rather than being wrapped.
    it('wrapTaskInGroup skips tv-file and read-only tasks', async () => {
        const tvFile = buildIndexHost(makeTask({ parserId: 'tv-file', line: -1 }));
        await proto.wrapTaskInGroup.call(tvFile, 'x', { groupStartDate: '2026-08-13', sessionLine: '- [x] s' });
        expect(tvFile.repository.wrapTaskInGroup).not.toHaveBeenCalled();

        const readOnly = buildIndexHost(makeTask({ isReadOnly: true, parserId: 'tasks-plugin' }));
        await proto.wrapTaskInGroup.call(readOnly, 'x', { groupStartDate: '2026-08-13', sessionLine: '- [x] s' });
        expect(readOnly.repository.wrapTaskInGroup).not.toHaveBeenCalled();
    });

    it('both are no-ops when the task is unknown', async () => {
        const host = buildIndexHost(undefined);
        await proto.insertChildTask.call(host, 'missing', '- [ ] child');
        await proto.appendChildTask.call(host, 'missing', '- [x] session');
        expect(host.withNotify).not.toHaveBeenCalled();
    });
});

describe('TaskIndex.insertSiblingAfterTask', () => {
    it('routes to the repository, passing the options through untouched', async () => {
        const host = buildIndexHost(makeTask({ originalText: '- [x] ⏱️ task A @2026-08-13T09:00' }));
        const line = await proto.insertSiblingAfterTask.call(
            host, 'tv-inline:note.md:ln:1', NEW_SESSION, { afterCompletedRun: true }
        );

        expect(host.repository.insertSiblingAfterTask).toHaveBeenCalledTimes(1);
        expect(host.repository.insertSiblingAfterTask.mock.calls[0][1]).toBe(NEW_SESSION);
        expect(host.repository.insertSiblingAfterTask.mock.calls[0][2]).toEqual({ afterCompletedRun: true });
        expect(host.syncDetector.markLocalEdit).toHaveBeenCalledWith('note.md');
        expect(line).toBe(7);
    });

    // The line body arrives without indentation on purpose: the writer reads
    // the depth off the file, so nothing here should prepend one.
    it('hands the line body over unindented', async () => {
        const host = buildIndexHost(makeTask({ originalText: '\t- [x] ⏱️ task A' }));
        await proto.insertSiblingAfterTask.call(host, 'tv-inline:note.md:ln:1', NEW_SESSION);

        expect(host.repository.insertSiblingAfterTask.mock.calls[0][1]).toBe(NEW_SESSION);
    });

    it('is a no-op for read-only, tv-file and unknown tasks', async () => {
        const readOnly = buildIndexHost(makeTask({ isReadOnly: true, parserId: 'tasks-plugin' }));
        expect(await proto.insertSiblingAfterTask.call(readOnly, 'x', NEW_SESSION)).toBe(-1);

        // A tv-file task is a whole note; it has no siblings to insert between.
        const tvFile = buildIndexHost(makeTask({ parserId: 'tv-file', line: -1 }));
        expect(await proto.insertSiblingAfterTask.call(tvFile, 'x', NEW_SESSION)).toBe(-1);

        const unknown = buildIndexHost(undefined);
        expect(await proto.insertSiblingAfterTask.call(unknown, 'missing', NEW_SESSION)).toBe(-1);

        for (const host of [readOnly, tvFile, unknown]) {
            expect(host.withNotify).not.toHaveBeenCalled();
            expect(host.repository.insertSiblingAfterTask).not.toHaveBeenCalled();
            expect(host.syncDetector.markLocalEdit).not.toHaveBeenCalled();
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

    it('insertSiblingAfterTask reaches the index and returns its line index', async () => {
        const { idx, svc } = serviceWith({ insertSiblingAfterTask: vi.fn(async () => 3) });

        const line = await svc.insertSiblingAfterTask('p', NEW_SESSION, { afterCompletedRun: true });
        expect(idx.insertSiblingAfterTask).toHaveBeenCalledWith('p', NEW_SESSION, { afterCompletedRun: true });
        expect(line).toBe(3);
    });

    it('insertSiblingAfterTask defaults to no run-skipping', async () => {
        const { idx, svc } = serviceWith({ insertSiblingAfterTask: vi.fn(async () => 0) });

        await svc.insertSiblingAfterTask('p', NEW_SESSION);
        expect(idx.insertSiblingAfterTask).toHaveBeenCalledWith('p', NEW_SESSION, {});
    });
});
