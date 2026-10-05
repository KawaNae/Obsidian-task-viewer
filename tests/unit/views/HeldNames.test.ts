import { describe, it, expect, vi } from 'vitest';
import { TaskCardRenderer } from '../../../src/views/taskcard/TaskCardRenderer';
import { HandleManager } from '../../../src/views/sharedUI/handles/HandleManager';
import { makeSegmentId } from '../../../src/services/display/SegmentIds';
import { ExpandedCards, type CardKey } from '../../../src/views/taskcard/CardKey';
import { makeTask } from '../helpers/makeTask';
import type { Task } from '../../../src/types';

/**
 * What holds a task's name across a render: the selection, an expanded
 * card. A card holds none (`CardHold.test.ts`), and neither does a timer: it
 * finds its row by the row's anchor (`TimerIdentity.test.ts`).
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
    /** The opened cards `keys`, followed through an index that follows OLD to NOW. */
    function expansion(keys: CardKey[]) {
        const expanded = new ExpandedCards();
        for (const key of keys) expanded.set(key, true);
        const index = following(makeTask({ id: NOW, file: 'a.md' }));
        const isOpen = (key: CardKey) => expanded.isOpen(key, row => index.getTask(row)?.id);
        return { expanded, isOpen };
    }

    it('stays expanded under the name the index answers, and the key is taken over', () => {
        const { expanded, isOpen } = expansion([{ scope: 'cell-1', name: OLD }]);

        expect(isOpen({ scope: 'cell-1', name: NOW })).toBe(true);
        expect(expanded.keys()).toEqual([{ scope: 'cell-1', name: NOW }]);
    });

    it('follows a segment of a split task by its base', () => {
        const old = makeSegmentId(OLD, '2026-09-25');
        const now = makeSegmentId(NOW, '2026-09-25');
        const { isOpen } = expansion([{ scope: 'allday', name: old }]);

        expect(isOpen({ scope: 'allday', name: now })).toBe(true);
    });

    it('is not taken over by another segment of the same task', () => {
        const { isOpen } = expansion([{ scope: 'allday', name: makeSegmentId(OLD, '2026-09-25') }]);

        expect(isOpen({ scope: 'allday', name: makeSegmentId(NOW, '2026-09-26') })).toBe(false);
    });

    it('is not taken over by the same task in another scope', () => {
        const { expanded, isOpen } = expansion([{ scope: 'cell-1', name: OLD }]);

        expect(isOpen({ scope: 'cell-2', name: NOW })).toBe(false);
        expect(expanded.keys()).toEqual([{ scope: 'cell-1', name: OLD }]);
    });

    it('is forgotten when its row\'s name ends, its segments too, in every place', () => {
        let deleted: ((taskId: string) => void) | null = null;
        const renderer = new TaskCardRenderer({
            app: {} as never,
            readService: {} as never,
            index: { getTask: () => undefined, onTaskDeleted: (fn: (taskId: string) => void) => { deleted = fn; return () => {}; } } as never,
            operations: {} as never,
            menuPresenter: {} as never,
            linkRuntime: { hoverSource: 'test', getHoverParent: () => ({}) } as never,
            getSettings: () => ({}) as never,
            getMaskMode: () => false,
            actions: {} as never,
        });
        const expanded = (renderer as unknown as { expanded: ExpandedCards }).expanded;
        const other = { scope: 'lane', name: NOW };
        expanded.set({ scope: 'allday', name: makeSegmentId(OLD, '2026-09-25') }, true);
        expanded.set({ scope: 'lane-multi', name: makeSegmentId(OLD, '2026-09-26') }, true);
        expanded.set({ scope: 'cell-1', name: OLD }, true);
        expanded.set(other, true);

        deleted!(OLD);

        expect(expanded.keys()).toEqual([other]);
    });
});
