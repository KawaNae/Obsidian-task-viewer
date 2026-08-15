import { type Diagnostic, error } from '../lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../lang/ExprChecker';
import { isDatishType, typeName } from '../lang/functions';
import { type FlowProgram, SET_FIELD_ORDER, setHeadName } from './FlowAst';

/**
 * Structural + type validation of a parsed FlowProgram. Runs inside
 * parseFlow(); any error diagnostic forces program = null (raw text is
 * preserved by the caller for round-trip safety).
 */
export function checkFlow(program: FlowProgram, diagnostics: Diagnostic[]): void {
    // Modifiers of the generation step require a schedule to modify.
    if (!program.schedule) {
        for (const key of ['lifetime', 'until', 'nochildren', 'use'] as const) {
            const node = program[key];
            if (node) {
                const clause = key === 'lifetime' ? 'xN' : key;
                diagnostics.push(error('flow.orphan-modifier',
                    `'${clause}' requires a schedule clause (every / + / at)`, node.span, { clause }));
            }
        }
        for (const field of SET_FIELD_ORDER) {
            const node = program.sets?.[field];
            if (node) {
                const clause = setHeadName(field);
                diagnostics.push(error('flow.orphan-modifier',
                    `'${clause}' requires a schedule clause (every / + / at)`, node.span, { clause }));
            }
        }
        if (!program.move && !program.lifetime && !program.until && !program.nochildren && !program.use && !program.sets) {
            // Empty program (e.g. `==>` followed by prose that failed earlier,
            // or nothing at all). Only flag when no diagnostics explain it yet.
            if (diagnostics.length === 0) {
                diagnostics.push(error('flow.empty', 'Flow command is empty', { start: 0, end: 0 }));
            }
        }
    }

    if (program.until) {
        const t = checkExpr(program.until.expr, FLOW_TYPE_ENV, diagnostics);
        if (t !== 'error' && !isDatishType(t)) {
            diagnostics.push(error('type.until-not-datish',
                `until() expects a date or datetime expression, got ${typeName(t)}`,
                program.until.expr.span, { actual: typeName(t) }));
        }
    }

    if (program.schedule?.kind === 'at') {
        const t = checkExpr(program.schedule.expr, FLOW_TYPE_ENV, diagnostics);
        if (t !== 'error' && !isDatishType(t)) {
            diagnostics.push(error('type.at-not-datish', `at() expects a date or datetime expression, got ${typeName(t)}`,
                program.schedule.expr.span, { actual: typeName(t) }));
        }
    }

    if (program.sets) {
        const TIME_FIELDS: readonly string[] = ['startTime', 'endTime', 'dueTime'];
        for (const field of SET_FIELD_ORDER) {
            const node = program.sets[field];
            if (!node) continue;
            const t = checkExpr(node.expr, FLOW_TYPE_ENV, diagnostics);
            if (t === 'error') continue;
            const fn = setHeadName(field);
            if (field === 'content') {
                if (t !== 'string' && t !== 'none') {
                    diagnostics.push(error('type.set-content-not-string',
                        `${fn}(...) expects string or none, got ${typeName(t)}`, node.expr.span, { fn, actual: typeName(t) }));
                }
            } else if (TIME_FIELDS.includes(field)) {
                if (t !== 'time' && t !== 'none') {
                    diagnostics.push(error('type.set-time-mismatch',
                        `${fn}(...) expects time or none, got ${typeName(t)}`, node.expr.span, { fn, actual: typeName(t) }));
                }
            } else {
                if (!isDatishType(t) && t !== 'none') {
                    diagnostics.push(error('type.set-date-mismatch',
                        `${fn}(...) expects date, datetime or none, got ${typeName(t)}`, node.expr.span, { fn, actual: typeName(t) }));
                }
            }
        }
    }

    if (program.use) {
        const t = checkExpr(program.use.name, FLOW_TYPE_ENV, diagnostics);
        if (t !== 'error' && t !== 'string') {
            diagnostics.push(error('type.use-name', `use() expects a block name as a string, got ${typeName(t)}`,
                program.use.name.span, { actual: typeName(t) }));
        }
    }

    if (program.move) {
        const t = checkExpr(program.move.target, FLOW_TYPE_ENV, diagnostics);
        if (t !== 'error' && t !== 'link' && t !== 'string') {
            diagnostics.push(error('type.move-target', `move() expects a wikilink or string target, got ${typeName(t)}`,
                program.move.target.span, { actual: typeName(t) }));
        }
    }
}
