import { describe, it, expect, vi } from 'vitest';
import { DragSession } from '../../../src/interaction/drag/DragSession';
import { DragHandler } from '../../../src/interaction/drag/DragHandler';
import type { DragContext, DragStrategy } from '../../../src/interaction/drag/DragStrategy';
import type { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import type { TaskReadService } from '../../../src/services/data/TaskReadService';
import type { PluginContext } from '../../../src/PluginContext';
import type { SelectionController } from '../../../src/interaction/selection/SelectionController';
import type { Task } from '../../../src/types';

/**
 * A drag lets go of its file once its commit has landed and its change has
 * been told (`DragSession.handleUp`), before `handleUp` returns: the readings
 * held while it was dragged are answered by their content, the drag's own
 * write included, so nothing is left for a later frame to wait for.
 */
describe('a drag that ends', () => {
    it('lets go of its file after the commit and the notify, before handleUp returns', async () => {
        const calls: string[] = [];
        const writeService = {
            setDraggingFile: vi.fn((path: string | null) => { calls.push(`drag ${path}`); }),
            notifyImmediate: vi.fn(() => { calls.push('notify'); }),
        } as unknown as TaskWriteService;
        const strategy = {
            onDown: () => { },
            onMove: () => { },
            onUp: async () => { calls.push('commit'); },
            onCancel: () => { },
        } as unknown as DragStrategy;
        // A window whose frames never come: nothing may wait for one.
        const view = { requestAnimationFrame: () => 1 };
        const container = { style: { touchAction: '' }, nodeType: 1, ownerDocument: { defaultView: view } } as unknown as HTMLElement;
        const session = new DragSession({ onTaskMove: () => { } } as unknown as DragContext, container, writeService);
        const task = { id: 't', file: 'note.md' } as Task;

        session.start(strategy, {} as PointerEvent, task, {} as HTMLElement);
        await session.handleUp({} as PointerEvent);

        expect(calls).toEqual(['drag note.md', 'commit', 'notify', 'drag null']);
        expect(session.isActive()).toBe(false);
    });
});

/**
 * However a drag ends, it lets go of its file: a file left held keeps every
 * reading of it out of the index, and every write to it is refused until some
 * other drag ends or the vault is read again.
 */
describe('a drag that ends without a commit', () => {
    function rig(onUp: () => Promise<void>) {
        const calls: string[] = [];
        const writeService = {
            setDraggingFile: vi.fn((path: string | null) => { calls.push(`drag ${path}`); }),
            notifyImmediate: vi.fn(() => { calls.push('notify'); }),
        } as unknown as TaskWriteService;
        const strategy = {
            onDown: () => { },
            onMove: () => { },
            onUp,
            onCancel: () => { calls.push('cancel'); },
        } as unknown as DragStrategy;
        const doc = new EventTarget();
        const container = Object.assign(new EventTarget(), {
            style: { touchAction: '' },
            ownerDocument: doc,
        }) as unknown as HTMLElement;
        const context = { onTaskMove: () => { } } as unknown as DragContext;
        const task = { id: 't', file: 'note.md' } as Task;
        return { calls, writeService, strategy, container, context, task };
    }

    it('lets go of its file when its view is closed mid-drag', () => {
        const { calls, writeService, strategy, container, task } = rig(async () => { });
        const handler = new DragHandler(
            container, {} as TaskReadService, writeService, {} as PluginContext,
            {} as SelectionController, () => { }, () => { }, () => '', () => '', () => 1,
        );
        const session = (handler as unknown as { session: DragSession }).session;
        session.start(strategy, {} as PointerEvent, task, {} as HTMLElement);

        handler.destroy();

        expect(calls).toEqual(['drag note.md', 'cancel', 'drag null']);
        expect(session.isActive()).toBe(false);
    });

    it('lets go of its file when its commit throws', async () => {
        const { calls, writeService, strategy, container, context, task } =
            rig(async () => { throw new Error('commit failed'); });
        const session = new DragSession(context, container, writeService);
        session.start(strategy, {} as PointerEvent, task, {} as HTMLElement);

        await expect(session.handleUp({} as PointerEvent)).rejects.toThrow('commit failed');

        expect(calls).toEqual(['drag note.md', 'drag null']);
        expect(session.isActive()).toBe(false);
    });
});
