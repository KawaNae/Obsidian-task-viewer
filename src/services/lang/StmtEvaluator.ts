import type { Span } from './Diagnostic';
import type { ArrowBlockBody, Expr } from './ExprAst';
import { type EvalContext, EvalError, evalExpr } from './ExprEvaluator';
import type { BindTarget, Program, Stmt } from './StmtAst';
import type { Value } from './Value';

/**
 * A function bound by a declaration, with the scope it was written in.
 *
 * Not a `Value`: a function has no place in the value language, which is what
 * keeps one out of a list, a record field, and later a cell — all three have
 * to be printable, and a function is not. It lives in its own table on the
 * scope, reachable only by the call form that names it.
 */
export interface FnDef {
    params: string[];
    body: Expr | ArrowBlockBody;
    scope: Scope;
}

/**
 * One lexical scope of the js section.
 *
 * Frames are chained rather than flattened because an assignment has to reach
 * the frame that declared the name: a copy would take the write and lose it
 * when the block ends. Reads walk the same chain and end at the arrow
 * parameters the enclosing expression bound, which is where a block nested in
 * a list method finds its element.
 */
export class Scope {
    private readonly values = new Map<string, Value>();
    private readonly consts = new Set<string>();
    private readonly fns = new Map<string, FnDef>();

    constructor(
        private readonly parent: Scope | null = null,
        /** Arrow parameters from the expression around this section, if any. */
        private readonly outer: ReadonlyMap<string, Value> | undefined = undefined
    ) { }

    child(): Scope {
        return new Scope(this, this.outer);
    }

    lookup(name: string): Value | undefined {
        for (let s: Scope | null = this; s !== null; s = s.parent) {
            const v = s.values.get(name);
            if (v !== undefined) return v;
            // A name the chain does not hold may still be a function, and
            // reading one as a value is a mistake the checker already named.
            if (s.fns.has(name)) return undefined;
        }
        return this.outer?.get(name);
    }

    lookupFn(name: string): FnDef | undefined {
        for (let s: Scope | null = this; s !== null; s = s.parent) {
            const f = s.fns.get(name);
            if (f !== undefined) return f;
            if (s.values.has(name)) return undefined;
        }
        return undefined;
    }

    declare(name: string, value: Value, mutable: boolean): void {
        this.values.set(name, value);
        this.fns.delete(name);
        if (mutable) this.consts.delete(name); else this.consts.add(name);
    }

    declareFn(name: string, def: FnDef): void {
        this.fns.set(name, def);
        this.values.delete(name);
    }

    /** Write to the frame that declared the name. */
    assign(name: string, value: Value, span: Span): void {
        for (let s: Scope | null = this; s !== null; s = s.parent) {
            if (!s.values.has(name)) {
                if (s.fns.has(name)) break;
                continue;
            }
            if (s.consts.has(name)) {
                throw new EvalError(`'${name}' is a const and cannot be written to`, span);
            }
            s.values.set(name, value);
            return;
        }
        // The checker refuses this while the block is being written; reaching
        // it means the section ran without one, so it fails rather than
        // inventing a binding the way JS's implicit globals would.
        throw new EvalError(`'${name}' was never declared`, span);
    }
}

/** Thrown by `break` / `continue` / `return`, caught by whatever encloses them. */
class BreakSignal { }
class ContinueSignal { }
class ReturnSignal {
    constructor(readonly value: Value) { }
}

/**
 * What one section may spend before it is stopped.
 *
 * Lives here rather than at the caller so that every entry point is bounded
 * by the same number. A reading-view preview or a second evaluator added
 * later inherits the ceiling instead of having to remember it.
 */
export const SECTION_FUEL = 100_000;

/**
 * Run a js section and hand back the scope it leaves.
 *
 * The block's body lines read from that scope, which is what makes document
 * order the whole rule: the section runs first because it is written first.
 *
 * A budget is made here when the caller brought none. Statements can loop and
 * call, so "unmetered" is not a state a section may run in — the flow clause
 * that has no budget is one expression and cannot do either.
 */
export function execProgram(program: Program, ctx: EvalContext): Scope {
    const metered: EvalContext = ctx.fuel ? ctx : { ...ctx, fuel: { left: SECTION_FUEL, depth: 0 } };
    const scope = new Scope(null, metered.vars);
    execBody(program.body, { ...metered, scope });
    return scope;
}

/**
 * Call a function bound in the section. The frame's parent is the scope the
 * function was written in, not the one calling it — a closure, as in JS.
 */
export function callFunction(def: FnDef, args: Value[], ctx: EvalContext, span: Span): Value {
    burn(ctx, span);
    const fuel = ctx.fuel;
    // Fuel alone does not catch a function that calls itself: the host's own
    // call stack runs out first, and a RangeError is not a failure this
    // engine can report as "did not fire". A ceiling on the nesting turns it
    // back into one, far below where the host would give up.
    if (fuel) {
        if (fuel.depth >= MAX_CALL_DEPTH) {
            throw new EvalError(
                `This went ${MAX_CALL_DEPTH} calls deep — a function here is calling itself with no way out`,
                span);
        }
        fuel.depth++;
    }
    try {
        const frame = def.scope.child();
        def.params.forEach((p, i) => frame.declare(p, args[i] ?? { type: 'none' }, true));
        const inner = { ...ctx, scope: frame };
        if (def.body.kind !== 'block-body') return evalExpr(def.body, inner);
        try {
            execBody(def.body.body, inner);
        } catch (e) {
            if (e instanceof ReturnSignal) return e.value;
            throw e;
        }
        // A body that falls off the end answers with the missing value, as in JS.
        return { type: 'none' };
    } finally {
        if (fuel) fuel.depth--;
    }
}

/** How many calls may be open at once. Well under what the host stack holds. */
const MAX_CALL_DEPTH = 100;

/**
 * The `{ }` body of an arrow handed to a list method.
 *
 * Reached from the expression evaluator, which is where such a body is met.
 * The parameters are already bound into `scope` by the caller.
 */
export function execArrowBody(body: ArrowBlockBody, ctx: EvalContext): Value {
    try {
        execBody(body.body, ctx);
    } catch (e) {
        if (e instanceof ReturnSignal) return e.value;
        throw e;
    }
    return { type: 'none' };
}

/**
 * Spend one unit of the evaluation budget.
 *
 * The budget is what makes a section that loops forever stop being the user's
 * problem. It is spent per statement and per expression rather than estimated
 * up front — deciding in advance whether a program halts is the halting
 * problem, and a number produced by guessing would read as a guarantee.
 */
export function burn(ctx: EvalContext, span: Span): void {
    if (!ctx.fuel) return;
    if (ctx.fuel.left <= 0) {
        throw new EvalError('This block did not finish — it ran past what one generation is allowed to compute', span);
    }
    ctx.fuel.left--;
}

function execBody(body: Stmt[], ctx: EvalContext): void {
    for (const stmt of body) execStmt(stmt, ctx);
}

function scoped(ctx: EvalContext): EvalContext {
    return { ...ctx, scope: scopeOf(ctx).child() };
}

function scopeOf(ctx: EvalContext): Scope {
    if (!ctx.scope) throw new Error('A statement ran without a scope');
    return ctx.scope;
}

function execStmt(stmt: Stmt, ctx: EvalContext): void {
    burn(ctx, stmt.span);
    switch (stmt.kind) {
        case 'decl':
            execDecl(stmt, ctx);
            return;

        case 'expr':
            evalExpr(stmt.expr, ctx);
            return;

        case 'if': {
            if (truth(stmt.cond, ctx)) execBody(stmt.then, scoped(ctx));
            else if (stmt.alt) execBody(stmt.alt, scoped(ctx));
            return;
        }

        case 'while':
            while (truth(stmt.cond, ctx)) {
                // Spent per turn, so a body holding no expressions still ends.
                burn(ctx, stmt.span);
                if (runLoopBody(stmt.body, scoped(ctx))) break;
            }
            return;

        case 'for': {
            const head = scoped(ctx);
            if (stmt.init) execStmt(stmt.init, head);
            while (stmt.cond === null || truth(stmt.cond, head)) {
                burn(head, stmt.span);
                if (runLoopBody(stmt.body, scoped(head))) break;
                if (stmt.update) evalExpr(stmt.update, head);
            }
            return;
        }

        case 'for-of': {
            const head = scoped(ctx);
            const source = evalExpr(stmt.iterable, head);
            if (source.type !== 'array') {
                throw new EvalError(`This goes through a list, got ${source.type}`, stmt.iterable.span);
            }
            for (const item of source.items) {
                burn(head, stmt.span);
                // A fresh frame per turn, so a function written inside the
                // loop closes over that turn's element and not the last one.
                const turn = scoped(head);
                bindTarget(stmt.target, item, stmt.mutable, turn, stmt.span);
                if (runLoopBody(stmt.body, turn)) break;
            }
            return;
        }

        case 'block':
            execBody(stmt.body, scoped(ctx));
            return;

        case 'break':
            throw new BreakSignal();

        case 'continue':
            throw new ContinueSignal();

        case 'return':
            throw new ReturnSignal(stmt.value ? evalExpr(stmt.value, ctx) : { type: 'none' });
    }
}

/** Run one turn of a loop. True when it asked the loop to stop. */
function runLoopBody(body: Stmt[], ctx: EvalContext): boolean {
    try {
        execBody(body, ctx);
    } catch (e) {
        if (e instanceof BreakSignal) return true;
        if (!(e instanceof ContinueSignal)) throw e;
    }
    return false;
}

function truth(cond: Expr, ctx: EvalContext): boolean {
    const v = evalExpr(cond, ctx);
    if (v.type !== 'bool') throw new EvalError(`Condition must be bool, got ${v.type}`, cond.span);
    return v.value;
}

function execDecl(stmt: Stmt & { kind: 'decl' }, ctx: EvalContext): void {
    const scope = scopeOf(ctx);
    if (stmt.init?.kind === 'arrow' && stmt.target.kind === 'name') {
        scope.declareFn(stmt.target.name, {
            params: stmt.init.params,
            body: stmt.init.body,
            scope,
        });
        return;
    }
    const value = stmt.init ? evalExpr(stmt.init, ctx) : { type: 'none' as const };
    bindTarget(stmt.target, value, stmt.mutable, ctx, stmt.span);
}

function bindTarget(target: BindTarget, value: Value, mutable: boolean, ctx: EvalContext, span: Span): void {
    const scope = scopeOf(ctx);
    if (target.kind === 'name') {
        scope.declare(target.name, value, mutable);
        return;
    }

    if (target.kind === 'array-pattern') {
        if (value.type !== 'array') {
            throw new EvalError(`Taking a list apart needs a list, got ${value.type}`, target.span);
        }
        target.names.forEach((slot, i) => {
            if (slot) scope.declare(slot.name, value.items[i] ?? { type: 'none' }, mutable);
        });
        return;
    }

    if (value.type !== 'record') {
        throw new EvalError(`Taking fields apart needs a record, got ${value.type}`, span);
    }
    for (const field of target.fields) {
        const found = value.entries.find(e => e.key === field.key);
        scope.declare(field.name, found?.value ?? { type: 'none' }, mutable);
    }
}
