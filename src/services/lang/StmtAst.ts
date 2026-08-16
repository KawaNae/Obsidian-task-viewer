import type { Span } from './Diagnostic';
import type { Expr } from './ExprAst';

/**
 * Statements of the js section. The section is verbatim source — nothing
 * here is ever printed back — so the tree keeps only what the checker and
 * the tree-walking evaluator need, not the spelling.
 */
export type Stmt =
    /** `let x = 1` / `const [a, b] = xs`. A bare `let x` binds none, as JS binds undefined. */
    | { kind: 'decl'; mutable: boolean; target: BindTarget; init: Expr | null; span: Span }
    /** An expression in statement position — an assignment, a call. */
    | { kind: 'expr'; expr: Expr; span: Span }
    /** `if` / `else if` / `else`. An `else if` chain nests in `alt`. */
    | { kind: 'if'; cond: Expr; then: Stmt[]; alt: Stmt[] | null; span: Span }
    | { kind: 'while'; cond: Expr; body: Stmt[]; span: Span }
    /** `for (const x of xs)`. */
    | { kind: 'for-of'; mutable: boolean; target: BindTarget; iterable: Expr; body: Stmt[]; span: Span }
    /** `for (let i = 0; i < n; i += 1)`. Each slot may be empty, as in JS. */
    | { kind: 'for'; init: Stmt | null; cond: Expr | null; update: Expr | null; body: Stmt[]; span: Span }
    | { kind: 'break'; span: Span }
    | { kind: 'continue'; span: Span }
    /** `return x` — only inside an arrow function's block body. */
    | { kind: 'return'; value: Expr | null; span: Span }
    /** A bare `{ ... }` in statement position: a scope, as in JS. */
    | { kind: 'block'; body: Stmt[]; span: Span };

/**
 * What a declaration binds. The basic destructuring forms only (design:
 * "配列とオブジェクトの基本形") — no defaults, no nesting, no rest.
 */
export type BindTarget =
    | { kind: 'name'; name: string; span: Span }
    /** `[a, , b]` — a hole stays null. */
    | { kind: 'array-pattern'; names: ({ name: string; span: Span } | null)[]; span: Span }
    /** `{a, b: c}` — key is the field read, name is what it binds to. */
    | { kind: 'record-pattern'; fields: { key: string; name: string; span: Span }[]; span: Span };

/** A js section, parsed. One per block, evaluated before the body lines. */
export interface Program {
    body: Stmt[];
}
