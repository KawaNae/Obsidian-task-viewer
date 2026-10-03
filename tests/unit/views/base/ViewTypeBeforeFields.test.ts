import { describe, it, expect } from 'vitest';
import type { View } from 'obsidian';
import { VIEW_DESCRIPTORS, type ViewType } from '../../../../src/views/ViewDescriptors';
import { TimelineView } from '../../../../src/views/timelineview/TimelineView';
import { ScheduleView } from '../../../../src/views/scheduleview/ScheduleView';
import { TimerView } from '../../../../src/views/TimerView';
import { CalendarView } from '../../../../src/views/calendar/CalendarView';
import { MiniCalendarView } from '../../../../src/views/calendar/MiniCalendarView';
import { KanbanView } from '../../../../src/views/kanban/KanbanView';

/**
 * Obsidian's View constructor reads `getViewType()` (for the leaf's
 * `data-type`) before a subclass has any field: a view whose type is read
 * from a field fails to open at all. Each view answers it with no instance.
 */
const VIEWS: Record<ViewType, { prototype: View }> = {
    'timeline-view': TimelineView,
    'schedule-view': ScheduleView,
    'timer-view': TimerView,
    'calendar-view': CalendarView,
    'mini-calendar-view': MiniCalendarView,
    'kanban-view': KanbanView,
};

describe('a view type read before the view has its fields', () => {
    for (const [type, View] of Object.entries(VIEWS)) {
        it(`${type} answers its descriptor's type`, () => {
            expect(View.prototype.getViewType.call({})).toBe(VIEW_DESCRIPTORS[type as ViewType].type);
        });
    }
});
