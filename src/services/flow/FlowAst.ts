import type { Span } from '../lang/Diagnostic';
import type { Expr } from '../lang/ExprAst';
import type { DurUnit, Weekday } from '../lang/Value';

/** Calendar-grid recurrence rules (`every ...`). */
export type EveryRule =
    | { type: 'weekdays'; days: Weekday[] }                              // every mon / every tue,fri
    | { type: 'interval'; amount: number; unit: DurUnit }                // every 2w
    | { type: 'monthday'; intervalMonths: number; day: number | 'last' } // every mo@25 / every 2mo@last

export type ScheduleNode =
    | { kind: 'every'; rule: EveryRule; span: Span }
    /**
     * `+3d` — plain offset from the task's own anchor date (the date you
     * see in the @block): catch-up semantics, late completions produce
     * past-dated instances. ≒ at(start + 3d) with the anchor fallback
     * chain (start → end → due; dateless tasks fall back to today).
     */
    | { kind: 'plus'; amount: number; unit: DurUnit; span: Span }
    | { kind: 'at'; expr: Expr; span: Span };
    // Completion-relative offsets are expressions: `at(today + 3d)`
    // (date-granular) / `at(done + 2h)` (time-granular).

export type SetField = 'content' | 'start' | 'startTime' | 'end' | 'endTime' | 'due' | 'dueTime';

export const SET_FIELD_ORDER: readonly SetField[] = ['content', 'start', 'startTime', 'end', 'endTime', 'due', 'dueTime'];

/** Clause head for a setter field: 'content' → 'setContent'. */
export function setHeadName(field: SetField): string {
    return `set${field[0].toUpperCase()}${field.slice(1)}`;
}

/**
 * Parsed flow command. Nodes are order-free in source (each is
 * self-identifying by its head token) and at most one of each kind exists;
 * the serializer emits them in canonical order.
 */
export interface FlowProgram {
    schedule?: ScheduleNode;
    /** Telomere: remaining number of generations (`x14`). */
    lifetime?: { count: number; span: Span };
    /** Generate only while next anchor date <= the evaluated date (inclusive). */
    until?: { expr: Expr; span: Span };
    nochildren?: { span: Span };
    /**
     * setContent(...) / setStart(...) / setEnd(...) / setDue(...) — field
     * overrides applied to the generated instance AFTER the schedule shift.
     * All RHS evaluate against the same post-shift snapshot (no chaining).
     */
    sets?: Partial<Record<SetField, { expr: Expr; span: Span }>>;
    /** Move the completed task (+children) to the target file. */
    move?: { target: Expr; span: Span };
}
