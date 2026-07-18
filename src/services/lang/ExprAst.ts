import type { Span } from './Diagnostic';
import type { Value } from './Value';

export const PROP_NAMES = ['start', 'end', 'due', 'content', 'done', 'today', 'file.name'] as const;
export type PropName = typeof PROP_NAMES[number];

export const FN_NAMES = ['format', 'next', 'startOf', 'endOf', 'nextCycle', 'date', 'time'] as const;
export type FnName = typeof FN_NAMES[number];

export type BinaryOp =
    | '+' | '-'
    | '==' | '!=' | '<' | '<=' | '>' | '>='
    | '&&' | '||';

export type Expr =
    | { kind: 'lit'; value: Value; span: Span }
    | { kind: 'prop'; name: PropName; span: Span }
    | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span }
    | { kind: 'unary'; op: '!' | '-'; operand: Expr; span: Span }
    | { kind: 'cond'; cond: Expr; then: Expr; else: Expr; span: Span }
    | { kind: 'call'; fn: FnName; args: Expr[]; span: Span };
