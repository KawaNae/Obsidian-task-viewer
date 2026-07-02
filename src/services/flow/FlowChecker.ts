import { Diagnostic, error } from '../lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../lang/ExprChecker';
import { StaticType, isDatishType } from '../lang/functions';
import { FlowProgram } from './FlowAst';

/**
 * Structural + type validation of a parsed FlowProgram. Runs inside
 * parseFlow(); any error diagnostic forces program = null (raw text is
 * preserved by the caller for round-trip safety).
 */
export function checkFlow(program: FlowProgram, diagnostics: Diagnostic[]): void {
    // Modifiers of the generation step require a schedule to modify.
    if (!program.schedule) {
        for (const key of ['lifetime', 'until', 'nochildren', 'set'] as const) {
            const node = program[key];
            if (node) {
                diagnostics.push(error('flow.orphan-modifier',
                    `'${key === 'lifetime' ? 'xN' : key}' requires a schedule clause (every / + / at)`, node.span));
            }
        }
        if (!program.move && !program.lifetime && !program.until && !program.nochildren && !program.set) {
            // Empty program (e.g. `==>` followed by prose that failed earlier,
            // or nothing at all). Only flag when no diagnostics explain it yet.
            if (diagnostics.length === 0) {
                diagnostics.push(error('flow.empty', 'Flow command is empty', { start: 0, end: 0 }));
            }
        }
    }

    if (program.until && !isValidDateString(program.until.date)) {
        diagnostics.push(error('flow.bad-date', `'${program.until.date}' is not a valid calendar date`, program.until.span));
    }

    if (program.schedule?.kind === 'at') {
        const t = checkExpr(program.schedule.expr, FLOW_TYPE_ENV, diagnostics);
        if (t !== 'error' && !isDatishType(t)) {
            diagnostics.push(error('type.mismatch', `at() expects a date or datetime expression, got ${t}`, program.schedule.expr.span));
        }
    }

    if (program.set) {
        for (const a of program.set.assignments) {
            const t = checkExpr(a.expr, FLOW_TYPE_ENV, diagnostics);
            if (t === 'error') continue;
            const expected: (t: StaticType) => boolean =
                a.field === 'content' ? (x => x === 'string') : isDatishType;
            if (!expected(t)) {
                diagnostics.push(error('type.mismatch',
                    `set(${a.field}: ...) expects ${a.field === 'content' ? 'string' : 'date or datetime'}, got ${t}`, a.expr.span));
            }
        }
    }

    if (program.move) {
        const t = checkExpr(program.move.target, FLOW_TYPE_ENV, diagnostics);
        if (t !== 'error' && t !== 'link' && t !== 'string') {
            diagnostics.push(error('type.mismatch', `move() expects a wikilink or string target, got ${t}`, program.move.target.span));
        }
    }
}

function isValidDateString(s: string): boolean {
    const [y, m, d] = s.split('-').map(n => parseInt(n, 10));
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
