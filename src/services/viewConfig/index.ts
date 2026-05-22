/**
 * View configuration subsystem entry point.
 *
 * Importing this module triggers registration of every per-view schema
 * (side-effect imports). After this import resolves, `codecFor(viewType)`
 * returns the corresponding codec for any registered view.
 *
 * Adding a new view: create `<View>Schema.ts` that calls registerSchema(),
 * then add a side-effect import here.
 */

export type { ViewSchema, ConfigField, TransientField } from './ViewConfigSchema';
export { ViewConfigCodec } from './ViewConfigCodec';
export { F, T } from './FieldCodecs';
export {
    registerSchema,
    codecFor,
    schemaFor,
    resolveViewTypeFromShortName,
    shortNameFor,
    registeredViewTypes,
} from './SchemaRegistry';

// ── Per-view schemas (side-effect imports register into SchemaRegistry) ──
// Added incrementally per the refactor phases. Each import must execute
// before any of the 5 persistence boundaries first looks up its codec.
import '../../views/timelineview/TimelineSchema';
import '../../views/calendar/CalendarSchema';
import '../../views/calendar/MiniCalendarSchema';
import '../../views/scheduleview/ScheduleSchema';
import '../../views/kanban/KanbanSchema';
