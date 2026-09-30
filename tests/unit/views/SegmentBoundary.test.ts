import { describe, it, expect, vi } from 'vitest';
import { CardHold } from '../../../src/views/taskcard/CardHold';
import { MenuHandler } from '../../../src/interaction/menu/MenuHandler';
import { TaskHubPanel } from '../../../src/modals/hub/TaskHubPanel';
import { splitDisplayTaskAtBoundary, toDisplayTask, NO_TASK_LOOKUP } from '../../../src/services/display/DisplayTaskConverter';
import { makeTask } from '../helpers/makeTask';
import type { DisplayTask, Task } from '../../../src/types';

/**
 * A segment ID (`…##seg:YYYY-MM-DD`) is a key within the display. Where a
 * segment card acts on its row — the card's hold, the menu, the hub — it
 * takes the row's name (`getOriginalTaskId`), so no write is handed a
 * segment ID.
 */

const NAME = 'tv-inline:a.md:n:k1.1:0';

function segments(): [DisplayTask, DisplayTask] {
    const task = makeTask({ id: NAME, file: 'a.md', startDate: '2026-03-11', startTime: '22:00', endDate: '2026-03-12', endTime: '08:00' });
    return splitDisplayTaskAtBoundary(toDisplayTask(task, 5, NO_TASK_LOOKUP), 5);
}

describe('a segment acts on its row', () => {
    it('is split into segments that carry segment IDs', () => {
        const [first, second] = segments();
        expect(first.id).not.toBe(NAME);
        expect(second.id).not.toBe(NAME);
        expect(first.originalTaskId).toBe(NAME);
    });

    it('a card holding a segment names its row', () => {
        const [first] = segments();
        expect(new CardHold(first, 'k', []).name).toBe(NAME);
    });

    it('the menu looks the row up by its name', async () => {
        const [, second] = segments();
        const getTask = vi.fn(() => undefined);
        const handler = Object.create(MenuHandler.prototype) as MenuHandler;
        Object.assign(handler, { readService: { getTask } });
        await (handler as unknown as { showContextMenu(x: number, y: number, t: Task): Promise<void> }).showContextMenu(0, 0, second);
        expect(getTask).toHaveBeenCalledWith(NAME);
    });

    it('the hub works on the row, found by its name', () => {
        const [first] = segments();
        const row = makeTask({ id: NAME });
        const panel = new TaskHubPanel({} as never, first, { readService: { getTask: (id: string) => (id === NAME ? row : undefined) } } as never);
        expect((panel as unknown as { task: Task }).task).toBe(row);
    });

    it('the hub names the row even when the index no longer holds it', () => {
        const [first] = segments();
        const panel = new TaskHubPanel({} as never, first, { readService: { getTask: () => undefined } } as never);
        expect((panel as unknown as { task: Task }).task.id).toBe(NAME);
    });
});
