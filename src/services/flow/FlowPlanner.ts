import { differenceInCalendarDays } from 'date-fns';
import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { PropName } from '../lang/ExprAst';
import { EvalContext } from '../lang/ExprEvaluator';
import { evalExpr } from '../lang/ExprEvaluator';
import { EvalHost } from '../lang/functions';
import { Value, parseDateStr, valueToDisplay } from '../lang/Value';
import { FlowProgram } from './FlowAst';
import { FlowEffect } from './FlowEffects';
import { serializeFlow } from './FlowSerializer';
import { DateAnchor, NextOccurrence, nextOccurrence } from './ScheduleEngine';

export interface FlowPlanDeps {
    /** Local calendar date of "now" (YYYY-MM-DD). */
    today: string;
    /** Local date+time of "now". */
    now: { date: string; time: string };
    weekStartDay: 0 | 1;
    host: EvalHost;
}

/**
 * Pure planning step: completion event + parsed program → effect list.
 * No I/O happens here; the FlowExecutor interprets the effects against
 * TaskRepository.
 *
 * Fire-consumes semantics: the returned effects ALWAYS remove the command
 * from the original line (strip-flow, or delete-original for move), even
 * when no next instance is generated (until expired / telomere exhausted).
 *
 * Evaluation contexts (do not mix up):
 * - at(expr) and move(target) evaluate against the PRE-shift original task.
 * - set(field: expr) evaluates against the POST-shift new instance; all
 *   right-hand sides see the same snapshot, then apply at once (no chaining).
 *
 * May throw EvalError (runtime expression failure, e.g. unset property).
 * The executor treats that as "do not fire": nothing is written and the
 * command stays intact for the user to fix.
 */
export function planFlow(task: Task, program: FlowProgram, deps: FlowPlanDeps): FlowEffect[] {
    const effects: FlowEffect[] = [];
    const preCtx = buildEvalContext(task, deps);

    if (program.schedule) {
        const anchor = resolveAnchor(task);
        const next = nextOccurrence(program.schedule, anchor, { today: deps.today, now: deps.now }, preCtx);

        const withinUntil = !program.until || next.date <= program.until.date;
        const hasLife = !program.lifetime || program.lifetime.count >= 1;

        if (withinUntil && hasLife) {
            const newTask = buildNextTask(task, anchor, next);
            applySet(newTask, program, deps);
            attachNextFlow(newTask, program);
            effects.push({ kind: 'create-next', newTask, copyChildren: !program.nochildren });
        }
    }

    if (program.move) {
        const target = evalExpr(program.move.target, preCtx);
        const destPath = normalizeDestination(target);
        const archivedTask: Task = { ...task, flow: undefined, blockId: undefined, timerTargetId: undefined };
        effects.push({ kind: 'archive-to', destPath, archivedTask });
        effects.push({ kind: 'delete-original' });
    } else {
        effects.push({ kind: 'strip-flow' });
    }

    return effects;
}

// ---------------------------------------------------------------------------
// Anchor & shift
// ---------------------------------------------------------------------------

/** Primary date of the task: start > end > due. */
export function resolveAnchor(task: Task): DateAnchor | null {
    if (task.startDate) return { date: task.startDate, time: task.startTime };
    if (task.endDate) return { date: task.endDate, time: task.endTime };
    if (task.due) {
        const [date, time] = task.due.split('T');
        return { date, time };
    }
    return null;
}

/**
 * Build the next instance: shift the whole date block by the anchor delta
 * and reset per-instance identity (same override set as the legacy
 * generation path, so blockId/timer state never leaks into copies).
 */
function buildNextTask(task: Task, anchor: DateAnchor | null, next: NextOccurrence): Task {
    const newTask: Task = {
        ...task,
        id: '',
        statusChar: ' ',
        originalText: '',
        childLines: [],
        childLineBodyOffsets: [],
        blockId: undefined,
        timerTargetId: undefined,
        content: task.content.replace(/^(?:⏱️|🍅|⏳)\s*/, ''),
    };

    if (!anchor) {
        // Dateless task: place the computed occurrence directly on start.
        newTask.startDate = next.date;
        newTask.startTime = next.time;
        return newTask;
    }

    const shiftDays = differenceInCalendarDays(parseDateStr(next.date), parseDateStr(anchor.date));

    newTask.startDate = task.startDate ? DateUtils.shiftDateString(task.startDate, shiftDays) : undefined;
    newTask.endDate = task.endDate
        ? DateUtils.shiftDateString(task.endDate, shiftDays)
        : (task.endTime && task.startDate)
            ? DateUtils.shiftDateString(task.startDate, shiftDays)
            : undefined;
    newTask.due = task.due ? DateUtils.shiftDateString(task.due, shiftDays) : undefined;

    // Minute/hour grids move the anchor field's time as well.
    if (next.time !== undefined) {
        if (task.startDate) newTask.startTime = next.time;
        else if (task.endDate) newTask.endTime = next.time;
        else if (task.due) newTask.due = `${next.date}T${next.time}`;
    }

    return newTask;
}

// ---------------------------------------------------------------------------
// set()
// ---------------------------------------------------------------------------

function applySet(newTask: Task, program: FlowProgram, deps: FlowPlanDeps): void {
    if (!program.set) return;

    // All RHS evaluate against the same post-shift snapshot, then apply at
    // once — assignment order carries no meaning (matches order-free syntax).
    const postCtx = buildEvalContext(newTask, deps);
    const results = program.set.assignments.map(a => ({ field: a.field, value: evalExpr(a.expr, postCtx) }));

    for (const { field, value } of results) {
        switch (field) {
            case 'content':
                newTask.content = valueToDisplay(value);
                break;
            case 'start':
                if (value.type === 'datetime') {
                    newTask.startDate = value.date;
                    newTask.startTime = value.time;
                } else if (value.type === 'date') {
                    newTask.startDate = value.value;
                    newTask.startTime = undefined;
                }
                break;
            case 'end':
                if (value.type === 'datetime') {
                    newTask.endDate = value.date;
                    newTask.endTime = value.time;
                } else if (value.type === 'date') {
                    newTask.endDate = value.value;
                    newTask.endTime = undefined;
                }
                break;
            case 'due':
                if (value.type === 'datetime') {
                    newTask.due = `${value.date}T${value.time}`;
                } else if (value.type === 'date') {
                    newTask.due = value.value;
                }
                break;
        }
    }
}

// ---------------------------------------------------------------------------
// Telomere & flow inheritance
// ---------------------------------------------------------------------------

function attachNextFlow(newTask: Task, program: FlowProgram): void {
    if (program.lifetime) {
        const remaining = program.lifetime.count - 1;
        if (remaining <= 0) {
            // x1 fired: the final instance carries no command at all.
            newTask.flow = undefined;
            return;
        }
        const nextProgram: FlowProgram = {
            ...program,
            lifetime: { ...program.lifetime, count: remaining },
        };
        newTask.flow = { raw: serializeFlow(nextProgram), program: nextProgram, diagnostics: [] };
        return;
    }
    // No telomere: the command is inherited as-is, re-serialized canonically.
    newTask.flow = { raw: serializeFlow(program), program, diagnostics: [] };
}

// ---------------------------------------------------------------------------
// Evaluation context
// ---------------------------------------------------------------------------

function buildEvalContext(task: Task, deps: FlowPlanDeps): EvalContext {
    const props: Partial<Record<PropName, Value>> = {
        content: { type: 'string', value: task.content },
        'file.name': { type: 'string', value: fileName(task.file) },
        done: { type: 'datetime', date: deps.now.date, time: deps.now.time },
    };
    if (task.startDate) props.start = datish(task.startDate, task.startTime);
    if (task.endDate) props.end = datish(task.endDate, task.endTime);
    if (task.due) {
        const [date, time] = task.due.split('T');
        props.due = datish(date, time);
    }
    return { props, today: deps.today, weekStartDay: deps.weekStartDay, host: deps.host };
}

function datish(date: string, time: string | undefined): Value {
    return time ? { type: 'datetime', date, time } : { type: 'date', value: date };
}

function fileName(path: string): string {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.md$/i, '');
}

// ---------------------------------------------------------------------------
// move destination
// ---------------------------------------------------------------------------

/**
 * Normalize a move() target into a vault path: sanitize Windows-invalid
 * characters per segment and ensure the .md extension (ported from the
 * legacy MoveCommand).
 */
export function normalizeDestination(target: Value): string {
    let dest = target.type === 'link' ? target.target : valueToDisplay(target);
    dest = dest.replace(/^\[\[/, '').replace(/\]\]$/, '').trim();
    dest = dest.replace(/\\/g, '/');
    dest = dest.split('/').map(segment => segment.replace(/[<>:"|?*#]/g, '_')).join('/');
    if (!dest.toLowerCase().endsWith('.md')) dest += '.md';
    return dest;
}
