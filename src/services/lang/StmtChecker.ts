import { type Diagnostic, type Span, error, warning } from './Diagnostic';
import type { Expr } from './ExprAst';
import {
    type Bindings, type FnBinding, NO_BINDINGS, type TypeEnv, type VarBinding,
    checkExpr, isReservedName,
} from './ExprChecker';
import { type StaticType, isArrayType, isRecordType, recordFieldType, typeName } from './functions';
import type { BindTarget, Program, Stmt } from './StmtAst';

/**
 * Static check of a js section.
 *
 * What it adds over the expression checker is scope: which names exist here,
 * which of them can be written to, and which were never declared. The design
 * has no implicit globals, so a name that appears on the left of an `=`
 * without a declaration is a typo — and that is only knowable with the scope
 * tree this pass builds.
 *
 * Scopes are kept as one flat pair of maps with an undo log rather than a
 * chain of frames. The expression checker takes the bindings flattened, and
 * rebuilding that view on every expression would cost more than remembering
 * what to put back on the way out.
 */
export function checkProgram(
    program: Program,
    env: TypeEnv,
    diagnostics: Diagnostic[],
    outer: Bindings = NO_BINDINGS
): Bindings {
    const state = new CheckState(env, diagnostics, outer);
    state.runBody(program.body);
    // What the section leaves behind is what the block's body lines can read:
    // the top-level declarations, and nothing from inside a block or a loop.
    return state.snapshot();
}

/**
 * The statements of an arrow's block body, and the type its returns settle on.
 *
 * Called from the expression checker, which is where a block body is reached.
 * The two modules call each other for the same reason the two parsers do: a
 * statement holds expressions, and an expression may hold statements again.
 */
export function checkFunctionBody(
    body: Stmt[],
    env: TypeEnv,
    diagnostics: Diagnostic[],
    bindings: Bindings
): StaticType {
    const state = new CheckState(env, diagnostics, bindings);
    return state.runFunctionBody(body);
}

/** One entry of the undo log: what a name meant before this scope wrote it. */
type Undo = { map: Map<string, unknown>; name: string; had: boolean; was: unknown };

class CheckState {
    private readonly vars = new Map<string, VarBinding>();
    private readonly fns = new Map<string, FnBinding>();
    private readonly undo: Undo[] = [];
    /** Names declared in the scope being read now, for the duplicate check. */
    private declaredHere = new Set<string>();
    private loopDepth = 0;
    /** Non-null while a function body is being read: the types its returns give. */
    private returns: StaticType[] | null = null;

    constructor(
        private readonly env: TypeEnv,
        private readonly diagnostics: Diagnostic[],
        outer: Bindings
    ) {
        for (const [name, b] of outer.vars) this.vars.set(name, b);
        for (const [name, f] of outer.fns) this.fns.set(name, f);
    }

    snapshot(): Bindings {
        return { vars: new Map(this.vars), fns: new Map(this.fns) };
    }

    runBody(body: Stmt[]): void {
        for (const stmt of body) this.stmt(stmt);
    }

    runFunctionBody(body: Stmt[]): StaticType {
        const outerReturns = this.returns;
        // A loop outside the function does not enclose a `break` inside it.
        const outerLoops = this.loopDepth;
        this.returns = [];
        this.loopDepth = 0;
        try {
            this.scoped(() => this.runBody(body));
            const kinds = this.returns;
            if (kinds.length === 0) return 'none';
            // Several returns of different types is a body with no single
            // answer; 'error' is the unknown that keeps the call site quiet.
            return kinds.every(k => k === kinds[0]) ? kinds[0] : 'error';
        } finally {
            this.returns = outerReturns;
            this.loopDepth = outerLoops;
        }
    }

    // -- scope ------------------------------------------------------------

    private scoped(run: () => void): void {
        const mark = this.undo.length;
        const outerDeclared = this.declaredHere;
        this.declaredHere = new Set();
        try {
            run();
        } finally {
            for (let i = this.undo.length - 1; i >= mark; i--) {
                const { map, name, had, was } = this.undo[i];
                if (had) map.set(name, was); else map.delete(name);
            }
            this.undo.length = mark;
            this.declaredHere = outerDeclared;
        }
    }

    private declareVar(name: string, binding: VarBinding, span: Span, reserved: 'warn' | 'said' = 'warn'): void {
        if (!this.reportRedeclaration(name, span, reserved)) return;
        this.undo.push({ map: this.vars, name, had: this.vars.has(name), was: this.vars.get(name) });
        // A name can only be one thing here, so a value declaration retires
        // whatever function the same name held in an enclosing scope.
        if (this.fns.has(name)) {
            this.undo.push({ map: this.fns, name, had: true, was: this.fns.get(name) });
            this.fns.delete(name);
        }
        this.vars.set(name, binding);
    }

    private declareFn(name: string, binding: FnBinding, span: Span): void {
        if (!this.reportRedeclaration(name, span)) return;
        this.undo.push({ map: this.fns, name, had: this.fns.has(name), was: this.fns.get(name) });
        if (this.vars.has(name)) {
            this.undo.push({ map: this.vars, name, had: true, was: this.vars.get(name) });
            this.vars.delete(name);
        }
        this.fns.set(name, binding);
    }

    /** False when the declaration is refused outright. */
    private reportRedeclaration(name: string, span: Span, reserved: 'warn' | 'said' = 'warn'): boolean {
        if (this.vars.get(name)?.cell) {
            // Legal, and almost never meant: the block goes on reading and
            // writing this name, and none of it reaches the cell the flow line
            // carries — so the state stops moving with no other sign.
            this.diagnostics.push(warning('stmt.shadows-cell',
                `'${name}' is a cell of the flow command, and this declaration hides it — writing to it will not carry to the next instance`,
                span, { name }));
        }
        if (reserved === 'warn' && isReservedName(name)) {
            // A warning, not an error: the program means what it says, the
            // binding simply cannot be read — the built-in resolves first.
            this.diagnostics.push(warning('stmt.shadows-reserved',
                `'${name}' already means something here, so this binding cannot be read`,
                span, { name }));
        }
        if (this.declaredHere.has(name)) {
            this.diagnostics.push(error('stmt.already-declared',
                `'${name}' is already declared in this scope`, span, { name }));
            return false;
        }
        this.declaredHere.add(name);
        return true;
    }

    private bindings(): Bindings {
        return { vars: this.vars, fns: this.fns };
    }

    private expr(e: Expr): StaticType {
        return checkExpr(e, this.env, this.diagnostics, this.bindings());
    }

    // -- statements -------------------------------------------------------

    private stmt(stmt: Stmt): void {
        switch (stmt.kind) {
            case 'decl':
                this.decl(stmt);
                return;

            case 'expr':
                this.expr(stmt.expr);
                return;

            case 'if':
                this.condition(stmt.cond, 'if');
                this.scoped(() => this.runBody(stmt.then));
                if (stmt.alt) this.scoped(() => this.runBody(stmt.alt!));
                return;

            case 'while':
                this.condition(stmt.cond, 'while');
                this.loop(() => this.runBody(stmt.body));
                return;

            case 'for':
                // The head declares into the body's scope, as in JS.
                this.scoped(() => {
                    if (stmt.init) this.stmt(stmt.init);
                    if (stmt.cond) this.condition(stmt.cond, 'for');
                    if (stmt.update) this.expr(stmt.update);
                    this.loop(() => this.scoped(() => this.runBody(stmt.body)));
                });
                return;

            case 'for-of':
                this.scoped(() => {
                    const source = this.expr(stmt.iterable);
                    this.bindTarget(stmt.target, this.elementOf(source, stmt.iterable.span), stmt.mutable);
                    this.loop(() => this.scoped(() => this.runBody(stmt.body)));
                });
                return;

            case 'block':
                this.scoped(() => this.runBody(stmt.body));
                return;

            case 'break':
            case 'continue':
                if (this.loopDepth === 0) {
                    this.diagnostics.push(error(`stmt.${stmt.kind}-not-in-loop`,
                        `'${stmt.kind}' only means something inside a for or a while`, stmt.span));
                }
                return;

            case 'return':
                // The parser already refuses a top-level return, so a return
                // that arrives here is inside a body that collects them.
                this.returns?.push(stmt.value ? this.expr(stmt.value) : 'none');
                return;
        }
    }

    private loop(run: () => void): void {
        this.loopDepth++;
        try {
            run();
        } finally {
            this.loopDepth--;
        }
    }

    /**
     * A condition, and the one warning the design asks for here.
     *
     * `if (n = 1)` is a typed `==` far more often than a deliberate write, and
     * it always takes the branch. Parentheses around the assignment say it was
     * meant — the convention JS linters have taught for decades — so the
     * parser records them and this stays quiet when they are there.
     */
    private condition(cond: Expr, what: string): void {
        if (cond.kind === 'assign' && !cond.parenthesized) {
            this.diagnostics.push(warning('stmt.assign-in-condition',
                `This writes to '${cond.name}' rather than comparing it — write '==' to compare, or wrap it in its own parentheses to mean the write`,
                cond.span, { name: cond.name, what }));
        }
        const t = this.expr(cond);
        if (t !== 'bool' && t !== 'error') {
            this.diagnostics.push(error('type.cond-not-bool',
                `Condition must be bool, got ${typeName(t)}`, cond.span, { actual: typeName(t) }));
        }
    }

    private decl(stmt: Stmt & { kind: 'decl' }): void {
        // An arrow binds a function, which is a different table from the
        // values — that separation is what keeps a function out of a list, a
        // record field, and later a cell.
        if (stmt.init?.kind === 'arrow') {
            if (stmt.target.kind !== 'name') {
                this.diagnostics.push(error('stmt.fn-pattern',
                    'A function is bound to one name, not taken apart', stmt.target.span));
                return;
            }
            const arrow = stmt.init;
            const binding: FnBinding = { params: arrow.params, span: stmt.target.span };
            // Declared before the body is read, so a function that calls
            // itself resolves rather than reporting an unknown name.
            this.declareFn(stmt.target.name, binding, stmt.target.span);
            // Checked once, here. The parameter types are not knowable — there
            // are no annotations and a call site does not report back — so
            // they are bound as unknown: what the body says about names and
            // refused constructs is caught, what it says about the shape of a
            // parameter is not.
            binding.result = this.checkArrowDeclaration(arrow);
            return;
        }

        // `let x` with nothing to go on holds the unknown, not `none`: the
        // shape it exists for is a value written on the next line or two, and
        // typing it as the missing value would refuse every one of them.
        const type = stmt.init ? this.expr(stmt.init) : 'error';
        this.bindTarget(stmt.target, type, stmt.mutable);
    }

    /** The body of `const f = ... => ...`, with its parameters bound unknown. */
    private checkArrowDeclaration(arrow: Expr & { kind: 'arrow' }): StaticType {
        let result: StaticType = 'error';
        this.scoped(() => {
            for (const p of arrow.params) {
                // An error, not the warning a `let` gets. R6b: a parameter is
                // the only handle on what was passed, so a body that cannot
                // see it has no correct reading — and it fails quietly, which
                // is what makes it worse than a binding nobody can read.
                if (isReservedName(p)) {
                    this.diagnostics.push(error('type.param-shadows-builtin',
                        `'${p}' already means something here — the built-in wins and this parameter cannot be read`,
                        arrow.span, { name: p }));
                }
                this.declareVar(p, { type: 'error', mutable: true }, arrow.span, 'said');
            }
            result = arrow.body.kind === 'block-body'
                ? this.runFunctionBody(arrow.body.body)
                : this.expr(arrow.body);
        });
        return result;
    }

    /** `let x` / `let [a, b]` / `let {a, b: c}`, given the value's type. */
    private bindTarget(target: BindTarget, type: StaticType, mutable: boolean): void {
        if (target.kind === 'name') {
            this.declareVar(target.name, { type, mutable }, target.span);
            return;
        }

        if (target.kind === 'array-pattern') {
            const element = this.elementOf(type, target.span);
            for (const slot of target.names) {
                if (slot) this.declareVar(slot.name, { type: element, mutable }, slot.span);
            }
            return;
        }

        if (type === 'error') {
            for (const f of target.fields) this.declareVar(f.name, { type: 'error', mutable }, f.span);
            return;
        }
        if (!isRecordType(type)) {
            this.diagnostics.push(error('stmt.not-destructurable',
                `Taking fields apart needs a record, got ${typeName(type)}`,
                target.span, { actual: typeName(type) }));
            for (const f of target.fields) this.declareVar(f.name, { type: 'error', mutable }, f.span);
            return;
        }
        for (const f of target.fields) {
            const field = recordFieldType(type, f.key);
            if (field === undefined) {
                this.diagnostics.push(error('type.unknown-field',
                    `${typeName(type)} has no field '${f.key}'`,
                    f.span, { receiver: typeName(type), name: f.key }));
            }
            this.declareVar(f.name, { type: field ?? 'error', mutable }, f.span);
        }
    }

    /** What one element of a list is, saying so when the value is not a list. */
    private elementOf(type: StaticType, span: Span): StaticType {
        if (type === 'error') return 'error';
        if (isArrayType(type)) return type.array;
        this.diagnostics.push(error('stmt.not-iterable',
            `This goes through a list, got ${typeName(type)}`, span, { actual: typeName(type) }));
        return 'error';
    }
}
