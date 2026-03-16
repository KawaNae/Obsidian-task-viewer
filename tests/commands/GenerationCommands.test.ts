import { describe, it, expect, vi } from 'vitest';
import { RepeatCommand, NextCommand } from '../../src/commands/GenerationCommands';
import { MoveCommand } from '../../src/commands/MoveCommand';
import type { Task, FlowCommand } from '../../src/types';
import type { CommandContext } from '../../src/commands/CommandStrategy';
import { makeTask } from '../helpers/makeTask';
import { DateUtils } from '../../src/utils/DateUtils';

function makeFlowCommand(name: string, args: string[] = [], modifiers: FlowCommand['modifiers'] = []): FlowCommand {
    return { name, args, modifiers };
}

/**
 * Create a mock CommandContext that captures calls to repository methods.
 */
function createMockContext(task: Task) {
    const insertRecurrenceForTask = vi.fn().mockResolvedValue(undefined);
    const appendTaskWithChildren = vi.fn().mockResolvedValue(undefined);

    const repository = {
        insertRecurrenceForTask,
        appendTaskWithChildren,
    };

    const ctx: CommandContext = {
        repository: repository as any,
        task,
    };

    return { ctx, insertRecurrenceForTask, appendTaskWithChildren };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RepeatCommand', () => {
    it('blockId/timerTargetId が生成タスクに引き継がれない', async () => {
        const task = makeTask({
            content: 'Timer task',
            startDate: '2026-03-11',
            blockId: 'tv-timer-target-abc123',
            timerTargetId: 'tv-timer-target-abc123',
            commands: [makeFlowCommand('repeat', ['1days'])],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('repeat', ['1days']);

        const repeat = new RepeatCommand();
        await repeat.execute(ctx, cmd);

        expect(insertRecurrenceForTask).toHaveBeenCalledOnce();
        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        expect(nextTask.blockId).toBeUndefined();
        expect(nextTask.timerTargetId).toBeUndefined();
    });

    it('タイマー設定の startTime/endTime が保持される（許容動作）', async () => {
        const task = makeTask({
            content: 'Timed task',
            startDate: '2026-03-11T19:00',
            startTime: '19:00',
            endDate: '2026-03-11T20:00',
            endTime: '20:00',
            commands: [makeFlowCommand('repeat', ['1days'])],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('repeat', ['1days']);

        const repeat = new RepeatCommand();
        await repeat.execute(ctx, cmd);

        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        expect(nextTask.startTime).toBe('19:00');
        expect(nextTask.endTime).toBe('20:00');
    });

    it('same-day タスク（endTime あり endDate なし）で endDate が startDate ベースでシフトされる', async () => {
        const task = makeTask({
            content: 'Same day task',
            startDate: '2026-03-16',
            startTime: '10:00',
            endTime: '12:00',
            // endDate is undefined (same-day optimized notation: @2026-03-16T10:00>12:00)
            commands: [makeFlowCommand('repeat', ['2days'])],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('repeat', ['2days']);

        const repeat = new RepeatCommand();
        await repeat.execute(ctx, cmd);

        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        expect(nextTask.startDate).toBe('2026-03-18');
        expect(nextTask.endDate).toBe('2026-03-18');
        expect(nextTask.startTime).toBe('10:00');
        expect(nextTask.endTime).toBe('12:00');
    });

    it('endTime も endDate もない場合は endDate が undefined のまま', async () => {
        const task = makeTask({
            content: 'Date only task',
            startDate: '2026-03-16',
            commands: [makeFlowCommand('repeat', ['1days'])],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('repeat', ['1days']);

        const repeat = new RepeatCommand();
        await repeat.execute(ctx, cmd);

        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        expect(nextTask.startDate).toBe('2026-03-17');
        expect(nextTask.endDate).toBeUndefined();
    });

    it('タイマーが変更した startDate を基準にシフトする', async () => {
        const task = makeTask({
            content: 'Shifted task',
            startDate: '2026-03-13',
            commands: [makeFlowCommand('repeat', ['1days'])],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('repeat', ['1days']);

        const repeat = new RepeatCommand();
        await repeat.execute(ctx, cmd);

        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        expect(nextTask.startDate).toBe('2026-03-14');
    });

    it('when-done: 今日を基準に次の日付を計算する（過去日付にならない）', async () => {
        const task = makeTask({
            content: 'When done task',
            startDate: '2025-01-10',
            endDate: '2025-01-12', // 2日間の span
            commands: [makeFlowCommand('repeat', ['3days when done'])],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('repeat', ['3days when done']);
        await new RepeatCommand().execute(ctx, cmd);

        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expectedStart = DateUtils.getLocalDateString(
            new Date(today.getTime() + 3 * 86400000)
        );
        expect(nextTask.startDate).toBe(expectedStart);
        // endDate = expectedStart + 2日（元の span 幅を保持）
        const expectedEnd = DateUtils.getLocalDateString(
            new Date(new Date(expectedStart + 'T00:00:00').getTime() + 2 * 86400000)
        );
        expect(nextTask.endDate).toBe(expectedEnd);
    });

    it('when-done: same-day タスクでも endDate が正しく設定される', async () => {
        const task = makeTask({
            content: 'Same day when done',
            startDate: '2025-01-10',
            startTime: '10:00',
            endTime: '12:00',
            commands: [makeFlowCommand('repeat', ['1days when done'])],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('repeat', ['1days when done']);
        await new RepeatCommand().execute(ctx, cmd);

        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expectedDate = DateUtils.getLocalDateString(
            new Date(today.getTime() + 86400000)
        );
        expect(nextTask.startDate).toBe(expectedDate);
        expect(nextTask.endDate).toBe(expectedDate);
    });

    it('when-done: 時刻部分が保持される', async () => {
        const task = makeTask({
            content: 'Timed when done',
            startDate: '2025-01-10T09:00',
            startTime: '09:00',
            endDate: '2025-01-10T17:00',
            endTime: '17:00',
            commands: [makeFlowCommand('repeat', ['2days when done'])],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('repeat', ['2days when done']);
        await new RepeatCommand().execute(ctx, cmd);

        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expectedDateStr = DateUtils.getLocalDateString(
            new Date(today.getTime() + 2 * 86400000)
        );
        expect(nextTask.startDate).toBe(`${expectedDateStr}T09:00`);
        expect(nextTask.endDate).toBe(`${expectedDateStr}T17:00`);
        expect(nextTask.startTime).toBe('09:00');
        expect(nextTask.endTime).toBe('17:00');
    });
});

describe('NextCommand', () => {
    it('blockId/timerTargetId が生成タスクに引き継がれない', async () => {
        const task = makeTask({
            content: 'Next task',
            startDate: '2026-03-11',
            blockId: 'tv-timer-target-xyz',
            timerTargetId: 'tv-timer-target-xyz',
            commands: [makeFlowCommand('next', ['1weeks'])],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('next', ['1weeks']);

        const next = new NextCommand();
        await next.execute(ctx, cmd);

        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        expect(nextTask.blockId).toBeUndefined();
        expect(nextTask.timerTargetId).toBeUndefined();
    });

    it('commands が空になる', async () => {
        const task = makeTask({
            content: 'Next task',
            startDate: '2026-03-11',
            commands: [
                makeFlowCommand('next', ['1weeks']),
                makeFlowCommand('repeat', ['1days']),
            ],
        });

        const { ctx, insertRecurrenceForTask } = createMockContext(task);
        const cmd = makeFlowCommand('next', ['1weeks']);

        const next = new NextCommand();
        await next.execute(ctx, cmd);

        const nextTask: Task = insertRecurrenceForTask.mock.calls[0][2];
        expect(nextTask.commands).toEqual([]);
    });
});

describe('MoveCommand', () => {
    it('アーカイブタスクに blockId/timerTargetId が含まれない', async () => {
        const task = makeTask({
            content: 'Move me',
            blockId: 'tv-timer-target-move',
            timerTargetId: 'tv-timer-target-move',
            commands: [makeFlowCommand('move', ['archive/done'])],
        });

        const { ctx, appendTaskWithChildren } = createMockContext(task);
        const cmd = makeFlowCommand('move', ['archive/done']);

        const move = new MoveCommand();
        const result = await move.execute(ctx, cmd);

        expect(result.shouldDeleteOriginal).toBe(true);
        expect(appendTaskWithChildren).toHaveBeenCalledOnce();

        // The formatted content string should not contain the blockId
        const formattedContent: string = appendTaskWithChildren.mock.calls[0][1];
        expect(formattedContent).not.toContain('tv-timer-target-move');
    });
});
