import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import { BudgetError, type EvalContext, EvalError, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { tokenize } from '../../../src/services/lang/Lexer';
import { checkProgram } from '../../../src/services/lang/StmtChecker';
import { execProgram } from '../../../src/services/lang/StmtEvaluator';
import { parseProgram } from '../../../src/services/lang/StmtParser';
import { TokenCursor } from '../../../src/services/lang/Token';
import type { Value } from '../../../src/services/lang/Value';
import {
    BINDINGS, PROPS, bindingTypes, bridge, deepEqual, detectProgramFeatures, freshContext,
    namesRead, runJs, show, topLevelNames,
} from './differentialHarness';
import { STATEMENT_FAMILIES, type StmtFamily, type StmtSource } from './stmtFamilies';

/**
 * The differential sweep for the js section: statements run, then one
 * expression is read against the scope they left, and both halves have to
 * mean in JS what they mean here.
 *
 * The deviation predicates are the expression sweep's, folded over every
 * expression a program holds. That sharing is the point — a decimal inside a
 * `for` head is the same decimal it would be on a line of its own, and a
 * predicate that lived on one surface only would let the same deviation be
 * excluded here and reported there.
 *
 * Three things guard against the failure mode this sweep is prone to, which
 * is not disagreeing but agreeing about nothing:
 *
 * - a `read` must look at every top-level binding its `setup` made, or say
 *   which ones it skips;
 * - this language runs first, so a corpus source that loops forever fails
 *   here instead of hanging in `new Function`, which has no budget;
 * - a source that draws a diagnostic fails the sweep rather than being
 *   quietly excluded — an unaccepted source is a corpus that shrank.
 */

/** Names that arrive as JS parameters, which a body-level `let` may not reuse. */
const RESERVED_BY_HARNESS = new Set([...Object.keys(BINDINGS), ...Object.keys(PROPS), 'none']);

const STATEMENT_BINDINGS = bindingTypes(true);

interface Outcome {
    compared: number;
    skipped: number;
    red: string[];
}

function label(source: StmtSource): string {
    return `${source.setup.replace(/\n/g, ' ; ')} ⊢ ${source.read}`;
}

function runSource(source: StmtSource, outcome: Outcome): void {
    const { program, diagnostics } = parseProgram(source.setup);
    const after = checkProgram(program, FLOW_TYPE_ENV, diagnostics, STATEMENT_BINDINGS);

    // The read is checked against what the statements left, not merely
    // parsed. Two things need that: C only covers what is checked, and the
    // deviation predicates type their operands — a read whose names came out
    // of the setup would otherwise be unknown to both.
    const readTokens = tokenize(source.read);
    const readDiagnostics: Diagnostic[] = [...readTokens.diagnostics];
    const read = parseExpr(new TokenCursor(readTokens.tokens), readDiagnostics, 'stmt');
    if (read) checkExpr(read, FLOW_TYPE_ENV, readDiagnostics, after);

    // C: an unaccepted source is a corpus that shrank, not a deviation.
    const refused = [...diagnostics, ...readDiagnostics];
    if (refused.length > 0 || !read) {
        outcome.red.push(`${label(source)} — refused: ${refused.map(d => d.code).join(', ') || 'no expression'}`);
        return;
    }

    // The harness's own accident, caught before it can look like a deviation.
    const collision = topLevelNames(program.body).filter(name => RESERVED_BY_HARNESS.has(name));
    if (collision.length > 0) {
        outcome.red.push(`${label(source)} — redeclares a bound name: ${collision.join(', ')}`);
        return;
    }

    // A: agreement about a binding nobody read is agreement about nothing.
    const seen = namesRead(read);
    const missed = topLevelNames(program.body)
        .filter(name => !seen.has(name) && !(source.unread ?? []).includes(name));
    if (missed.length > 0) {
        outcome.red.push(`${label(source)} — the read never looks at: ${missed.join(', ')}`);
        return;
    }

    const features = detectProgramFeatures(program.body, read, after);
    if (features.decimalStep || features.domain || features.strictEq || features.divisionComposed) {
        outcome.skipped++;
        return;
    }

    // B: this language first. Its budget is what turns a corpus source that
    // never ends into a red line instead of a hung `new Function`.
    const ctx: EvalContext = freshContext();
    let ours: { ok: true; value: Value } | { ok: false; thrown: string };
    // Read from the type, not from the sentence. A signal made of English
    // comes apart the next time the message is reworded, and what it guards
    // is the difference between a red line and a hung `new Function`.
    let overBudget = false;
    try {
        const scope = execProgram(program, ctx);
        ours = { ok: true, value: evalExpr(read, { ...ctx, scope }) };
    } catch (e) {
        if (!(e instanceof EvalError)) throw e;
        overBudget = e instanceof BudgetError;
        ours = { ok: false, thrown: e.message };
    }
    if (overBudget) {
        outcome.red.push(`${label(source)} — never finished: ${ours.ok ? '' : ours.thrown}`);
        return;
    }

    const js = runJs(`${source.setup}\nreturn (${source.read});`);

    outcome.compared++;
    if (ours.ok !== js.ok) {
        const ourSide = ours.ok ? show(bridge(ours.value)) : `threw "${ours.thrown}"`;
        const jsSide = js.ok ? show(js.value) : `threw "${js.thrown}"`;
        outcome.red.push(`${label(source)} — ours: ${ourSide} / js: ${jsSide}`);
        return;
    }
    if (ours.ok && js.ok
        && !deepEqual(bridge(ours.value), js.value, features.divisionRoot || features.decimalGrid)) {
        outcome.red.push(`${label(source)} — ours: ${show(bridge(ours.value))} / js: ${show(js.value)}`);
        return;
    }

    // Deviation #5, asserted rather than skipped: whatever the statements
    // did, the bindings they were handed are still what they were bound to.
    for (const [name, bound] of ctx.vars ?? []) {
        if (!deepEqual(bridge(bound), structuredClone(BINDINGS[name]), false)) {
            outcome.red.push(`${label(source)} — mutated '${name}' to ${show(bridge(bound))}`);
        }
    }
}

function runFamily(family: StmtFamily): Outcome {
    const outcome: Outcome = { compared: 0, skipped: 0, red: [] };
    for (const source of family.sources) runSource(source, outcome);
    return outcome;
}

/**
 * Families where zero comparisons is the right answer, named so their absence
 * from the net is a decision on record. One entry today: a quotient carried
 * from one statement to another is composed division, which is deviation #2
 * itself.
 */
const EXPECTED_ZERO_COMPARED = new Set(['accumulate through division']);

/**
 * The guards, exercised on sources written to trip them.
 *
 * A guard nobody has seen fire is a guard nobody knows is wired. Each of
 * these is the shape it exists to catch, and the corpus above is what it
 * looks like when none of them do.
 */
describe('the guards on the sweep itself', () => {
    const run = (source: StmtSource): Outcome => {
        const outcome: Outcome = { compared: 0, skipped: 0, red: [] };
        runSource(source, outcome);
        return outcome;
    };

    it('fails a source this language refuses, rather than excluding it', () => {
        // The read is checked too, so a comparison across types is caught
        // where it is written instead of being compared against JS's coercion.
        expect(run({ setup: 'let cnt = 1', read: 'cnt == "1"' }).red[0]).toContain('type.cannot-compare');
        expect(run({ setup: 'let cnt = nope', read: 'cnt' }).red[0]).toContain('expr.unknown-ident');
    });

    it('fails a read that never looks at what the setup wrote', () => {
        expect(run({ setup: 'let one = 1\nlet two = 2', read: 'one' }).red[0])
            .toContain('never looks at: two');
        // Unless it says so.
        expect(run({ setup: 'let one = 1\nlet two = 2', read: 'one', unread: ['two'] }).red).toEqual([]);
    });

    it('fails a source that redeclares a name the harness binds', () => {
        // This language reads it as a shadow and JS as a redeclaration over a
        // parameter. A SyntaxError on one side only is a harness accident
        // wearing a deviation's clothes.
        expect(run({ setup: 'let n = 0', read: 'n' }).red[0]).toContain('redeclares a bound name: n');
    });

    it('fails a source that never finishes, before JS is asked to run it', () => {
        expect(run({ setup: 'let k = 0\nwhile (true) { k = k + 1 }', read: 'k' }).red[0])
            .toContain('never finished');
    });
});

describe('differential sweep of the js section', () => {
    it('agrees with JS everywhere no documented deviation applies', () => {
        expect(STATEMENT_FAMILIES.flatMap(family => runFamily(family).red)).toEqual([]);
    });

    it('keeps the net from going hollow, family by family', () => {
        const hollow: string[] = [];
        const unexpectedlyCompared: string[] = [];
        const totals = { compared: 0, skipped: 0 };

        for (const family of STATEMENT_FAMILIES) {
            const outcome = runFamily(family);
            totals.compared += outcome.compared;
            totals.skipped += outcome.skipped;
            const expectedZero = EXPECTED_ZERO_COMPARED.has(family.shape);
            if (outcome.compared === 0 && !expectedZero) hollow.push(family.shape);
            if (outcome.compared > 0 && expectedZero) unexpectedlyCompared.push(family.shape);
        }

        expect(hollow).toEqual([]);
        // A family that starts comparing comes off the list on purpose.
        expect(unexpectedlyCompared).toEqual([]);
        expect(totals.compared).toBeGreaterThan(0);
        // eslint-disable-next-line no-console
        console.log(`statement net: compared ${totals.compared}, skipped ${totals.skipped} over ${STATEMENT_FAMILIES.length} families`);
    });
});
