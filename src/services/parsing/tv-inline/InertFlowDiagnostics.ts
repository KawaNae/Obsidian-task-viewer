import type { Diagnostic, Span } from '../../lang/Diagnostic';
import { warning } from '../../lang/Diagnostic';
import { isDpInline, isTpInline } from '../../../types';
import { TaskParser } from '../TaskParser';

/** Notation of a line whose `==>` never fires, or null when it does fire. */
export type InertNotation = 'day-planner' | 'tasks-plugin';

/** Display name per notation — the value interpolated into the message. */
const NOTATION_LABEL: Record<InertNotation, string> = {
    'day-planner': 'Day Planner',
    'tasks-plugin': 'Tasks',
};

/**
 * Which notation owns this task line, when that notation makes a flow
 * command inert.
 *
 * Read-only notations never fire (`canTriggerFlow` requires tv-inline) and
 * their parsers do not split the `==>` tail off either, so the command ends
 * up inside the task's content and shows up as part of its name. Nothing in
 * the note says so, which is what this diagnostic is for.
 *
 * The judgment runs the REAL parser chain, so it follows the settings: turn
 * Day Planner off and the same line becomes a tv-inline task whose command
 * does fire — and the warning disappears on its own.
 */
export function inertNotationOf(lineText: string): InertNotation | null {
    const task = TaskParser.parse(lineText, '', 0);
    if (!task) return null;
    if (isDpInline(task)) return 'day-planner';
    if (isTpInline(task)) return 'tasks-plugin';
    return null;
}

/** The warning for one inert `==>` segment, spanning marker to line end. */
export function inertFlowDiagnostic(notation: InertNotation, span: Span): Diagnostic {
    const label = NOTATION_LABEL[notation];
    return warning(
        'flow.inert-notation',
        `This line is read as ${label} notation, so the \`==>\` command never runs — it stays part of the task name`,
        span,
        { notation: label },
    );
}
