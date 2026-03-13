import { describe, it, expect, vi } from 'vitest';
import { RepeatCommand, NextCommand } from '../../src/commands/GenerationCommands';
import { MoveCommand } from '../../src/commands/MoveCommand';
import type { Task, FlowCommand } from '../../src/types';
import type { CommandContext } from '../../src/commands/CommandStrategy';
import { makeTask } from '../helpers/makeTask';

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
