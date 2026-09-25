import { describe, it, expect, vi } from 'vitest';
import { computeContentSignature } from '../../../src/views/taskcard/TaskCardRenderer';
import type { DisplayTask, TaskViewerSettings, ChildEntry, Task } from '../../../src/types';
import type { TaskReadService } from '../../../src/services/data/TaskReadService';
import { ChildItemBuilder } from '../../../src/views/taskcard/ChildItemBuilder';
import type { ChildRenderItem } from '../../../src/views/taskcard/types';

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
            return { id, statusChar: ' ', content: 'child', childEntries: [], ...t } as Task;
        }),
        getChildEntries: (task: Task) => (task as DisplayTask).childEntries ?? [],
    } as any;
}

/** What the card shows of the children of `task`, as the renderer builds it. */
function shown(task: DisplayTask, rs: TaskReadService): ChildRenderItem[] {
    return new ChildItemBuilder(rs).buildChildItems(task, '');
}

describe('computeContentSignature', () => {
    it('子タスクの content 変更で sig が変わる', () => {
        const childEntry: ChildEntry = { kind: 'task', taskId: 'child-1', bodyLine: 1 };
        const task = makeDisplayTask({ childEntries: [childEntry] });
        const settings = makeSettings();
        const options = makeOptions();

        const sig1 = computeContentSignature(
            task, settings, options, '', 'none', false, false,
            shown(task, makeReadService({ 'child-1': { content: 'original' } })),
        );
        const sig2 = computeContentSignature(
            task, settings, options, '', 'none', false, false,
            shown(task, makeReadService({ 'child-1': { content: 'changed' } })),
        );

        expect(sig1).not.toBe(sig2);
    });

    it('子タスクの statusChar 変更で sig が変わる', () => {
        const childEntry: ChildEntry = { kind: 'task', taskId: 'child-1', bodyLine: 1 };
        const task = makeDisplayTask({ childEntries: [childEntry] });
        const settings = makeSettings();
        const options = makeOptions();

        const sig1 = computeContentSignature(
            task, settings, options, '', 'none', false, false,
            shown(task, makeReadService({ 'child-1': { statusChar: ' ' } })),
        );
        const sig2 = computeContentSignature(
            task, settings, options, '', 'none', false, false,
            shown(task, makeReadService({ 'child-1': { statusChar: 'x' } })),
        );

        expect(sig1).not.toBe(sig2);
    });

    it('topRight が参照するフィールドの変更で sig が変わる', () => {
        const task = makeDisplayTask();
        const settings = makeSettings();
        const options = makeOptions();

        const sig1 = computeContentSignature(
            task, settings, options, '09:00>10:00', 'none', false, false,
            shown(task, makeReadService()),
        );
        const sig2 = computeContentSignature(
            task, settings, options, '09:00>11:00', 'none', false, false,
            shown(task, makeReadService()),
        );

        expect(sig1).not.toBe(sig2);
    });

    it('無関係な変更では sig が変わらない', () => {
        const task = makeDisplayTask();
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const sig1 = computeContentSignature(task, settings, options, '09:00', 'none', false, false, shown(task, rs));
        const sig2 = computeContentSignature(task, settings, options, '09:00', 'none', false, false, shown(task, rs));

        expect(sig1).toBe(sig2);
    });

    it('line entry のテキスト変更で sig が変わる', () => {
        const entry1: ChildEntry = {
            kind: 'line', bodyLine: 1,
            line: { text: 'line text', bodyLine: 1, indent: '', wikilinkTarget: null, propertyKey: null },
        };
        const entry2: ChildEntry = {
            kind: 'line', bodyLine: 1,
            line: { text: 'changed text', bodyLine: 1, indent: '', wikilinkTarget: null, propertyKey: null },
        };
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const sig1 = computeContentSignature(makeDisplayTask({ childEntries: [entry1] }), settings, options, '', 'none', false, false, shown(makeDisplayTask({ childEntries: [entry1] }), rs));
        const sig2 = computeContentSignature(makeDisplayTask({ childEntries: [entry2] }), settings, options, '', 'none', false, false, shown(makeDisplayTask({ childEntries: [entry2] }), rs));

        expect(sig1).not.toBe(sig2);
    });

    it('sig に XML 不正な制御文字が含まれない（SVG export 安全性）', () => {
        const task = makeDisplayTask({ content: 'has\x00null\x01soh\x1fus' });
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const sig = computeContentSignature(task, settings, options, '', 'none', false, false, shown(task, rs));

        expect(sig).not.toMatch(/[\x00-\x1f]/);
    });

    it('フィールド境界の衝突が起きない（区切り文字がフィールド値に含まれても一意）', () => {
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const task1 = makeDisplayTask({ content: 'a', file: '|b.md' });
        const task2 = makeDisplayTask({ content: 'a|', file: 'b.md' });

        const sig1 = computeContentSignature(task1, settings, options, '', 'none', false, false, shown(task1, rs));
        const sig2 = computeContentSignature(task2, settings, options, '', 'none', false, false, shown(task2, rs));

        expect(sig1).not.toBe(sig2);
    });

    it('childSig 内の区切り文字衝突もない', () => {
        const settings = makeSettings();
        const options = makeOptions();

        const entry1: ChildEntry = {
            kind: 'line', bodyLine: 1,
            line: { text: 'a|b', bodyLine: 1, indent: '', wikilinkTarget: null, propertyKey: null },
        };
        const entry2: ChildEntry = {
            kind: 'line', bodyLine: 2,
            line: { text: 'c', bodyLine: 2, indent: '', wikilinkTarget: null, propertyKey: null },
        };
        const taskA = makeDisplayTask({ childEntries: [entry1] });

        const entryX: ChildEntry = {
            kind: 'line', bodyLine: 1,
            line: { text: 'a', bodyLine: 1, indent: '', wikilinkTarget: null, propertyKey: null },
        };
        const entryY: ChildEntry = {
            kind: 'line', bodyLine: 2,
            line: { text: 'b', bodyLine: 2, indent: '', wikilinkTarget: null, propertyKey: null },
        };
        const taskB = makeDisplayTask({ childEntries: [entryX, entryY] });

        const rs = makeReadService();
        const sigA = computeContentSignature(taskA, settings, options, '', 'none', false, false, shown(taskA, rs));
        const sigB = computeContentSignature(taskB, settings, options, '', 'none', false, false, shown(taskB, rs));

        expect(sigA).not.toBe(sigB);
    });

    it('overdue レベルが変わると sig が変わる', () => {
        const task = makeDisplayTask();
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const none = computeContentSignature(task, settings, options, '', 'none', false, false, shown(task, rs));
        const pastEnd = computeContentSignature(task, settings, options, '', 'past-end', false, false, shown(task, rs));
        const pastDue = computeContentSignature(task, settings, options, '', 'past-due', false, false, shown(task, rs));

        expect(none).not.toBe(pastEnd);
        expect(pastEnd).not.toBe(pastDue);
        expect(none).not.toBe(pastDue);
    });

    it('overdue レベルが同じなら sig は変わらない', () => {
        const task = makeDisplayTask();
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();

        const sig1 = computeContentSignature(task, settings, options, '', 'past-end', false, false, shown(task, rs));
        const sig2 = computeContentSignature(task, settings, options, '', 'past-end', false, false, shown(task, rs));

        expect(sig1).toBe(sig2);
    });

    it('名前を含まない（読み直しで名前だけが変わったカードは描き直さない）', () => {
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();
        const before = makeDisplayTask({ id: 'tv-inline:test.md:n:0:1:20:0000000000000001', originalTaskId: undefined });
        const after = makeDisplayTask({ id: 'tv-inline:test.md:n:0:2:28:0000000000000002', originalTaskId: undefined });

        expect(computeContentSignature(before, settings, options, '', 'none', false, false, shown(before, rs)))
            .toBe(computeContentSignature(after, settings, options, '', 'none', false, false, shown(after, rs)));
    });

    it('子の名前だけが変わっても変わらない', () => {
        const settings = makeSettings();
        const options = makeOptions();
        const task = (childId: string) => makeDisplayTask({ childEntries: [{ kind: 'task', taskId: childId, bodyLine: 1 }] });
        const rs = makeReadService({ 'child-old': { content: 'c' }, 'child-now': { content: 'c' } });

        expect(computeContentSignature(task('child-old'), settings, options, '', 'none', false, false, shown(task('child-old'), rs)))
            .toBe(computeContentSignature(task('child-now'), settings, options, '', 'none', false, false, shown(task('child-now'), rs)));
    });

    it('孫の変更で sig が変わる', () => {
        const settings = makeSettings();
        const options = makeOptions();
        const task = makeDisplayTask({ childEntries: [{ kind: 'task', taskId: 'child-1', bodyLine: 1 }] });
        const grand = (content: string) => makeReadService({
            'child-1': { childEntries: [{ kind: 'task', taskId: 'grand-1', bodyLine: 2 }] } as Partial<DisplayTask>,
            'grand-1': { content },
        });

        expect(computeContentSignature(task, settings, options, '', 'none', false, false, shown(task, grand('g'))))
            .not.toBe(computeContentSignature(task, settings, options, '', 'none', false, false, shown(task, grand('h'))));
    });

    it('子の日付の表記の変更で sig が変わる', () => {
        const settings = makeSettings();
        const options = makeOptions();
        const task = makeDisplayTask({ childEntries: [{ kind: 'task', taskId: 'child-1', bodyLine: 1 }] });

        expect(computeContentSignature(task, settings, options, '', 'none', false, false,
            shown(task, makeReadService({ 'child-1': { startDate: '2026-09-25' } }))))
            .not.toBe(computeContentSignature(task, settings, options, '', 'none', false, false,
                shown(task, makeReadService({ 'child-1': { startDate: '2026-09-26' } }))));
    });

    it('親の生の日付（子の時刻だけの表記に出る）の変更で sig が変わる', () => {
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();
        const a = makeDisplayTask({ startDate: '2026-09-25' });
        const b = makeDisplayTask({ startDate: '2026-09-26' });

        expect(computeContentSignature(a, settings, options, '', 'none', false, false, shown(a, rs)))
            .not.toBe(computeContentSignature(b, settings, options, '', 'none', false, false, shown(b, rs)));
    });

    it('マスク中はマスクの文字の変更で sig が変わる', () => {
        const settings = makeSettings();
        const options = makeOptions();
        const rs = makeReadService();
        const a = makeDisplayTask({ mask: 'A' });
        const b = makeDisplayTask({ mask: 'B' });

        expect(computeContentSignature(a, settings, options, '', 'none', true, false, shown(a, rs)))
            .not.toBe(computeContentSignature(b, settings, options, '', 'none', true, false, shown(b, rs)));
    });

    it('ハブの preview かどうかで sig が変わる', () => {
        const settings = makeSettings();
        const task = makeDisplayTask();
        const rs = makeReadService();

        expect(computeContentSignature(task, settings, makeOptions(), '', 'none', false, false, shown(task, rs)))
            .not.toBe(computeContentSignature(task, settings, makeOptions({ context: 'hub-preview' }), '', 'none', false, false, shown(task, rs)));
    });
});
