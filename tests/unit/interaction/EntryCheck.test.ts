import { describe, it, expect, vi } from 'vitest';
import { DragSession } from '../../../src/interaction/drag/DragSession';
import { MenuHandler } from '../../../src/interaction/menu/MenuHandler';
import type { DragContext, DragStrategy } from '../../../src/interaction/drag/DragStrategy';
import type { Operations } from '../../../src/services/operations/Operations';
import type { IndexReads } from '../../../src/services/core/TaskIndex';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

/**
 * A drag and a card's menu ask whether the task is still the row on the disk
 * as they open (`confirmTask`), so the user does not put work into an
 * operation the write would turn away. A no has been told to the user and
 * the note read again; the caller only stops.
 */

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}

function dragRig(answers: Promise<boolean>[]) {
    const calls: string[] = [];
    const ports = {
        setDraggingFile: vi.fn((path: string | null) => { calls.push(`drag ${path}`); }),
        notifyImmediate: vi.fn(() => { calls.push('notify'); }),
        confirmTask: vi.fn(() => answers.shift()!),
    } as unknown as Operations & IndexReads;
    const strategy = {
        onDown: () => { calls.push('down'); },
        onMove: () => { },
        onUp: async () => { calls.push('commit'); },
        onCancel: () => { calls.push('cancel'); },
    } as unknown as DragStrategy;
    const container = { style: { touchAction: '' } } as unknown as HTMLElement;
    const session = new DragSession({} as unknown as DragContext, container, ports, ports);
    const task = { id: 't', file: 'note.md' } as Task;
    return { calls, ports, strategy, session, task };
}

describe('a drag of a row the disk no longer holds as the index read it', () => {
    it('is cancelled when the answer comes during the drag, and commits nothing', async () => {
        const answer = deferred<boolean>();
        const { calls, session, strategy, task, ports } = dragRig([answer.promise]);

        session.start(strategy, {} as PointerEvent, task, {} as HTMLElement);
        expect(ports.confirmTask).toHaveBeenCalledWith('t');
        answer.resolve(false);
        await answer.promise;
        await Promise.resolve();

        expect(calls).toEqual(['drag note.md', 'down', 'cancel', 'drag null']);
        expect(session.isActive()).toBe(false);
        await session.handleUp({} as PointerEvent);
        expect(calls).not.toContain('commit');
    });

    it('lets go before the answer: the commit waits for it, and a no ends the drag as cancelled', async () => {
        const answer = deferred<boolean>();
        const { calls, session, strategy, task } = dragRig([answer.promise]);
        session.start(strategy, {} as PointerEvent, task, {} as HTMLElement);

        const up = session.handleUp({} as PointerEvent);
        await Promise.resolve();
        expect(calls).toEqual(['drag note.md', 'down']);
        answer.resolve(false);
        await up;

        expect(calls).toEqual(['drag note.md', 'down', 'cancel', 'drag null']);
    });

    it('lets go before the answer, and a yes commits', async () => {
        const answer = deferred<boolean>();
        const { calls, session, strategy, task } = dragRig([answer.promise]);
        session.start(strategy, {} as PointerEvent, task, {} as HTMLElement);

        const up = session.handleUp({} as PointerEvent);
        answer.resolve(true);
        await up;

        expect(calls).toEqual(['drag note.md', 'down', 'commit', 'drag null', 'notify']);
    });

    it('a check that throws answers no: the drag is cancelled, and nothing is left unhandled', async () => {
        const { calls, session, strategy, task } = dragRig([Promise.reject(new Error('boom'))]);
        session.start(strategy, {} as PointerEvent, task, {} as HTMLElement);

        await vi.waitFor(() => expect(calls).toContain('cancel'));
        expect(calls).toEqual(['drag note.md', 'down', 'cancel', 'drag null']);
    });

    it('a late no for a drag already over does not cancel the next one', async () => {
        const first = deferred<boolean>();
        const { calls, session, strategy, task } = dragRig([first.promise, Promise.resolve(true)]);
        session.start(strategy, {} as PointerEvent, task, {} as HTMLElement);
        session.cancel();
        session.start(strategy, {} as PointerEvent, task, {} as HTMLElement);

        first.resolve(false);
        await first.promise;
        await Promise.resolve();

        expect(session.isActive()).toBe(true);
        expect(calls.filter(call => call === 'cancel')).toHaveLength(1);
    });
});

describe('a card\'s menu', () => {
    function menuRig(fresh: boolean) {
        const task = makeTask({ id: 'tv-inline:note.md:ln:1', content: 'A' });
        const present = vi.fn();
        const confirmTask = vi.fn(async () => fresh);
        const handler = Object.create(MenuHandler.prototype) as MenuHandler;
        Object.assign(handler, {
            readService: { getTask: () => task },
            operations: { confirmTask },
            plugin: { settings: { startHour: 0 }, menuPresenter: { present } },
        });
        return { handler, task, present, confirmTask };
    }

    it('opens only once the task is known to be the row on the disk', async () => {
        const { handler, task, present, confirmTask } = menuRig(true);
        handler.showTaskContextMenu(task, 1, 2);
        await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(1));
        expect(confirmTask).toHaveBeenCalledWith(task.id);
    });

    it('does not open over a stale copy', async () => {
        const { handler, task, present, confirmTask } = menuRig(false);
        handler.showTaskContextMenu(task, 1, 2);
        await vi.waitFor(() => expect(confirmTask).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        expect(present).not.toHaveBeenCalled();
    });
});
