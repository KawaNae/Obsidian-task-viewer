import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { type Expr, isExprBody } from '../../../src/services/lang/ExprAst';
import { type Bindings, FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import type { EvalContext } from '../../../src/services/lang/ExprEvaluator';
import type { Stmt } from '../../../src/services/lang/StmtAst';
import type { EvalHost, StaticType } from '../../../src/services/lang/functions';
import { arrayOf, recordOf } from '../../../src/services/lang/functions';
import { DECIMAL_SCALE, type Value } from '../../../src/services/lang/Value';

/**
 * The machinery both differential sweeps stand on.
 *
 * Two sweeps read the same corpus of meaning: expressions (ExprDifferential)
 * and the js section's statements (StmtDifferential). What they share is not
 * incidental — the bindings, the bridge to JS values, the comparison, and
 * above all the six deviation predicates. A predicate that lived in one sweep
 * and not the other would let the same deviation be excluded on one surface
 * and reported on the other, which is the disagreement the one-grammar
 * decision exists to prevent.
 */

// ---------------------------------------------------------------------------
// One binding table, two derivations
// ---------------------------------------------------------------------------

/**
 * Every free name a corpus source may use, as a plain JS value. The language
 * side (Value bindings and their static types) is derived from this table
 * rather than written twice — a binding cannot be one thing here and another
 * there.
 */
export const BINDINGS: Record<string, unknown> = {
    xs: ['a', 'bb', 'ccc'],
    ns: [3, 1, 2],
    ys: [10, 20],
    n: 3,
    y: 2,
    key: 'a',
    key2: 'tue',
    s: 'hello world',
    flag: true,
    a: 'A',
    b: 'B',
    name: 'N',
};

/** Property snapshot for the comparable injected properties. */
export const PROPS: Partial<Record<'content' | 'done', unknown>> = {
    content: '週報 第3回',
    done: false,
};

/** JS value → language Value. Fresh on every call, so no run can see another's mutations. */
export function toValue(js: unknown): Value {
    if (js === undefined) return { type: 'none' };
    if (typeof js === 'number') return { type: 'number', value: js };
    if (typeof js === 'string') return { type: 'string', value: js };
    if (typeof js === 'boolean') return { type: 'bool', value: js };
    if (Array.isArray(js)) return { type: 'array', items: js.map(toValue) };
    return {
        type: 'record',
        entries: Object.entries(js as Record<string, unknown>).map(([key, value]) => ({ key, value: toValue(value) })),
    };
}

/** The static type of a bound value. Bound arrays are homogeneous by construction. */
export function typeOfValue(v: Value): StaticType {
    if (v.type === 'array') return arrayOf(v.items.length > 0 ? typeOfValue(v.items[0]) : 'none');
    if (v.type === 'record') {
        const fields: Record<string, StaticType> = {};
        for (const e of v.entries) fields[e.key] = typeOfValue(e.value);
        return recordOf(fields);
    }
    return v.type;
}

/**
 * The corpus bindings as static types.
 *
 * `mutable` is a parameter because the statement corpus writes to them and
 * the expression corpus cannot. Immutable is the honest answer for
 * expressions — nothing there can assign — and making the statement sweep
 * say so explicitly keeps "these can be written" a decision rather than a
 * default nobody chose.
 */
export function bindingTypes(mutable: boolean): Bindings {
    return {
        vars: new Map(Object.entries(BINDINGS).map(
            ([name, js]) => [name, { type: typeOfValue(toValue(js)), mutable }])),
        fns: new Map(),
        // The sweep compares this language against JS, which has no cells.
        cells: new Map(),
    };
}

export const VAR_TYPES: Bindings = bindingTypes(false);

const stubHost: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : '?'}]`,
};

export function freshContext(): EvalContext {
    return {
        props: {
            content: toValue(PROPS.content),
            done: toValue(PROPS.done),
        },
        vars: new Map(Object.entries(BINDINGS).map(([name, js]) => [name, toValue(js)])),
        today: '2026-08-16',
        now: { date: '2026-08-16', time: '10:00' },
        weekStartDay: 1,
        host: stubHost,
    };
}

export type JsOutcome = { ok: true; value: unknown } | { ok: false; thrown: string };

/**
 * Run a function body as native JS, with the corpus bindings as parameters.
 *
 * Parameters rather than declarations at the top of the body, so the names
 * arrive without a `let` of their own. JS still refuses a body-level `let`
 * over a parameter, and this language reads the same source as a shadow — so
 * a corpus source that redeclares a bound name would be a SyntaxError on one
 * side only. That is a harness accident wearing a deviation's clothes, and
 * the statement sweep refuses such a source before either side runs.
 */
export function runJs(body: string): JsOutcome {
    const names = [...Object.keys(BINDINGS), ...Object.keys(PROPS), 'none'];
    const args = [
        ...Object.keys(BINDINGS).map(name => structuredClone(BINDINGS[name])),
        ...Object.keys(PROPS).map(name => PROPS[name as keyof typeof PROPS]),
        undefined, // `none` is this language's missing value; JS spells it undefined
    ];
    try {
        const fn = new Function(...names, `'use strict';
${body}`);
        return { ok: true, value: fn(...args) };
    } catch (e) {
        return { ok: false, thrown: String(e) };
    }
}

/** Evaluate the source as native JS, with the same names in scope. */
export function evalJs(src: string): JsOutcome {
    return runJs(`return (${src});`);
}

// ---------------------------------------------------------------------------
// The bridge and the comparison
// ---------------------------------------------------------------------------

/** Language Value → the JS value it means. `none` is undefined; a record is a plain object. */
export function bridge(v: Value): unknown {
    switch (v.type) {
        case 'none': return undefined;
        case 'number': case 'string': case 'bool': return v.value;
        case 'array': return v.items.map(bridge);
        // Object.fromEntries keeps the last write per key — the same answer
        // recordField gives on the language side.
        case 'record': return Object.fromEntries(v.entries.map(e => [e.key, bridge(e.value)]));
        default: return { unbridgeable: v.type };
    }
}

/** Arithmetic lands on the decimal grid; the comparison meets both sides there. */
function quantize(v: number): number {
    return Number.isInteger(v) ? v : Math.round(v * DECIMAL_SCALE) / DECIMAL_SCALE;
}

export function deepEqual(a: unknown, b: unknown, onGrid: boolean): boolean {
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) && Number.isNaN(b)) return true;
        return onGrid ? quantize(a) === quantize(b) : a === b;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((item, i) => deepEqual(item, b[i], onGrid));
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
        const ak = Object.keys(a as object);
        const bk = Object.keys(b as object);
        // Key order is part of a record's meaning, so it is part of equality.
        return ak.length === bk.length && ak.every((k, i) => bk[i] === k
            && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], onGrid));
    }
    return a === b;
}

export function show(v: unknown): string {
    return v === undefined ? 'undefined' : JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// The exclusion list: the six intentional deviations, as predicates
// ---------------------------------------------------------------------------

/** Function names that mean something only in this language. `Math.*` is shared with JS. */
function isDomainFn(fn: string): boolean {
    return !fn.startsWith('Math.');
}

/** Properties whose values are dates — no JS binding could mean the same. */
const DOMAIN_PROPS = new Set(['start', 'end', 'due', 'today', 'file.name']);

export interface Features {
    /**
     * #1 10進, the comparable half — decimal arithmetic through continuous
     * operations (`+` `-` `*`, and `/` under the root rule below). This
     * language lands every result on the ten-place grid and JS carries the
     * raw float, but the two stay within half a grid step of each other, so
     * quantizing both sides makes them meet: `0.1 + 0.2` is 0.3 here and
     * 0.30000000000000004 in JS, and the grid comparison sees one number.
     */
    decimalGrid: boolean;
    /**
     * #1 10進, the incomparable half — a decimal feeding a discontinuous
     * consumer: `%`, an equality or an ordering, `Math.floor`-family, or a
     * digit/bound position. Half a grid step is exactly what flips those:
     * `0.1 + 0.2 == 0.3` is true here and false in JS by design, and
     * `Math.floor(0.7 * 10)` is 7 here and 6 in JS. These are the deviation
     * itself, pinned in ExprDecimal.test.ts and skipped here.
     */
    decimalStep: boolean;
    /**
     * #2 除算丸め, the comparable half — the expression is one `/` or `%` at
     * the root, fed by exact integer arithmetic. Its result lives on the
     * ten-digit grid, so both sides are compared there (the adapter).
     */
    divisionRoot: boolean;
    /**
     * #2 除算丸め, the incomparable half — a quotient feeding further
     * computation. This language rounds every quotient to ten digits before
     * it travels; JS composes at full precision, and any discontinuous
     * consumer (another division, `*`, `Math.floor`, a comparison) can land
     * on a different answer by design. `1 / 3 * 3` is 0.9999999999 here and
     * 1 in JS — that is the deviation itself, so these are skipped, not
     * compared.
     */
    divisionComposed: boolean;
    /** #3 領域リテラルと記法 — dates, durations, links, the date functions, and the template backslash rule. */
    domain: boolean;
    /** #4 == 厳密 — equality whose operands are containers or of different static types. */
    strictEq: boolean;
    // #5 配列不変 is not a skip: every compared source runs the immutability
    //    assertion below, and JS gets fresh bindings per run.
    // #6 環境なし is structural: a name this language rejects never reaches
    //    the comparison, because only accepted sources are compared.
}

export function detectFeatures(expr: Expr, bindings: Bindings = VAR_TYPES): Features {
    const f: Features = {
        decimalGrid: false,
        decimalStep: false,
        divisionRoot: false,
        divisionComposed: false,
        domain: false,
        strictEq: false,
    };
    const marks = { decimal: false, step: false };
    walk(expr, f, marks, bindings);
    if (marks.decimal) {
        if (marks.step) f.decimalStep = true;
        else f.decimalGrid = true;
    }
    // One division, and it is the whole expression: the per-operation
    // rounding and the end-of-expression rounding are then the same rounding.
    const divisions = countDivisions(expr);
    if (divisions > 0) {
        const rootIsDivision = expr.kind === 'binary' && (expr.op === '/' || expr.op === '%');
        // `%` over decimals follows the quantized quotient here and the raw
        // carrier in JS — the step case, whichever position it sits in.
        if (divisions === 1 && rootIsDivision && !(marks.decimal && expr.op === '%')) f.divisionRoot = true;
        else f.divisionComposed = true;
    }
    return f;
}

function countDivisions(expr: Expr): number {
    let count = 0;
    const visit = (node: Expr): void => {
        if (node.kind === 'binary') {
            if (node.op === '/' || node.op === '%') count++;
            visit(node.left); visit(node.right);
            return;
        }
        switch (node.kind) {
            case 'unary': return visit(node.operand);
            case 'cond': visit(node.cond); visit(node.then); visit(node.else); return;
            case 'call': node.args.forEach(visit); return;
            case 'member': return visit(node.obj);
            case 'method': visit(node.obj); node.args.forEach(visit); return;
            case 'index': visit(node.obj); visit(node.index); return;
            case 'assign': return visit(node.value);
            case 'call-local': node.args.forEach(visit); return;
            case 'arrow': return isExprBody(node.body) ? visit(node.body) : undefined;
            case 'array': node.items.forEach(visit); return;
            case 'record': node.entries.forEach(e => visit(e.value)); return;
            case 'spread': return visit(node.arg);
            case 'template': node.parts.forEach(p => { if (p.kind === 'expr') visit(p.expr); }); return;
            default: return;
        }
    };
    visit(expr);
    return count;
}

/** What a decimal must not meet to stay comparable: anything half a grid step can flip. */
const STEP_OPS = new Set(['%', '==', '!=', '<', '<=', '>', '>=']);
const STEP_FNS = new Set(['Math.floor', 'Math.ceil', 'Math.round']);
const STEP_METHODS = new Set(['toFixed', 'slice', 'padStart']);

function walk(expr: Expr, f: Features, marks: { decimal: boolean; step: boolean }, bindings: Bindings): void {
    switch (expr.kind) {
        case 'lit':
            if (['date', 'datetime', 'time', 'duration', 'link'].includes(expr.value.type)) f.domain = true;
            if (expr.value.type === 'number' && !Number.isInteger(expr.value.value)) marks.decimal = true;
            return;
        case 'prop':
            if (DOMAIN_PROPS.has(expr.name)) f.domain = true;
            return;
        case 'unary': return walk(expr.operand, f, marks, bindings);
        case 'binary': {
            if (STEP_OPS.has(expr.op)) marks.step = true;
            if (expr.op === '==' || expr.op === '!=') {
                const lt = staticTypeOf(expr.left, bindings);
                const rt = staticTypeOf(expr.right, bindings);
                const container = (t: StaticType) => typeof t === 'object';
                // An unknown side decides nothing.
                //
                // A subtree typed on its own is unknown whenever a name comes
                // from outside it — a callback's parameter, a loop variable —
                // and the old reading called that the deviation, which took
                // every comparison written inside a loop out of the net.
                //
                // The choice is between two ways of being wrong, and they are
                // not symmetric. Calling unknown a deviation shrinks the net
                // and says nothing; calling it comparable can only produce a
                // red line, and a red line gets read. Loud beats quiet.
                //
                // Not "an accepted comparison must be well-typed" — that is
                // false twice over. `checkExpr` short-circuits on an unknown
                // operand before it ever judges the comparison, so acceptance
                // means it did not look; and the sweep does not type-check
                // every expression it runs either.
                const unknown = lt === 'error' || rt === 'error';
                if (!unknown && (container(lt) || container(rt) || lt !== rt)) {
                    f.strictEq = true;
                }
            }
            walk(expr.left, f, marks, bindings);
            walk(expr.right, f, marks, bindings);
            return;
        }
        case 'cond':
            walk(expr.cond, f, marks, bindings); walk(expr.then, f, marks, bindings); walk(expr.else, f, marks, bindings);
            return;
        case 'call':
            if (isDomainFn(expr.fn)) f.domain = true;
            if (STEP_FNS.has(expr.fn)) marks.step = true;
            expr.args.forEach(arg => walk(arg, f, marks, bindings));
            return;
        case 'member':
            return walk(expr.obj, f, marks, bindings);
        case 'method':
            if (STEP_METHODS.has(expr.name)) marks.step = true;
            walk(expr.obj, f, marks, bindings);
            expr.args.forEach(arg => walk(arg, f, marks, bindings));
            return;
        case 'index':
            walk(expr.obj, f, marks, bindings); walk(expr.index, f, marks, bindings);
            return;
        case 'var': return;
        case 'assign': return walk(expr.value, f, marks, bindings);
        case 'call-local': return expr.args.forEach(arg => walk(arg, f, marks, bindings));
        case 'arrow':
            // A block body's statements are walked by the caller that has
            // them; from here only an expression body is reachable.
            return isExprBody(expr.body) ? walk(expr.body, f, marks, bindings) : undefined;
        case 'array': return expr.items.forEach(item => walk(item, f, marks, bindings));
        case 'record': return expr.entries.forEach(e => walk(e.value, f, marks, bindings));
        case 'spread': return walk(expr.arg, f, marks, bindings);
        case 'template':
            for (const part of expr.parts) {
                if (part.kind === 'text') {
                    // The backslash rule differs from JS (here it only escapes
                    // `${`; in JS it escapes everything), and a folded `${` in
                    // the text was live text in JS. Either mark makes the
                    // source mean two different strings.
                    if (part.text.includes('\\') || part.text.includes('${')) f.domain = true;
                } else {
                    walk(part.expr, f, marks, bindings);
                }
            }
            return;
    }
}

/** The static type of a subtree, for the equality predicate. 'error' when it cannot be known alone. */
export function staticTypeOf(expr: Expr, bindings: Bindings = VAR_TYPES): StaticType {
    const scratch: Diagnostic[] = [];
    return checkExpr(expr, FLOW_TYPE_ENV, scratch, bindings);
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/**
 * Every expression a statement holds, in document order.
 *
 * The deviation predicates read expressions, and a statement is a container
 * for them. Collecting rather than duplicating the walk is what keeps one
 * definition of each deviation: a decimal inside a `for` head is the same
 * decimal it would be on a line of its own.
 */
export function expressionsOf(body: Stmt[]): Expr[] {
    const found: Expr[] = [];
    const fromExpr = (e: Expr): void => {
        found.push(e);
        // An arrow's block body is statements again, so it re-enters here.
        if (e.kind === 'arrow' && !isExprBody(e.body)) found.push(...expressionsOf(e.body.body));
    };
    const visit = (stmt: Stmt): void => {
        switch (stmt.kind) {
            case 'decl': if (stmt.init) fromExpr(stmt.init); return;
            case 'expr': return fromExpr(stmt.expr);
            case 'if':
                fromExpr(stmt.cond);
                stmt.then.forEach(visit);
                stmt.alt?.forEach(visit);
                return;
            case 'while': fromExpr(stmt.cond); stmt.body.forEach(visit); return;
            case 'for':
                if (stmt.init) visit(stmt.init);
                if (stmt.cond) fromExpr(stmt.cond);
                if (stmt.update) fromExpr(stmt.update);
                stmt.body.forEach(visit);
                return;
            case 'for-of': fromExpr(stmt.iterable); stmt.body.forEach(visit); return;
            case 'block': stmt.body.forEach(visit); return;
            case 'return': if (stmt.value) fromExpr(stmt.value); return;
            case 'break': case 'continue': return;
        }
    };
    body.forEach(visit);
    return found;
}

/** The deviations a whole program touches, folded from its expressions. */
export function detectProgramFeatures(body: Stmt[], read: Expr, bindings: Bindings = VAR_TYPES): Features {
    const all = [...expressionsOf(body), read];
    const folded = detectFeatures(read, bindings);
    for (const expr of all) {
        const f = detectFeatures(expr, bindings);
        folded.decimalGrid ||= f.decimalGrid;
        folded.decimalStep ||= f.decimalStep;
        folded.divisionRoot ||= f.divisionRoot;
        folded.divisionComposed ||= f.divisionComposed;
        folded.domain ||= f.domain;
        folded.strictEq ||= f.strictEq;
    }
    // A quotient computed in one statement and read in another is composed
    // division, whichever statement each half sits in — the root rule only
    // holds when the whole of the arithmetic is one expression.
    if (folded.divisionRoot && all.length > 1) {
        folded.divisionRoot = false;
        folded.divisionComposed = true;
    }
    return folded;
}

/**
 * Names a program binds at its top level — what the read is expected to see.
 *
 * A declaration whose value is an arrow binds a function, and a function is
 * not a value here: no `read` could observe one, so it is not something the
 * read is failing to look at.
 */
export function topLevelNames(body: Stmt[]): string[] {
    const names: string[] = [];
    for (const stmt of body) {
        if (stmt.kind !== 'decl' || stmt.init?.kind === 'arrow') continue;
        const t = stmt.target;
        if (t.kind === 'name') names.push(t.name);
        else if (t.kind === 'array-pattern') names.push(...t.names.filter(Boolean).map(n => n!.name));
        else names.push(...t.fields.map(f => f.name));
    }
    return names;
}

/** Names an expression reads as bindings. */
export function namesRead(expr: Expr): Set<string> {
    const seen = new Set<string>();
    const visit = (e: Expr): void => {
        switch (e.kind) {
            case 'var': seen.add(e.name); return;
            case 'assign': seen.add(e.name); return visit(e.value);
            case 'call-local': seen.add(e.name); e.args.forEach(visit); return;
            case 'unary': return visit(e.operand);
            case 'binary': visit(e.left); visit(e.right); return;
            case 'cond': visit(e.cond); visit(e.then); visit(e.else); return;
            case 'call': e.args.forEach(visit); return;
            case 'member': return visit(e.obj);
            case 'method': visit(e.obj); e.args.forEach(visit); return;
            case 'index': visit(e.obj); visit(e.index); return;
            case 'array': e.items.forEach(visit); return;
            case 'record': e.entries.forEach(entry => visit(entry.value)); return;
            case 'spread': return visit(e.arg);
            case 'template':
                e.parts.forEach(p => { if (p.kind === 'expr') visit(p.expr); });
                return;
            case 'arrow':
                if (isExprBody(e.body)) visit(e.body);
                else expressionsOf(e.body.body).forEach(visit);
                return;
            default: return;
        }
    };
    visit(expr);
    return seen;
}
