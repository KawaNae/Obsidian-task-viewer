import type { Diagnostic } from '../../lang/Diagnostic';
import type { DateTimeRule } from '../../../types';
import type { ParserChain } from '../strategies/ParserChain';
import { readLineDateBlock, spansForRule } from './DateBlock';

/**
 * Editor-facing diagnostics for the `@start>end>due` date block of a
 * single line. Runs the REAL parser chain, so ownership (a day-planner /
 * tasks-plugin line is never decorated) and validation verdicts are — by
 * construction — identical to what the scanner attaches to
 * Task.validation. The spans come from the parser's own reading of the
 * block (`readLineDateBlock`); only the rule-to-span mapping is local.
 *
 * The line parser's verdict is the line's own (a date rule or the block's
 * parse error): the command's diagnostics are the extraction's to add, and
 * the flow half of the diagnostics extension decorates them.
 *
 * Diagnostic.message carries the final localized tooltip text
 * (message + hint); diagnosticText() falls back to it because date rules
 * have no `flowDiag.*` entry.
 */
export function dateBlockDiagnostics(lineText: string, parsers: ParserChain): Diagnostic[] {
    const loc = readLineDateBlock(lineText);
    if (!loc) return []; // every date validation requires a block — no false negatives

    const task = parsers.parse(lineText, '', 0);
    if (!task || task.parserId !== 'tv-inline' || !task.validation) return [];

    const { rule, severity, message, hint } = task.validation;
    const text = hint ? `${message}\n${hint}` : message;
    return spansForRule(rule as DateTimeRule | 'parse-error', loc).map(span => ({
        severity,
        code: rule,
        message: text,
        span,
    }));
}
