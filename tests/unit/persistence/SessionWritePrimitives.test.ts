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
            wrapTaskInGroup: vi.fn(async () => {}),
        },
        withNotify: vi.fn(async (_file: string, fn: () => Promise<void>) => { await fn(); }),
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

describe('TaskWriteService.appendChildTask', () => {
    it('delegates to the index with the resolved id', async () => {
        const idx = {
            getTask: (id: string) => (id === 'p' ? makeTask({ id: 'p' }) : undefined),
            appendChildTask: vi.fn(async () => {}),
        } as any;
        const svc = new TaskWriteService(idx);

        await svc.appendChildTask('p', '- [x] session');
        expect(idx.appendChildTask).toHaveBeenCalledWith('p', '- [x] session');
    });
});
