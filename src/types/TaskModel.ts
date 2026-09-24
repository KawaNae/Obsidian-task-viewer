/**
 * The task as the parsers and the persistence layer know it.
 *
 * Views do not read this shape directly — `toDisplayTask` turns it into a
 * `DisplayTask` first, which is the consumer-facing type. What lives here is
 * the raw record: what a line or a note's frontmatter literally said.
 */
import type { ValidationRule } from './Validation';
import type { TaskFlow } from './Flow';

export interface StatusDefinition {
    char: string;
    label: string;
    isComplete: boolean;
}

export const FIXED_STATUS_CHARS = [' ', 'x'] as const;

export const DEFAULT_STATUS_DEFINITIONS: StatusDefinition[] = [
    { char: ' ', label: 'Todo',        isComplete: false },
    { char: '/', label: 'Doing',       isComplete: false },
    { char: 'x', label: 'Done',        isComplete: true },
    { char: '-', label: 'Cancelled',   isComplete: true },
    { char: '!', label: 'Important',   isComplete: true },
    { char: '?', label: 'Question',    isComplete: false },
    { char: '>', label: 'Deferred',    isComplete: false },
];

/**
 * Returns true when statusChar is considered completed by settings.
 *
 * A blank status is fixed to incomplete, regardless of what `defs` says —
 * not read from settings at all. This is the single choke point every
 * completion check (flow firing, card display, child-completion counts)
 * calls through, so fixing it here closes both the settings-screen toggle
 * and a pre-existing `data.json` value at once. The reason it matters: a
 * flow's next instance is always written as `[ ]` (`FlowEffects.ts`), and
 * if blank could read as complete, that instance would complete itself the
 * moment it lands. The only thing standing between that and a fire loop is
 * that the write which lands it never sets the flag firing reads (a flow's
 * own writes are not marked as a local edit), so this is a second, cheaper
 * line of defense against the same runaway rather than the only one.
 */
export function isCompleteStatusChar(statusChar: string, defs: StatusDefinition[]): boolean {
    if (statusChar === ' ') return false;
    return defs.some(d => d.char === statusChar && d.isComplete);
}

export type NoteType = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type PropertyType = 'string' | 'number' | 'boolean' | 'array';

export interface PropertyValue {
    value: string;
    type: PropertyType;
}

export interface ChildLine {
    text: string;
    /**
     * Absolute 0-indexed file line this child line lives on
     * (same convention as `Task.line`; `-1` = no valid body line).
     */
    bodyLine: number;
    indent: string;
    /** `- [[target]]` link lines: the target, kept for masking. */
    wikilinkTarget: string | null;
    propertyKey: string | null;
    propertyValue: string | null;
}

/**
 * Ordered partition of a task's body children. Parser/index ensures each
 * absolute file line is owned by exactly one ChildEntry across all tasks.
 *
 * - `task`: line is occupied by an independent child task (resolved via TaskIndex)
 * - `line`: raw property / text / link line under this task — never a checkbox,
 *   which is always a task of its own (unrelated to the legacy `'plain'`
 *   parserId migration alias in TimerPersistence)
 *
 * Render layer walks `task.children` directly without re-classifying.
 * Write layer uses `bodyLine` as the absolute file line for surgical edits.
 */
export type ChildEntry =
    | { kind: 'task'; taskId: string; bodyLine: number }
    | { kind: 'line'; line: ChildLine; bodyLine: number };

/**
 * Identifier of the parser that produced a task.
 *
 * Every task is a line in a note, read by one of these three parsers.
 * Legacy persisted values (`'at-notation'`, `'plain'`) are migrated at load
 * time by `TimerPersistence.normalizeParserId`; `'tv-file'` and `'frontmatter'`
 * named the file task, which no longer exists, and fall back to `'tv-inline'`
 * there. None of them appears on a live Task.
 */
export type ParserId = 'tv-inline' | 'tasks-plugin' | 'day-planner';

export interface Task {
    // Identity and source location.
    id: string;
    file: string;
    /** 0-indexed line number in the source file. Every task has one. */
    line: number;

    // Core task text/status.
    content: string;
    statusChar: string;

    // Tree relationship.
    parentId?: string;
    indent: number;
    /**
     * @internal Parser-emitted ids of independent child tasks. Substrate for
     * `buildChildEntries`; render/write consume via `DisplayTask.childEntries`.
     */
    childIds: string[];
    /**
     * @internal Parser-emitted raw body lines (each carries its absolute
     * file line in `ChildLine.bodyLine`). Substrate for `buildChildEntries`;
     * render/write consume via `DisplayTask.childEntries`.
     */
    childLines: ChildLine[];

    // Date/time fields.
    startDate?: string;
    startTime?: string;
    /**
     * Raw end date as written in @notation / frontmatter. **Dual semantic**:
     * - When `endTime` is present → `endDate` is **inclusive** (the calendar
     *   date on which `endTime` occurs).
     * - When `endTime` is absent (pure all-day) → `endDate` is **exclusive**
     *   (one day past the last day the task covers).
     *
     * This duality is preserved at the raw layer for parser/writer round-trip
     * with the external @notation. Display code should not read `endDate`
     * directly; use `DisplayTask.effectiveEndDate` (always inclusive visual
     * end) instead. Drag write-back must funnel updates through
     * `materializeRawDates()` which collapses the duality based on
     * `baseTask.endTime`.
     */
    endDate?: string;
    endTime?: string;
    due?: string;

    /**
     * Values inherited from the File → Section cascade rather than from the
     * task's own lines / frontmatter.  Set by TreeTaskExtractor; never
     * serialized — format() and all writers read only raw fields for
     * round-trip fidelity.
     *
     * Dates are merged into `DisplayTask.effective*` by DisplayTaskConverter
     * (needs display context: startHour). Properties/tags/style close over
     * the Task alone, so they merge via the `getEffective*` derived helpers
     * (`services/data/EffectiveProperties.ts`).
     */
    cascadeContext?: {
        startDate?: string;
        startTime?: string;
        endDate?: string;
        endTime?: string;
        due?: string;
        color?: string;
        linestyle?: string;
        mask?: string;
        tags?: string[];
        properties?: Record<string, PropertyValue>;
    };

    // Original parsed text and stable IDs.
    originalText: string;
    /**
     * The row's line and every line of its subtree, verbatim, as the parse
     * read them (`OutlineReading.subtreeEnd`). What a delete or a move takes away is
     * planned from this, and the write checks the file still reads so (see
     * `RowBasis.subtree`). Absent on a task no file was parsed for.
     */
    subtreeLines?: readonly string[];
    blockId?: string;
    timerTargetId?: string;

    /**
     * Raw tags: the task's own declaration only (content `#tags` + own
     * child-line / own-frontmatter `tags`). Section-inherited tags live in
     * `cascadeContext.tags`; consumers read the merged view via
     * `getEffectiveTags()`.
     */
    tags: string[];

    /**
     * Flow command (`==> ...`), parsed by the flow language core.
     * format() always re-emits `raw` verbatim; canonical re-serialization
     * happens only when a fire generates the next instance.
     */
    flow?: TaskFlow;

    // Parse-time validation result (error or warning).
    validation?: {
        severity: 'error' | 'warning';
        rule: ValidationRule;
        message: string;
        hint: string;
    };

    /**
     * Parser identifier that produced this task. See {@link ParserId}.
     * Used for parser-specific writeback behavior.
     */
    parserId: ParserId;

    /**
     * Raw styling: the task's own child lines / own frontmatter only.
     * Section-inherited style lives in `cascadeContext`; consumers read the
     * merged view via `getEffectiveColor()` / `getEffectiveLinestyle()`.
     */
    color?: string;
    linestyle?: string;

    /** Raw mask (own declaration only; merged view via `getEffectiveMask()`). */
    mask?: string;

    /** True when parsed by a read-only parser (no writeback support). */
    isReadOnly?: boolean;

    /**
     * Raw custom properties: the task's own child lines / own frontmatter
     * only. Section-inherited properties live in `cascadeContext.properties`;
     * consumers read the merged view via `getEffectiveProperties()`.
     */
    properties: Record<string, PropertyValue>;
}

/** TaskViewer inline-form task (writable; primary write target). */
export function isTvInline(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'tv-inline';
}

/** Day Planner inline-form task (read-only). */
export function isDpInline(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'day-planner';
}

/** Tasks Plugin inline-form task (read-only). */
export function isTpInline(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'tasks-plugin';
}

/** True when the task has any date/time scheduling field. */
export function hasScheduling(
    task: Pick<Task, 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'due'>
): boolean {
    return !!(task.startDate || task.startTime || task.endDate || task.endTime || task.due);
}
/**
 * Options for duplicating tasks.
 * dayOffset: number of days to shift dates (default: 0 = in-place copy)
 * count: number of copies to create (default: 1)
 */
export interface DuplicateOptions {
    dayOffset?: number;
    count?: number;
}
