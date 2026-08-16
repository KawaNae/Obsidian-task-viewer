import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import type { Expr } from '../../../src/services/lang/ExprAst';
import { type Bindings, FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import { EvalContext, EvalError, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import type { EvalHost, StaticType } from '../../../src/services/lang/functions';
import { arrayOf, recordOf } from '../../../src/services/lang/functions';
import { DECIMAL_SCALE, type Value } from '../../../src/services/lang/Value';
import {
    BLOCK_FAMILIES, DIFFERENTIAL_FAMILIES, type Family, LITERAL_FAMILIES, NESTING_FAMILIES,
    POSTFIX_FAMILIES,
} from './exprFamilies';

/**
 * The differential sweep: the same source, evaluated by this language and by
 * native JS, has to mean the same thing — except where the design deviates on
 * purpose.
 *
 * The deviations are not scattered through the corpus as hand-written tags;
 * they are the six predicates on `Features` below, detected on the parsed
 * tree. Only a divergence no predicate claims turns red. When a deviation
 * shrinks, its predicate shrinks with it and the net widens over the whole
 * corpus at once — decimals did exactly this when they landed: the skip
 * became a grid comparison, and only the discontinuous consumers stayed out.
 *
 * The corpus is `exprFamilies.ts`, shared with the round-trip sweep: a family
 * added there is measured for printing and for meaning on the same day.
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
const BINDINGS: Record<string, unknown> = {
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
const PROPS: Partial<Record<'content' | 'done', unknown>> = {
    content: '週報 第3回',
    done: false,
};

/** JS value → language Value. Fresh on every call, so no run can see another's mutations. */
function toValue(js: unknown): Value {
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
function typeOfValue(v: Value): StaticType {
    if (v.type === 'array') return arrayOf(v.items.length > 0 ? typeOfValue(v.items[0]) : 'none');
    if (v.type === 'record') {
        const fields: Record<string, StaticType> = {};
        for (const e of v.entries) fields[e.key] = typeOfValue(e.value);
        return recordOf(fields);
    }
    return v.type;
}

const VAR_TYPES: Bindings = {
    vars: new Map(Object.entries(BINDINGS).map(
        ([name, js]) => [name, { type: typeOfValue(toValue(js)), mutable: false }])),
    fns: new Map(),
};

const stubHost: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : '?'}]`,
};

function freshContext(): EvalContext {
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

/** Evaluate the source as native JS, with the same names in scope. */
function evalJs(src: string): { ok: true; value: unknown } | { ok: false; thrown: string } {
    const names = [...Object.keys(BINDINGS), ...Object.keys(PROPS), 'none'];
    const args = [
        ...Object.keys(BINDINGS).map(name => structuredClone(BINDINGS[name])),
        ...Object.keys(PROPS).map(name => PROPS[name as keyof typeof PROPS]),
        undefined, // `none` is this language's missing value; JS spells it undefined
    ];
    try {
        const fn = new Function(...names, `'use strict'; return (${src});`);
        return { ok: true, value: fn(...args) };
    } catch (e) {
        return { ok: false, thrown: String(e) };
    }
}

// ---------------------------------------------------------------------------
// The bridge and the comparison
// ---------------------------------------------------------------------------

/** Language Value → the JS value it means. `none` is undefined; a record is a plain object. */
function bridge(v: Value): unknown {
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

function deepEqual(a: unknown, b: unknown, onGrid: boolean): boolean {
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

function show(v: unknown): string {
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

interface Features {
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

function detectFeatures(expr: Expr): Features {
    const f: Features = {
        decimalGrid: false,
        decimalStep: false,
        divisionRoot: false,
        divisionComposed: false,
        domain: false,
        strictEq: false,
    };
    const marks = { decimal: false, step: false };
    walk(expr, f, marks);
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
            case 'arrow': return visit(node.body);
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

function walk(expr: Expr, f: Features, marks: { decimal: boolean; step: boolean }): void {
    switch (expr.kind) {
        case 'lit':
            if (['date', 'datetime', 'time', 'duration', 'link'].includes(expr.value.type)) f.domain = true;
            if (expr.value.type === 'number' && !Number.isInteger(expr.value.value)) marks.decimal = true;
            return;
        case 'prop':
            if (DOMAIN_PROPS.has(expr.name)) f.domain = true;
            return;
        case 'unary': return walk(expr.operand, f, marks);
        case 'binary': {
            if (STEP_OPS.has(expr.op)) marks.step = true;
            if (expr.op === '==' || expr.op === '!=') {
                const lt = staticTypeOf(expr.left);
                const rt = staticTypeOf(expr.right);
                const container = (t: StaticType) => typeof t === 'object';
                if (lt === 'error' || rt === 'error' || container(lt) || container(rt) || lt !== rt) {
                    f.strictEq = true;
                }
            }
            walk(expr.left, f, marks);
            walk(expr.right, f, marks);
            return;
        }
        case 'cond':
            walk(expr.cond, f, marks); walk(expr.then, f, marks); walk(expr.else, f, marks);
            return;
        case 'call':
            if (isDomainFn(expr.fn)) f.domain = true;
            if (STEP_FNS.has(expr.fn)) marks.step = true;
            expr.args.forEach(arg => walk(arg, f, marks));
            return;
        case 'member':
            return walk(expr.obj, f, marks);
        case 'method':
            if (STEP_METHODS.has(expr.name)) marks.step = true;
            walk(expr.obj, f, marks);
            expr.args.forEach(arg => walk(arg, f, marks));
            return;
        case 'index':
            walk(expr.obj, f, marks); walk(expr.index, f, marks);
            return;
        case 'var': return;
        case 'arrow': return walk(expr.body, f, marks);
        case 'array': return expr.items.forEach(item => walk(item, f, marks));
        case 'record': return expr.entries.forEach(e => walk(e.value, f, marks));
        case 'spread': return walk(expr.arg, f, marks);
        case 'template':
            for (const part of expr.parts) {
                if (part.kind === 'text') {
                    // The backslash rule differs from JS (here it only escapes
                    // `${`; in JS it escapes everything), and a folded `${` in
                    // the text was live text in JS. Either mark makes the
                    // source mean two different strings.
                    if (part.text.includes('\\') || part.text.includes('${')) f.domain = true;
                } else {
                    walk(part.expr, f, marks);
                }
            }
            return;
    }
}

/** The static type of a subtree, for the equality predicate. 'error' when it cannot be known alone. */
function staticTypeOf(expr: Expr): StaticType {
    const scratch: Diagnostic[] = [];
    return checkExpr(expr, FLOW_TYPE_ENV, scratch, VAR_TYPES);
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

interface FamilyOutcome { compared: number; skipped: number; rejected: number; red: string[] }

function runFamily(family: Family): FamilyOutcome {
    const outcome: FamilyOutcome = { compared: 0, skipped: 0, rejected: 0, red: [] };

    for (const src of family.sources) {
        const diagnostics: Diagnostic[] = [];
        const tokens = tokenize(src);
        diagnostics.push(...tokens.diagnostics);
        const cursor = new TokenCursor(tokens.tokens);
        const expr = parseExpr(cursor, diagnostics, 'block');
        if (expr) checkExpr(expr, FLOW_TYPE_ENV, diagnostics, VAR_TYPES);
        if (!expr || !cursor.at('eof') || diagnostics.length > 0) {
            // Refusal is this language's own answer — deviation #6 (no
            // environment) lives here, along with plain type errors.
            outcome.rejected++;
            continue;
        }

        const features = detectFeatures(expr);
        if (features.decimalStep || features.domain || features.strictEq || features.divisionComposed) {
            outcome.skipped++;
            continue;
        }

        const ctx = freshContext();
        let ours: { ok: true; value: Value } | { ok: false; thrown: string };
        try {
            ours = { ok: true, value: evalExpr(expr, ctx) };
        } catch (e) {
            if (!(e instanceof EvalError)) throw e;
            ours = { ok: false, thrown: e.message };
        }
        const js = evalJs(src);

        outcome.compared++;
        if (ours.ok !== js.ok) {
            const ourSide = ours.ok ? show(bridge(ours.value)) : `threw "${ours.thrown}"`;
            const jsSide = js.ok ? show(js.value) : `threw "${js.thrown}"`;
            outcome.red.push(`${src} — ours: ${ourSide} / js: ${jsSide}`);
            continue;
        }
        if (ours.ok && js.ok && !deepEqual(bridge(ours.value), js.value, features.divisionRoot || features.decimalGrid)) {
            outcome.red.push(`${src} — ours: ${show(bridge(ours.value))} / js: ${show(js.value)}`);
            continue;
        }

        // Deviation #5, asserted rather than skipped: whatever the source
        // did, the bindings it read are still what they were bound to.
        for (const [varName, bound] of ctx.vars ?? []) {
            if (!deepEqual(bridge(bound), structuredClone(BINDINGS[varName]), false)) {
                outcome.red.push(`${src} — mutated '${varName}' to ${show(bridge(bound))}`);
            }
        }
    }

    return outcome;
}

const ALL_FAMILIES: Family[] = [
    ...NESTING_FAMILIES,
    ...POSTFIX_FAMILIES,
    ...LITERAL_FAMILIES,
    ...BLOCK_FAMILIES,
    ...DIFFERENTIAL_FAMILIES,
];

/**
 * Families where zero comparisons is the expected outcome — named here so
 * their absence from the net is a decision on record, not a silent hole. Two
 * ways in: every source touches an exclusion (the domain shapes), or every
 * source is refused by this language's own checker (mixed-type `??` pairings,
 * `!` over numbers), which is deviation #6 wearing its structural form. A
 * family that starts comparing fails the second assertion and gets taken off
 * this list on purpose.
 */
const EXPECTED_ZERO_COMPARED = new Set([
    // all-domain shapes
    'method call',
    'optional member',
    'unit keyword call',
    'string-arg call',
    'domain literal call',
    'dotted property',
    'date and time',
    'duration',
    'wikilink',
    // every op pairing is refused or excluded: the op crossing exists for the
    // round-trip net; the differential meaning of these shapes is carried by
    // the DIFFERENTIAL_FAMILIES written with matching bindings
    '!(a OP b) OP c',
    'index',
    'list literal',
    'arrow argument',
    'record literal',
    // Math.floor(3 / 2) OP 1 — a quotient feeding floor is composed division
    'namespaced call',
]);

describe('differential sweep against native JS', () => {
    it('agrees with JS everywhere no documented deviation applies', () => {
        const red = ALL_FAMILIES.flatMap(family => runFamily(family).red);
        expect(red).toEqual([]);
    });

    it('keeps the net from going hollow, family by family', () => {
        const hollow: string[] = [];
        const unexpectedlyCompared: string[] = [];
        const totals = { compared: 0, skipped: 0, rejected: 0 };
        for (const family of ALL_FAMILIES) {
            const { compared, skipped, rejected } = runFamily(family);
            totals.compared += compared;
            totals.skipped += skipped;
            totals.rejected += rejected;
            if (compared === 0 && !EXPECTED_ZERO_COMPARED.has(family.shape)) {
                hollow.push(family.shape);
            }
            if (compared > 0 && EXPECTED_ZERO_COMPARED.has(family.shape)) {
                unexpectedlyCompared.push(family.shape);
            }
        }
        // 網の現在の大きさ。除外を外したとき、この数字が育つのが見える
        console.log(`differential net: compared ${totals.compared}, skipped ${totals.skipped}, rejected ${totals.rejected} over ${ALL_FAMILIES.length} families`);
        // 除外が網を黙って食い尽くしていないこと
        expect(hollow).toEqual([]);
        // 全除外と宣言した family が比較され始めたら、宣言のほうを直す
        expect(unexpectedlyCompared).toEqual([]);
    });

    it('pins the zero-division deviation: this language fails, JS answers Infinity', () => {
        // 除外 2 の端。量子化 adapter は商を比べるが、ゼロ除算は比べる商が
        // 無い — こちらは評価失敗（発火せず・コマンド非消費）、JS は Infinity
        const diagnostics: Diagnostic[] = [];
        const tokens = tokenize('1 / 0');
        const expr = parseExpr(new TokenCursor(tokens.tokens), diagnostics, 'block');
        expect(diagnostics).toEqual([]);
        expect(() => evalExpr(expr!, freshContext())).toThrow(EvalError);
        expect(evalJs('1 / 0')).toEqual({ ok: true, value: Infinity });
    });
});
