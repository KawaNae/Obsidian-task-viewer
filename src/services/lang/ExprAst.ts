import type { Span } from './Diagnostic';
import type { Value } from './Value';

export const PROP_NAMES = ['start', 'end', 'due', 'content', 'done', 'today', 'file.name'] as const;
export type PropName = typeof PROP_NAMES[number];

export const FN_NAMES = [
    'format', 'next', 'startOf', 'endOf', 'nextCycle', 'date', 'time',
    // Written and printed with the namespace. A dot cannot appear in an
    // identifier, so there is no bare spelling to reserve six more names for,
    // and what the printer writes reads back as the same call.
    'Math.floor', 'Math.ceil', 'Math.round', 'Math.abs', 'Math.min', 'Math.max',
] as const;
export type FnName = typeof FN_NAMES[number];

export type BinaryOp =
    | '+' | '-'
    | '*' | '/' | '%'
    | '==' | '!=' | '<' | '<=' | '>' | '>='
    | '&&' | '||' | '??';

export type Expr =
    | { kind: 'lit'; value: Value; span: Span }
    | { kind: 'prop'; name: PropName; span: Span }
    | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; span: Span }
    | { kind: 'unary'; op: '!' | '-'; operand: Expr; span: Span }
    | { kind: 'cond'; cond: Expr; then: Expr; else: Expr; span: Span }
    | { kind: 'call'; fn: FnName; args: Expr[]; span: Span }
    /** `start.weekday` — a property read on a value. */
    | { kind: 'member'; obj: Expr; name: string; optional: boolean; span: Span }
    /** `start.format("MM/DD")` — a method call on a value. */
    | { kind: 'method'; obj: Expr; name: string; args: Expr[]; optional: boolean; span: Span }
    /** `["a", "b"]` — a list literal. */
    | { kind: 'array'; items: Expr[]; span: Span }
    /** `xs[0]` — an element read. */
    | { kind: 'index'; obj: Expr; index: Expr; optional: boolean; span: Span }
    /**
     * `x => x.length` — only meaningful as an argument to a list method, which
     * is what binds its parameters. Never a value of its own.
     */
    | { kind: 'arrow'; params: string[]; body: Expr; span: Span }
    /** A name bound by an enclosing arrow parameter (block profile only). */
    | { kind: 'var'; name: string; span: Span }
    /** `{ mon: "燃えるゴミ" }` — a record literal. Order is kept as written. */
    | { kind: 'record'; entries: { key: string; value: Expr }[]; span: Span }
    /** `...xs` — only meaningful inside a list literal, which spreads it. */
    | { kind: 'spread'; arg: Expr; span: Span }
    /** `` `第${n}回` `` — literal text with expressions spliced in. */
    | { kind: 'template'; parts: InterpolationPart[]; span: Span };

/** One piece of a template literal, or of a generation block's body line. */
export type InterpolationPart =
    | { kind: 'text'; text: string }
    | { kind: 'expr'; expr: Expr; span: Span };
