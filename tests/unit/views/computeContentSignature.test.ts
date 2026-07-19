import { describe, it, expect, vi } from 'vitest';
import { computeContentSignature } from '../../../src/views/taskcard/TaskCardRenderer';
import type { DisplayTask, TaskViewerSettings, ChildEntry, Task } from '../../../src/types';
import type { TaskReadService } from '../../../src/services/data/TaskReadService';

function makeDisplayTask(overrides: Partial<DisplayTask> = {}): DisplayTask {
    return {
        id: 'test-1',
        file: 'test.md',
        line: 0,
        content: 'task content',
        statusChar: ' ',
        parserId: 'tv-inline',
        isReadOnly: false,
        tags: [],
        childIds: [],
        childLines: [],
        originalText: '- [ ] task content',
        indent: 0,
        effectiveStartDate: '2026-07-18',
        effectiveStartTime: '09:00',
        effectiveEndDate: '2026-07-18',
        effectiveEndTime: '10:00',
        effectiveDue: '2026-07-20',
        startDateImplicit: false,
        startTimeImplicit: false,
        endDateImplicit: false,
        endTimeImplicit: false,
        originalTaskId: 'test-1',
        isSplit: false,
        childEntries: [],
        ...overrides,
    } as DisplayTask;
}

function makeSettings(overrides: Partial<TaskViewerSettings> = {}): TaskViewerSettings {
    return {
        startHour: 0,
        childCollapseThreshold: 5,
        enableCardFileLink: true,
        statusDefinitions: [
            { char: ' ', label: 'Todo', isComplete: false },
            { char: 'x', label: 'Done', isComplete: true },
        ],
        weekStartDay: 1,
        ...overrides,
    } as TaskViewerSettings;
}

function makeOptions(overrides: Record<string, any> = {}) {
    return {
        cardInstanceId: 'card-1',
        compact: false,
        ...overrides,
    };
}

function makeReadService(childTasks: Record<string, Partial<Task>> = {}): TaskReadService {
    return {
        getTask: vi.fn((id: string) => {
            const t = childTasks[id];
            if (!t) return undefined;
            return { id, statusChar: ' ', content: 'child', ...t } as Task;
        }),
    } as any;
}

describe('computeContentSignature', () => {
    it('子タスクの content 変更で sig が変わる', () => {
        const childEntry: ChildEntry = { kind: 'task', taskId: 'child-1', bodyLine: 1 };
        const task = makeDisplayTask({ childEntries: [childEntry] });
        const settings = makeSettings();
        const options = makeOptions();

        const sig1 = computeContentSignature(
            task, settings, options, '', false, false,
            makeReadService({ 'child-1': { content: 'original' } }),
        );
        const sig2 = computeContentSignature(
            task, settings, options, '', false, false,
            makeReadService({ 'child-1': { content: 'changed' } }),
        );

        expect(sig1).not.toBe(sig2);
    });

    it('子タスクの statusChar 変更で sig が変わる', () => {
        const childEntry: ChildEntry = { kind: 'task', taskId: 'child-1', bodyLine: 1 };
        const task = makeDisplayTask({ childEntries: [childEntry] });
        const settings = makeSettings();
        const options = makeOptions();

        const sig1 = computeContentSignature(
            task, settings, options, '', false, false,
            makeReadService({ 'child-1': { statusChar: ' ' } }),
        );
        const sig2 = computeContentSignature(
            task, settings, options, '', false, false,
            makeReadService({ 'child-1': { statusChar: 'x' } }),
        );

        expect(sig1).not.toBe(sig2);
    });

    it('topRight が参照するフィールドの変更で sig が変わる', () => {
        const task = makeDisplayTask();
        const settings = makeSettings();
        const options = makeOptions();

        const sig1 = computeContentSignature(
            task, settings, options, '09:00>10:00', false, false,
            makeReadService(),
        );
        const sig2 = computeContentSignature(
            task, settings, options, '09:00>11:00', false, false,
            makeReadService(),
        );

        expect(sig1).not.toBe(sig2);
    });

    it('無関係な変更では sig が変わらない', () => {
        const task = makeDisplayTask();
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const sig1 = computeContentSignature(task, settings, options, '09:00', false, false, rs);
        const sig2 = computeContentSignature(task, settings, options, '09:00', false, false, rs);

        expect(sig1).toBe(sig2);
    });

    it('line entry のテキスト変更で sig が変わる', () => {
        const entry1: ChildEntry = {
            kind: 'line', bodyLine: 1,
            line: { text: 'line text', bodyLine: 1, indent: '', checkboxChar: null, wikilinkTarget: null, propertyKey: null },
        };
        const entry2: ChildEntry = {
            kind: 'line', bodyLine: 1,
            line: { text: 'changed text', bodyLine: 1, indent: '', checkboxChar: null, wikilinkTarget: null, propertyKey: null },
        };
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const sig1 = computeContentSignature(makeDisplayTask({ childEntries: [entry1] }), settings, options, '', false, false, rs);
        const sig2 = computeContentSignature(makeDisplayTask({ childEntries: [entry2] }), settings, options, '', false, false, rs);

        expect(sig1).not.toBe(sig2);
    });

    it('sig に XML 不正な制御文字が含まれない（SVG export 安全性）', () => {
        const task = makeDisplayTask({ content: 'has\x00null\x01soh\x1fus' });
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const sig = computeContentSignature(task, settings, options, '', false, false, rs);

        expect(sig).not.toMatch(/[\x00-\x1f]/);
    });

    it('フィールド境界の衝突が起きない（区切り文字がフィールド値に含まれても一意）', () => {
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const task1 = makeDisplayTask({ content: 'a', file: '|b.md' });
        const task2 = makeDisplayTask({ content: 'a|', file: 'b.md' });

        const sig1 = computeContentSignature(task1, settings, options, '', false, false, rs);
        const sig2 = computeContentSignature(task2, settings, options, '', false, false, rs);

        expect(sig1).not.toBe(sig2);
    });

    it('childSig 内の区切り文字衝突もない', () => {
        const settings = makeSettings();
        const options = makeOptions();

        const entry1: ChildEntry = {
            kind: 'line', bodyLine: 1,
            line: { text: 'a|b', bodyLine: 1, indent: '', checkboxChar: null, wikilinkTarget: null, propertyKey: null },
        };
        const entry2: ChildEntry = {
            kind: 'line', bodyLine: 2,
            line: { text: 'c', bodyLine: 2, indent: '', checkboxChar: null, wikilinkTarget: null, propertyKey: null },
        };
        const taskA = makeDisplayTask({ childEntries: [entry1] });

        const entryX: ChildEntry = {
            kind: 'line', bodyLine: 1,
            line: { text: 'a', bodyLine: 1, indent: '', checkboxChar: null, wikilinkTarget: null, propertyKey: null },
        };
        const entryY: ChildEntry = {
            kind: 'line', bodyLine: 2,
            line: { text: 'b', bodyLine: 2, indent: '', checkboxChar: null, wikilinkTarget: null, propertyKey: null },
        };
        const taskB = makeDisplayTask({ childEntries: [entryX, entryY] });

        const rs = makeReadService();
        const sigA = computeContentSignature(taskA, settings, options, '', false, false, rs);
        const sigB = computeContentSignature(taskB, settings, options, '', false, false, rs);

        expect(sigA).not.toBe(sigB);
    });
});
