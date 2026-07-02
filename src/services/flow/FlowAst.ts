import { Span } from '../lang/Diagnostic';
import { Expr } from '../lang/ExprAst';
import { DurUnit, Weekday } from '../lang/Value';

/** Calendar-grid recurrence rules (`every ...`). */
export type EveryRule =
    | { type: 'weekdays'; days: Weekday[] }                              // every mon / every tue,fri
    | { type: 'interval'; amount: number; unit: DurUnit }                // every 2w
    | { type: 'monthday'; intervalMonths: number; day: number | 'last' } // every mo@25 / every 2mo@last

export type ScheduleNode =
    | { kind: 'every'; rule: EveryRule; span: Span }
    | { kind: 'afterDone'; amount: number; unit: DurUnit; span: Span }   // +3d (completion-anchored)
    | { kind: 'at'; expr: Expr; span: Span };                            // at(<expr>) escape hatch

export type SetField = 'content' | 'start' | 'end' | 'due';

export interface SetAssignment {
    field: SetField;
    expr: Expr;
    span: Span;
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
    /** Generate only while next anchor date <= this date (inclusive). */
    until?: { date: string; span: Span };
    nochildren?: { span: Span };
    set?: { assignments: SetAssignment[]; span: Span };
    /** Move the completed task (+children) to the target file. */
    move?: { target: Expr; span: Span };
}
