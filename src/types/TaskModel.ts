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
 */
export function isCompleteStatusChar(statusChar: string, defs: StatusDefinition[]): boolean {
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
    checkboxChar: string | null;
    wikilinkTarget: string | null;
    propertyKey: string | null;
    propertyValue: string | null;
}

/**
 * Ordered partition of a task's body children. Parser/index ensures each
 * absolute file line is owned by exactly one ChildEntry across all tasks.
 *
 * - `task`: line is occupied by an independent child task (resolved via TaskIndex)
 * - `wikilink`: line references another file's tv-file task (unresolved)
 * - `line`: raw checkbox / property / text line under this task (unrelated to
 *   the legacy `'plain'` parserId migration alias in TimerPersistence)
 *
 * Render layer walks `task.children` directly without re-classifying.
 * Write layer uses `bodyLine` as the absolute file line for surgical edits.
 */
export type ChildEntry =
    | { kind: 'task'; taskId: string; bodyLine: number }
    | { kind: 'wikilink'; target: string; bodyLine: number; line: ChildLine }
    | { kind: 'line'; line: ChildLine; bodyLine: number };

/**
 * Identifier of the parser that produced a task.
 *
 * Production parsers emit one of these four values. Legacy persisted values
 * (`'at-notation'`, `'frontmatter'`, `'plain'`) are migrated at load time
 * by `TimerPersistence.normalizeParserId`; they never appear on a live Task.
 */
export type ParserId = 'tv-inline' | 'tv-file' | 'tasks-plugin' | 'day-planner';

export interface Task {
    // Identity and source location.
    id: string;
    file: string;
    /**
     * 0-indexed line number in the source file.
     * `-1` is a generic sentinel meaning "no body line" (e.g., frontmatter root tasks).
     * Use `hasBodyLine(task)` to test validity. `-1` is NOT a frontmatter discriminator
     * — use `isTvFile(task)` for type identification.
     */
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

/** TaskViewer file-form (frontmatter) task. */
export function isTvFile(task: Pick<Task, 'parserId'>): boolean {
    return task.parserId === 'tv-file';
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

/**
 * task.line が body 行アクセスに使える有効値かを判定する。
 * `false` の場合: tv-file task (line === -1) など、ファイル本体に
 * 紐付く行を持たないタスク。
 *
 * 注意: 種別判定（file-form かどうか）には使わないこと。
 * `-1` は「body 行なし」の汎用 sentinel であり、形式 discriminator
 * ではない。種別判定は `isTvFile()` を使用する。
 */
export function hasBodyLine(task: Pick<Task, 'line'>): boolean {
    return task.line >= 0;
}

/** True when the task has any date/time scheduling field. */
export function hasScheduling(
    task: Pick<Task, 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'due'>
): boolean {
    return !!(task.startDate || task.startTime || task.endDate || task.endTime || task.due);
}
/**
 * Derived: a tv-file task with no scheduling. Groups inline tasks from the
 * same file without carrying dates itself. Replaces the former Task.isContainer
 * flag.
 */
export function isTvFileUnscheduled(
    task: Pick<Task, 'parserId' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'due'>
): boolean {
    return isTvFile(task) && !hasScheduling(task);
}

/**
 * Wikilink reference extracted from frontmatter task body.
 * Stored separately from Task and consumed by WikiLinkResolver.
 */
export interface WikilinkRef {
    target: string;
    bodyLine: number;
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
