import { Diagnostic, error } from '../lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../lang/ExprChecker';
import { isDatishType } from '../lang/functions';
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
                const clause = key === 'lifetime' ? 'xN' : key;
                diagnostics.push(error('flow.orphan-modifier',
                    `'${clause}' requires a schedule clause (every / + / at)`, node.span, { clause }));
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
        diagnostics.push(error('flow.bad-date', `'${program.until.date}' is not a valid calendar date`, program.until.span,
            { date: program.until.date }));
    }

    if (program.schedule?.kind === 'at') {
        const t = checkExpr(program.schedule.expr, FLOW_TYPE_ENV, diagnostics);
        if (t !== 'error' && !isDatishType(t)) {
            diagnostics.push(error('type.at-not-datish', `at() expects a date or datetime expression, got ${t}`,
                program.schedule.expr.span, { actual: t }));
        }
    }

    if (program.set) {
        for (const a of program.set.assignments) {
            const t = checkExpr(a.expr, FLOW_TYPE_ENV, diagnostics);
            if (t === 'error') continue;
            if (a.field === 'content') {
                if (t !== 'string') {
                    diagnostics.push(error('type.set-content-not-string',
                        `set(content: ...) expects string, got ${t}`, a.expr.span, { actual: t }));
                }
            } else if (!isDatishType(t)) {
                diagnostics.push(error('type.set-date-mismatch',
                    `set(${a.field}: ...) expects date or datetime, got ${t}`, a.expr.span, { field: a.field, actual: t }));
            }
        }
    }

    if (program.move) {
        const t = checkExpr(program.move.target, FLOW_TYPE_ENV, diagnostics);
        if (t !== 'error' && t !== 'link' && t !== 'string') {
            diagnostics.push(error('type.move-target', `move() expects a wikilink or string target, got ${t}`,
                program.move.target.span, { actual: t }));
        }
    }
}

function isValidDateString(s: string): boolean {
    const [y, m, d] = s.split('-').map(n => parseInt(n, 10));
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
