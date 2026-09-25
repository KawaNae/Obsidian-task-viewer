import { describe, it, expect, vi } from 'vitest';
import { computeContentSignature, TaskCardRenderer } from '../../../src/views/taskcard/TaskCardRenderer';
import { HandleManager } from '../../../src/views/sharedUI/handles/HandleManager';
import { refreshTimerTask } from '../../../src/timer/TimerTaskSync';
import { TaskIdGenerator } from '../../../src/services/display/TaskIdGenerator';
import { makeTask } from '../helpers/makeTask';
import type { DisplayTask, Task, TaskViewerSettings } from '../../../src/types';

/**
 * What holds a task's name across a render: a card, the selection, an
 * expanded card, a timer.
 *
 * A name lasts one reading of its file. After a write of ours, `getTask`
 * follows a name from before it to the row's name now, and the copy it
 * answers carries the new name. Each holder takes the new name from that
 * copy, the next time it asks — it does not follow names itself.
 */

const OLD = 'tv-inline:a.md:n:1:3:20:0000000000000001';
const NOW = 'tv-inline:a.md:n:2:4:28:0000000000000002';

/** An index that follows OLD to NOW, as `TaskIndex.getTask` does across our write. */
function following(task: Task) {
    return { getTask: vi.fn((id: string) => (id === OLD || id === NOW ? task : undefined)) };
}

describe('a card kept across a reading', () => {
    it('is drawn again when only its name changed, so its handlers do not hold the old one', () => {
        const settings = {
            startHour: 0, childCollapseThreshold: 5, enableCardFileLink: true,
            statusDefinitions: [{ char: ' ', label: 'Todo', isComplete: false }],
        } as unknown as TaskViewerSettings;
        const task = (id: string) => ({
            ...makeTask({ id, file: 'a.md', content: 'A' }),
            effectiveStartDate: '2026-09-25', childEntries: [],
        }) as unknown as DisplayTask;
        const sig = (id: string) => computeContentSignature(
            task(id), settings, { cardInstanceId: 'c' } as never, '', 'none', false, false, { getTask: () => undefined } as never);

        expect(sig(OLD)).not.toBe(sig(NOW));
    });
});

describe('the selection', () => {
    /** A view with no cards drawn: the selection is asked, nothing is decorated. */
    const noCards = () => ({ querySelector: () => null, querySelectorAll: () => [] }) as unknown as HTMLElement;

    it('takes the name the index answers for the one it holds', () => {
        const index = following(makeTask({ id: NOW, file: 'a.md' }));
        const handles = new HandleManager(noCards(), { getTask: index.getTask, getStartHour: () => 0 });
        handles.selectTask(OLD);

        expect(handles.getSelectedTaskId()).toBe(NOW);
    });

    it('keeps a name the index answers nothing for', () => {
        const handles = new HandleManager(noCards(), { getTask: () => undefined, getStartHour: () => 0 });
        handles.selectTask(OLD);

        expect(handles.getSelectedTaskId()).toBe(OLD);
    });
});

describe('an expanded card', () => {
    /** The renderer's expansion, over an index that follows OLD to NOW. */
    function expansion(keys: string[]) {
        const renderer = Object.create(TaskCardRenderer.prototype) as TaskCardRenderer;
        const index = following(makeTask({ id: NOW, file: 'a.md' }));
        const state = renderer as unknown as {
            expandedTaskIds: Set<string>;
            childItemBuilder: { getReadService(): unknown };
            isExpanded(cardInstanceId: string, taskId: string): boolean;
        };
        state.expandedTaskIds = new Set(keys);
        state.childItemBuilder = { getReadService: () => index };
        return state;
    }

    it('stays expanded under the name the index answers, and the key is taken over', () => {
        const state = expansion([`kanban::cell-1::${OLD}`]);

        expect(state.isExpanded(`kanban::cell-1::${NOW}`, NOW)).toBe(true);
        expect([...state.expandedTaskIds]).toEqual([`kanban::cell-1::${NOW}`]);
    });

    it('follows a segment of a split task by its base', () => {
        const old = TaskIdGenerator.makeSegmentId(OLD, '2026-09-25');
        const now = TaskIdGenerator.makeSegmentId(NOW, '2026-09-25');
        const state = expansion([`timeline::allday::${old}`]);

        expect(state.isExpanded(`timeline::allday::${now}`, now)).toBe(true);
    });

    it('is not taken over by the same task in another scope', () => {
        const state = expansion([`kanban::cell-1::${OLD}`]);

        expect(state.isExpanded(`kanban::cell-2::${NOW}`, NOW)).toBe(false);
        expect([...state.expandedTaskIds]).toEqual([`kanban::cell-1::${OLD}`]);
    });
});

describe('a timer', () => {
    it('takes the name the index answers for the one it holds, and says it was rewritten', () => {
        const task = makeTask({ id: NOW, file: 'a.md' });
        const timer = { taskId: OLD, taskFile: 'a.md', taskOriginalText: '- [ ] A', timerTargetId: undefined };
        const resolver = { resolveTvInline: vi.fn() };

        expect(refreshTimerTask(timer as never, following(task), resolver)).toEqual({ task, rewritten: true });
        expect(timer.taskId).toBe(NOW);
        expect(resolver.resolveTvInline).not.toHaveBeenCalled();
    });
});
