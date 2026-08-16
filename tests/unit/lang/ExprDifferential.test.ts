import { describe, expect, it } from 'vitest';
import { EvalError, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import type { Value } from '../../../src/services/lang/Value';
import {
    BINDINGS, VAR_TYPES, bridge, deepEqual, detectFeatures, evalJs, freshContext, show,
} from './differentialHarness';
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
 * they are the six predicates on `Features` in the shared harness, detected on
 * the parsed tree. Only a divergence no predicate claims turns red. When a
 * deviation shrinks, its predicate shrinks with it and the net widens over the
 * whole corpus at once — decimals did exactly this when they landed: the skip
 * became a grid comparison, and only the discontinuous consumers stayed out.
 *
 * The corpus is `exprFamilies.ts`, shared with the round-trip sweep: a family
 * added there is measured for printing and for meaning on the same day. The
 * statements of a js section are swept by `StmtDifferential.test.ts`, on the
 * same harness.
 */

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
