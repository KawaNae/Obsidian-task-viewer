/**
 * Eagerly register every per-view schema into SchemaRegistry.
 *
 * Import this module once at application startup (main.ts), before any
 * persistence boundary calls `codecFor()`. Each side-effect import
 * triggers the schema's top-level `registerSchema()` call.
 *
 * Adding a new view: create `<View>Schema.ts` that calls registerSchema(),
 * then add a side-effect import here.
 */

import './timelineview/TimelineSchema';
import './calendar/CalendarSchema';
import './calendar/MiniCalendarSchema';
import './scheduleview/ScheduleSchema';
import './kanban/KanbanSchema';
