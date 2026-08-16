import { type Diagnostic, error } from '../lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../lang/ExprChecker';
import { isDatishType, typeName } from '../lang/functions';
import { type FlowProgram, SET_FIELD_ORDER, isCellValue, setHeadName } from './FlowAst';

/** Nodes whose field name is not what the user writes. */
const ORPHAN_CLAUSE_NAME: Partial<Record<string, string>> = { lifetime: 'xN', cells: 'let' };

/**
 * Structural + type validation of a parsed FlowProgram. Runs inside
 * parseFlow(); any error diagnostic forces program = null (raw text is
 * preserved by the caller for round-trip safety).
 */
export function checkFlow(program: FlowProgram, diagnostics: Diagnostic[]): void {
    // Modifiers of the generation step require a schedule to modify.
    if (!program.schedule) {
        for (const key of ['lifetime', 'until', 'use', 'cells'] as const) {
            const node = program[key];
            if (node) {
                const clause = ORPHAN_CLAUSE_NAME[key] ?? key;
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
        if (!program.move && !program.lifetime && !program.until && !program.use && !program.sets && !program.cells) {
            // Empty program (e.g. `==>` followed by prose that failed earlier,
            // a command that says only `nochildren`, or nothing at all). Only
            // flag when no diagnostics explain it yet — the retired clause
            // has already explained itself.
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

    if (program.cells) {
        for (const cell of program.cells.entries) {
            // The parser only admits literals, so the reading that has work to
            // do is `none`: it is written, and it is not a state anything can
            // be carried in. Lists and records arrive at the other reading of
            // this rule, where the block has run.
            if (!isCellValue(cell.value)) {
                diagnostics.push(error('type.cell-not-storable',
                    `A cell holds a number, string, bool, date, time, duration or link — '${cell.name}' holds ${cell.value.type}`,
                    cell.valueSpan, { name: cell.name, actual: cell.value.type }));
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
