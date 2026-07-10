import { describe, it, expect, vi } from 'vitest';
import { FlowExecutor } from '../../../src/services/flow/FlowExecutor';
import { parseFlowSegments, singleLineFlow } from '../../../src/services/flow/FlowSegments';
import { TaskIndex } from '../../../src/services/core/TaskIndex';
import { TaskRepository } from '../../../src/services/persistence/TaskRepository';
import { DEFAULT_SETTINGS, Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';

function makeRepository() {
    return {
        insertRecurrenceForTask: vi.fn().mockResolvedValue(undefined),
        appendTaskWithChildren: vi.fn().mockResolvedValue(undefined),
        updateTaskInFile: vi.fn().mockResolvedValue(undefined),
        stripFlow: vi.fn().mockResolvedValue(undefined),
        deleteTaskFromFile: vi.fn().mockResolvedValue(undefined),
    };
}

function makeTaskIndex(resolved: (task: Task) => Task | undefined) {
    return {
        waitForScan: vi.fn().mockResolvedValue(undefined),
        resolveTask: vi.fn((t: Task) => resolved(t)),
        requestScan: vi.fn().mockResolvedValue(undefined),
        notifyImmediate: vi.fn(),
    };
}

const app = { vault: { getAbstractFileByPath: () => null } };

function makeExecutor(repository: ReturnType<typeof makeRepository>, resolved: (task: Task) => Task | undefined = t => t) {
    const taskIndex = makeTaskIndex(resolved);
    const executor = new FlowExecutor(
        repository as unknown as TaskRepository,
        taskIndex as unknown as TaskIndex,
        app as never,
        () => DEFAULT_SETTINGS
    );
    return { executor, taskIndex };
}

function flowTask(src: string, overrides: Partial<Task> = {}): Task {
    return makeTask({
        statusChar: 'x',
        startDate: '2026-06-29',
        originalText: '- [x] Test task',
        flow: singleLineFlow(src),
        ...overrides,
    });
}

async function flush() {
    // Drain the fire-and-forget queue (all awaited promises are resolved mocks)
    await new Promise(resolve => setTimeout(resolve, 0));
}

describe('FlowExecutor', () => {
    it('fires repeat: inserts the next instance, then strips the command', async () => {
        const repository = makeRepository();
        const { executor, taskIndex } = makeExecutor(repository);
        const task = flowTask('every mon');

        await executor.handleTaskCompletion(task);
        await flush();

        expect(repository.insertRecurrenceForTask).toHaveBeenCalledTimes(1);
        const [origArg, lineArg, copyChildrenArg, flowLinesArg] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(origArg).toBe(task);
        expect(lineArg).toContain('==> every mon');
        expect(copyChildrenArg).toBe(true);
        expect(flowLinesArg).toEqual([]);

        expect(repository.stripFlow).toHaveBeenCalledTimes(1);
        expect(repository.stripFlow).toHaveBeenCalledWith(task);
        expect(repository.updateTaskInFile).not.toHaveBeenCalled();

        // Order: insert BEFORE strip (line resolution depends on originalText)
        expect(repository.insertRecurrenceForTask.mock.invocationCallOrder[0])
            .toBeLessThan(repository.stripFlow.mock.invocationCallOrder[0]);

        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
        expect(taskIndex.notifyImmediate).toHaveBeenCalled();
    });

    it('fires a multi-line flow: child segments travel as flowLines, telomere decremented', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
        const raws = ['every mon', 'setDue(start + 3d)', 'x3'];
        const { program, diagnostics } = parseFlowSegments(raws);
        const task = flowTask('every mon', {
            flow: {
                raw: raws[0],
                childSegments: raws.slice(1).map((raw, i) => ({ raw, bodyLine: i + 1 })),
                program,
                diagnostics,
            },
        });

        await executor.handleTaskCompletion(task);
        await flush();

        const [, line, , flowLines] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(line).toContain('==> every mon');
        expect(line).not.toContain('setDue');
        expect(flowLines).toEqual(['setDue(start + 3d)', 'x2']);
        expect(repository.stripFlow).toHaveBeenCalledTimes(1);
    });

    it('fires move: archives then deletes the original (no strip)', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
        const task = flowTask('move([[Archive]])');

        await executor.handleTaskCompletion(task);
        await flush();

        expect(repository.appendTaskWithChildren).toHaveBeenCalledTimes(1);
        const [dest, line] = repository.appendTaskWithChildren.mock.calls[0];
        expect(dest).toBe('Archive.md');
        expect(line).not.toContain('==>');
        expect(repository.deleteTaskFromFile).toHaveBeenCalledTimes(1);
        expect(repository.updateTaskInFile).not.toHaveBeenCalled();
        expect(repository.appendTaskWithChildren.mock.invocationCallOrder[0])
            .toBeLessThan(repository.deleteTaskFromFile.mock.invocationCallOrder[0]);
    });

    it('does not fire for non-complete statuses (Doing)', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('every mon', { statusChar: '/' }));
        await flush();

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
    });

    it('re-checks after resolve: unchecked task is skipped', async () => {
        const repository = makeRepository();
        const task = flowTask('every mon');
        // Resolution returns the task already unchecked (race: check → uncheck)
        const { executor } = makeExecutor(repository, t => ({ ...t, statusChar: ' ' }));

        await executor.handleTaskCompletion(task);
        await flush();

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
    });

    it('consumes without generating when until has expired', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('every mon until(2026-06-30)'));
        await flush();

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).toHaveBeenCalledTimes(1);
    });

    it('leaves the command intact on runtime eval failure', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);
        // `end` is unset on the task → EvalError at fire time
        await executor.handleTaskCompletion(flowTask('every mon setDue(end + 1d)'));
        await flush();

        expect(repository.insertRecurrenceForTask).not.toHaveBeenCalled();
        expect(repository.stripFlow).not.toHaveBeenCalled();
        expect(repository.deleteTaskFromFile).not.toHaveBeenCalled();
    });

    it('processes the queue sequentially with a rescan await between tasks', async () => {
        const repository = makeRepository();
        const { executor, taskIndex } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('at(today + 1d)', { content: 'A', originalText: '- [x] A' }));
        await executor.handleTaskCompletion(flowTask('at(today + 1d)', { content: 'B', originalText: '- [x] B' }));
        await flush();

        expect(repository.insertRecurrenceForTask).toHaveBeenCalledTimes(2);
        expect(taskIndex.waitForScan).toHaveBeenCalledTimes(2);
    });

    it('decrements the telomere in the generated line', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('at(today + 1d) x3'));
        await flush();

        const [, line] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(line).toContain('==> at(today + 1d) x2');
    });

    it('x1: generated line carries no command', async () => {
        const repository = makeRepository();
        const { executor } = makeExecutor(repository);

        await executor.handleTaskCompletion(flowTask('at(today + 1d) x1'));
        await flush();

        const [, line] = repository.insertRecurrenceForTask.mock.calls[0];
        expect(line).not.toContain('==>');
    });
});
