import type { Span } from '../lang/Diagnostic';
import type { Expr } from '../lang/ExprAst';
import type { DurUnit, Value, Weekday } from '../lang/Value';

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
 * One state cell declared on the flow line: `let(n: 3)`.
 *
 * Unlike every other clause this holds a `Value` and not an `Expr`. A cell is
 * printed back on every fire carrying whatever the block last wrote into it,
 * and what a block writes is a value — keeping the node in that currency
 * leaves one road from a value to the line instead of two. It also states the
 * rule in the type: a cell holds what can be printed and read back.
 */
export interface FlowCell {
    name: string;
    value: Value;
    /** The name token — for diagnostics about the name. */
    nameSpan: Span;
    /** The literal — for diagnostics about what it holds. */
    valueSpan: Span;
}

/**
 * What a cell may hold, said about a value.
 *
 * Read twice: once on the written literal, and once on the value the block
 * leaves behind, which is the only reading that can see a list arrive. The
 * checker asks the same question of a type (`isCellType`) while the block is
 * being written; the two say one rule and move together.
 */
export function isCellValue(value: Value): boolean {
    switch (value.type) {
        case 'array': case 'record': case 'none':
            return false;
        default:
            return true;
    }
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
    /**
     * `use("名前")` — the generation block that writes the next instance.
     *
     * The argument stays an expression rather than a bare literal. The flow
     * profile allows expressions (it only forbids assignment), so a computed
     * name works later without widening the grammar; the checker requires the
     * expression to be a string.
     */
    use?: { name: Expr; span: Span };
    /**
     * `let(n: 3, ...)` — the state that travels between generations.
     *
     * Declared here and nowhere else: the contract is visible on the line, so
     * a reader learns what state a chain carries without opening the block.
     * The block reads and writes the names as ordinary mutable variables, and
     * the fire prints what they came to back into this clause.
     */
    cells?: { entries: FlowCell[]; span: Span };
    /**
     * setContent(...) / setStart(...) / setEnd(...) / setDue(...) — field
     * overrides applied to the generated instance AFTER the schedule shift.
     * All RHS evaluate against the same post-shift snapshot (no chaining).
     */
    sets?: Partial<Record<SetField, { expr: Expr; span: Span }>>;
    /** Move the completed task (+children) to the target file. */
    move?: { target: Expr; span: Span };
}
