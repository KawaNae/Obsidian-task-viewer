import type { Diagnostic } from '../../lang/Diagnostic';
import type { DateTimeRule } from '../../../types';
import { TaskParser } from '../TaskParser';
import { locateDateBlock, spansForRule } from './DateBlockLocator';

/**
 * Editor-facing diagnostics for the `@start>end>due` date block of a
 * single line. Runs the REAL parser chain, so ownership (a day-planner /
 * tasks-plugin line is never decorated) and validation verdicts are — by
 * construction — identical to what the scanner attaches to
 * Task.validation. Only the span mapping is local.
 *
 * Flow-origin validations (dot-namespaced codes) are skipped here: the
 * flow half of the diagnostics extension already decorates those with
 * proper multi-line spans.
 *
 * Diagnostic.message carries the final localized tooltip text
 * (message + hint); diagnosticText() falls back to it because date rules
 * have no `flowDiag.*` entry.
 */
export function dateBlockDiagnostics(lineText: string): Diagnostic[] {
    const loc = locateDateBlock(lineText);
    if (!loc) return []; // every date validation requires a block — no false negatives

    const task = TaskParser.parse(lineText, '', 0);
    if (!task || task.parserId !== 'tv-inline' || !task.validation) return [];

    const { rule, severity, message, hint } = task.validation;
    if (rule.includes('.')) return []; // flow/lex/expr/type — flow decorations own these

    const text = hint ? `${message}\n${hint}` : message;
    return spansForRule(rule as DateTimeRule | 'parse-error', loc).map(span => ({
        severity,
        code: rule,
        message: text,
        span,
    }));
}
