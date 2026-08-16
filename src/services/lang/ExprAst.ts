import type { Span } from './Diagnostic';
import type { Stmt } from './StmtAst';
import type { Value } from './Value';

export const PROP_NAMES = ['start', 'end', 'due', 'content', 'done', 'today', 'dates', 'file.name'] as const;
export type PropName = typeof PROP_NAMES[number];

export const FN_NAMES = [
    'format', 'next', 'startOf', 'endOf', 'nextCycle', 'date', 'time',
    // Written and printed with the namespace. A dot cannot appear in an
    // identifier, so there is no bare spelling to reserve six more names for,
    // and what the printer writes reads back as the same call.
    'Math.floor', 'Math.ceil', 'Math.round', 'Math.abs', 'Math.min', 'Math.max',
] as const;
export type FnName = typeof FN_NAMES[number];

/**
 * Bare words the parser turns into a value before it looks for any binding.
 *
 * `undefined` and `null` are the JS spellings of the missing value, accepted so
 * that what someone writes out of habit works; all three print back as `none`.
 *
 * A table rather than a run of comparisons, because three readers ask about
 * these words — the parser reads them, the reserved-name rule counts them, the
 * highlighter paints them — and a word list copied three times is three lists
 * that drift.
 */
export const LITERAL_WORDS: Readonly<Record<string, Value>> = {
    true: { type: 'bool', value: true },
    false: { type: 'bool', value: false },
    none: { type: 'none' },
    undefined: { type: 'none' },
    null: { type: 'none' },
};

/**
 * Bare idents that read as unit keywords: `startOf(week)`.
 *
 * Carried as strings by the parser, so they are words of the grammar rather
 * than values of the language.
 */
export const UNIT_KEYWORDS = ['week', 'month', 'year'] as const;

/**
 * Words that open a namespace instead of standing for something themselves.
 *
 * `tv.date.format(...)` resolves to the bare `format`, so `tv` appears nowhere
 * else; `Math.floor` keeps its namespace in the name and is therefore also in
 * `FN_NAMES`. Both are listed because both are what the parser branches on.
 */
export const NAMESPACE_WORDS = ['tv', 'Math'] as const;

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
     * is what binds its parameters. Never a value of its own. A block body
     * (`x => { ... return y }`) is read in the statement profile only.
     */
    | { kind: 'arrow'; params: string[]; body: Expr | ArrowBlockBody; span: Span }
    /**
     * `n = n + 1` / `n += 1` — an assignment, and it is an expression: it
     * yields the new value, which is what lets `${n += 1}` splice and update
     * in one place. Only the statement profile reads it; the flow profile
     * refuses it where it is written (a clause runs at schedule time, outside
     * the block's document order).
     */
    | {
        kind: 'assign'; op: '=' | '+=' | '-='; name: string; nameSpan: Span; value: Expr; span: Span;
        /**
         * Written inside its own parentheses. `if (n = 1)` is a mistyped `==`
         * far more often than a deliberate write, so the checker warns about
         * it — and the parentheses are the long-standing way to say the write
         * was meant. Nothing else reads this; it is only ever the difference
         * between a warning and silence.
         */
        parenthesized?: boolean;
    }
    /** A name bound by an enclosing arrow parameter (block profile only). */
    | { kind: 'var'; name: string; span: Span }
    /**
     * `f(1)` — a call of an arrow bound by a local declaration, which is what
     * makes `const f = x => ...` a real answer to "write a function" instead
     * of a form only a list method can use.
     *
     * The callee is a name and only a name. Letting an arbitrary expression
     * stand there would let a function travel as a value — out of a list, out
     * of a record field — and a function cannot be printed, so a cell could
     * never carry one back to the next instance. Keeping the call shape
     * narrow is what keeps that closed.
     */
    | { kind: 'call-local'; name: string; nameSpan: Span; args: Expr[]; span: Span }
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

/**
 * Where a `${` was written, whether or not what follows it parsed.
 *
 * The parts above are what the line means, and an expression that did not
 * parse has no meaning to carry — so it leaves no part. This says something
 * weaker and lexical: an interpolation was opened here. A reader of the
 * source needs that answer for the lines the parts cannot describe, which are
 * exactly the lines being repaired.
 */
export interface InterpolationSeam {
    /**
     * The whole `${...}` where the brace closes, and the `${` alone where it
     * does not: how far a broken one reaches is not decided.
     */
    span: Span;
    closed: boolean;
}

/** An arrow function's `{ ... }` body: statements, ended by `return`. */
export interface ArrowBlockBody {
    kind: 'block-body';
    body: Stmt[];
    span: Span;
}

/** The body shape everything before the js section knew: a single expression. */
export function isExprBody(body: Expr | ArrowBlockBody): body is Expr {
    return body.kind !== 'block-body';
}
