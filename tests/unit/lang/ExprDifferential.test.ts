import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import type { Expr } from '../../../src/services/lang/ExprAst';
import { FLOW_TYPE_ENV, type VarTypes, checkExpr } from '../../../src/services/lang/ExprChecker';
import { EvalContext, EvalError, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import type { EvalHost, StaticType } from '../../../src/services/lang/functions';
import { arrayOf, recordOf } from '../../../src/services/lang/functions';
import type { Value } from '../../../src/services/lang/Value';
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
 * they are the six predicates in `EXCLUSIONS` below, detected on the parsed
 * tree. Only a divergence no predicate claims turns red. Retiring a deviation
 * (the decimal one, when decimals land) is deleting its predicate — the net
 * widens by itself, over the whole corpus at once.
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

const VAR_TYPES: VarTypes = new Map(
    Object.entries(BINDINGS).map(([name, js]) => [name, typeOfValue(toValue(js))]));

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

/** Division carries the quotient to ten places; the comparison meets it there. */
function quantize(v: number): number {
    return Number.isInteger(v) ? v : Math.round(v * 1e10) / 1e10;
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
    /** #1 10進 — a decimal literal (today the lexer refuses them; deleting this row widens the net when they land). */
    decimal: boolean;
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

function detectFeatures(expr: Expr, src: string): Features {
    const f: Features = {
        decimal: /\d\.\d/.test(src),
        divisionRoot: false,
        divisionComposed: false,
        domain: false,
        strictEq: false,
    };
    walk(expr, f);
    // One division, and it is the whole expression: the per-operation
    // rounding and the end-of-expression rounding are then the same rounding.
    const divisions = countDivisions(expr);
    if (divisions > 0) {
        const rootIsDivision = expr.kind === 'binary' && (expr.op === '/' || expr.op === '%');
        if (divisions === 1 && rootIsDivision) f.divisionRoot = true;
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

function walk(expr: Expr, f: Features): void {
    switch (expr.kind) {
        case 'lit':
            if (['date', 'datetime', 'time', 'duration', 'link'].includes(expr.value.type)) f.domain = true;
            return;
        case 'prop':
            if (DOMAIN_PROPS.has(expr.name)) f.domain = true;
            return;
        case 'unary': return walk(expr.operand, f);
        case 'binary': {
            if (expr.op === '==' || expr.op === '!=') {
                const lt = staticTypeOf(expr.left);
                const rt = staticTypeOf(expr.right);
                const container = (t: StaticType) => typeof t === 'object';
                if (lt === 'error' || rt === 'error' || container(lt) || container(rt) || lt !== rt) {
                    f.strictEq = true;
                }
            }
            walk(expr.left, f);
            walk(expr.right, f);
            return;
        }
        case 'cond':
            walk(expr.cond, f); walk(expr.then, f); walk(expr.else, f);
            return;
        case 'call':
            if (isDomainFn(expr.fn)) f.domain = true;
            expr.args.forEach(arg => walk(arg, f));
            return;
        case 'member':
            return walk(expr.obj, f);
        case 'method':
            walk(expr.obj, f);
            expr.args.forEach(arg => walk(arg, f));
            return;
        case 'index':
            walk(expr.obj, f); walk(expr.index, f);
            return;
        case 'var': return;
        case 'arrow': return walk(expr.body, f);
        case 'array': return expr.items.forEach(item => walk(item, f));
        case 'record': return expr.entries.forEach(e => walk(e.value, f));
        case 'spread': return walk(expr.arg, f);
        case 'template':
            for (const part of expr.parts) {
                if (part.kind === 'text') {
                    // The backslash rule differs from JS (here it only escapes
                    // `${`; in JS it escapes everything), and a folded `${` in
                    // the text was live text in JS. Either mark makes the
                    // source mean two different strings.
                    if (part.text.includes('\\') || part.text.includes('${')) f.domain = true;
                } else {
                    walk(part.expr, f);
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

        const features = detectFeatures(expr, src);
        if (features.decimal || features.domain || features.strictEq || features.divisionComposed) {
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
        if (ours.ok && js.ok && !deepEqual(bridge(ours.value), js.value, features.divisionRoot)) {
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
