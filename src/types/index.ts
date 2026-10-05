/**
 * The type barrel.
 *
 * Every consumer imports from `types`, never from a file inside it, so the
 * split below is invisible from the outside and can be rearranged without
 * touching a single import. What each file holds is stated in its own doc.
 *
 * `ViewState` used to live here. It turned out to be Timeline's alone, and a
 * view's state is now its schema's config and transient fields
 * (`TimelineState` in `views/timelineview/TimelineSchema.ts`).
 */
export * from './TaskModel';
export * from './DisplayTask';
export * from './Validation';
export * from './Flow';
export * from './ViewConfig';
export * from './ScopeKeys';
export * from './Settings';
