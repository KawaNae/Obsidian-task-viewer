import { describe, it, expect, vi } from 'vitest';
import { DragSession } from '../../../src/interaction/drag/DragSession';
import type { DragContext, DragStrategy } from '../../../src/interaction/drag/DragStrategy';
import type { TaskWriteService } from '../../../src/services/data/TaskWriteService';
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
