import { differenceInCalendarDays } from 'date-fns';
import type { Task, TaskFlow } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { TIMER_ICON_PREFIX_RE } from '../../utils/TimerIcons';
import type { Diagnostic } from '../lang/Diagnostic';
import type { PropName } from '../lang/ExprAst';
import { type EvalContext, EvalError, evalExpr } from '../lang/ExprEvaluator';
import type { EvalHost, StaticType } from '../lang/functions';
import type { CellStore } from '../lang/StmtEvaluator';
import { type Value, isDatishValue, parseDateStr, valueToDisplay } from '../lang/Value';
import type { GenBlock } from '../parsing/gen/GenBlockCollector';
import { parseGenBody } from '../parsing/gen/GenBodyParser';
import { renderGenBody } from '../parsing/gen/GenBodyRenderer';
import { TaskParser } from '../parsing/TaskParser';
import { formatDateBlock } from '../parsing/tv-inline/DateBlockFormat';
import type { GeneratedChild } from '../persistence/TaskCloner';
import { type FlowProgram, SET_FIELD_ORDER, isCellValue } from './FlowAst';
import type { FlowEffect } from './FlowEffects';
import { checkGeneratedChildLine, checkGeneratedParentLine } from './GeneratedLineCheck';
import { flowRaws, joinSegments } from './FlowSegments';
import { serializeFlowLines } from './FlowSerializer';
import { type DateAnchor, type NextOccurrence, nextOccurrence } from './ScheduleEngine';

export interface FlowPlanDeps {
    /** Local calendar date of "now" (YYYY-MM-DD). */
    today: string;
    /** Local date+time of "now". */
    now: { date: string; time: string };
    weekStartDay: 0 | 1;
    host: EvalHost;
    /**
     * A generation block by name, resolved within the firing task's own file.
     *
     * Injected rather than read here, so the planner stays pure. It has to
     * happen during planning all the same: the name is an expression, so it
     * is not known until the plan runs, and a name that answers to nothing
     * must stop the fire — which is only sayable by emitting no effects.
     */
    getBlock: (filePath: string, name: string) => GenBlock | undefined;
}

/**
 * A fire that cannot produce its next instance.
 *
 * Thrown, and caught where EvalError is caught, because both mean the same
 * thing downstream: write nothing, leave the command in place. It is a type
 * of its own for the message — a name that answers to no block is not an
 * expression that failed, and the difference is what the reader has to act
 * on.
 */
export class GenerationError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly params?: Diagnostic['params'],
        /**
         * A diagnostic quoted inside the message.
         *
         * The sentence carries another sentence — the block's own complaint —
         * and that one has a translation of its own. Kept as the diagnostic
         * rather than as the text it came to, so the reader gets both halves
         * in one language (see services/flow/runtimeText.ts).
         */
        public readonly inner?: Diagnostic,
    ) {
        super(message);
        this.name = 'GenerationError';
    }
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

        let withinUntil = true;
        if (program.until) {
            const untilVal = evalExpr(program.until.expr, preCtx);
            if (!isDatishValue(untilVal)) {
                throw new EvalError('eval.until-not-datish',
                    `until() must produce a date or datetime, got ${untilVal.type}`,
                    program.until.expr.span, { actual: untilVal.type });
            }
            const untilDate = untilVal.type === 'date' ? untilVal.value : untilVal.date;
            withinUntil = next.date <= untilDate;
        }
        const hasLife = !program.lifetime || program.lifetime.count >= 1;

        if (withinUntil && hasLife) {
            const newTask = buildNextTask(task, anchor, next);
            applySet(newTask, program, deps);

            // The block is only consulted when something is generated. A
            // fire that has run out of until or telomere writes no next
            // instance, and holding its command hostage to a name it no
            // longer needs would leave expired commands on the page forever.
            if (program.use) {
                effects.push(planGenerated(task, newTask, program, preCtx, deps));
            } else {
                // Without a block there are no children to write. The live
                // ones are what the instance that fired did, not a
                // description of what the next one should hold, and telling
                // those apart was never possible while one copy rule
                // covered both.
                newTask.flow = nextFlow(program, task.flow!);
                effects.push({ kind: 'create-next', newTask });
            }
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
// Generation
// ---------------------------------------------------------------------------

/**
 * The one static error a fire may ignore.
 *
 * Order is the only structural verdict the render can overturn. A line that
 * is nothing but an interpolation is placed by its value, so a block whose
 * parent is written below such a line reads as out of order and renders
 * perfectly well: the parent comes back at depth 0 and the value's lines
 * below it. Refusing to fire on a squiggle the editor has already drawn
 * would be the harsher of two answers, and the wrong one.
 *
 * The rest stay blocking, and two of them for a reason worth stating: when
 * a block has more than one line at depth 0, the parse keeps the first and
 * drops the others — they are neither the parent nor children. The render
 * never sees them, so it cannot decide anything about them, and firing
 * would write an instance with lines silently missing.
 *
 * The rule underneath, for whoever adds the next diagnostic: a fire may
 * proceed when the parse drops no line. Anything the render still holds it
 * can judge for itself; anything the parse threw away it cannot.
 */
const RENDER_DECIDES = new Set(['gen.root-not-first']);

/**
 * Turn a block into the lines of the next instance.
 *
 * The order is load-bearing. The block's parent line is checked while it is
 * still the text the block wrote; the flow clause goes on afterwards.
 * Reversed, the check would meet the `==>` the engine had just added and
 * refuse the instance for carrying a command nobody wrote.
 *
 * Everything that can go wrong here throws, and a throw means the task does
 * not fire and does not consume its command. That is only honest while
 * nothing has been written, which is why all of it happens before the effect
 * exists.
 */
function planGenerated(
    task: Task,
    newTask: Task,
    program: FlowProgram,
    preCtx: EvalContext,
    deps: FlowPlanDeps,
): FlowEffect {
    const name = evalExpr(program.use!.name, preCtx);
    if (name.type !== 'string') {
        throw new GenerationError('eval.use-name-not-string',
            `use() names a block with a string, got ${name.type}`, { actual: name.type });
    }

    const block = deps.getBlock(task.file, name.value);
    if (!block) {
        throw new GenerationError('eval.no-such-block',
            `No generation block named '${name.value}' in this file`, { name: name.value });
    }

    // A copy per fire. The block writes into this one, and a fire that fails
    // before it is read leaves the command holding what it held.
    const cells: CellStore = new Map(
        program.cells?.entries.map((c): [string, Value] => [c.name, c.value]));

    const body = parseGenBody(block.body, block.openLine + 1, cellTypes(cells));
    const broken = body.diagnostics.find(
        d => d.severity === 'error' && !RENDER_DECIDES.has(d.code));
    if (broken) {
        throw new GenerationError('eval.block-cannot-generate',
            `The block '${name.value}' cannot generate: ${broken.message}`,
            { name: name.value, reason: broken.message }, broken);
    }

    // Dates come from the new instance and content from the one that fired,
    // which is what the post-shift context already holds — the same snapshot
    // the setter clauses evaluate against.
    const rendered = renderGenBody(body, { ...buildEvalContext(newTask, deps), cells });
    if (!rendered.ok) throw new GenerationError(rendered.error.code, rendered.error.message, rendered.error.params);

    // After the block, not before: what the cells came to is only known now,
    // and this is the step that prints it.
    newTask.flow = nextFlow(withWrittenCells(program, rendered.cells), task.flow!);

    const warnings: Diagnostic[] = [];
    return {
        kind: 'create-generated',
        parentLine: composeParentLine(rendered.parentText, newTask, warnings),
        flowLines: (newTask.flow?.childSegments ?? []).map(s => s.raw),
        children: rendered.children.map(child => checkedChild(child)),
        warnings,
    };
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * What the block is told the cells hold, so it can be checked against them.
 *
 * The type is read off the value each generation starts from, which is the
 * only type there is: a cell is declared by what is written in it, and the
 * next generation is declared by what the last one wrote.
 */
function cellTypes(cells: CellStore): ReadonlyMap<string, StaticType> {
    const types = new Map<string, StaticType>();
    for (const [name, value] of cells) {
        // Neither can be declared, so neither is a type a cell ever announces.
        if (value.type === 'array' || value.type === 'record') continue;
        types.set(name, value.type);
    }
    return types;
}

/**
 * The command the next instance carries, with the cells the block wrote.
 *
 * The values are checked one last time here, where a list can finally appear:
 * the written literal could not be one, but an assignment in the block can.
 * Refusing at this point costs nothing that was going to be kept — no effect
 * exists yet — and the alternative is a command the next scan cannot read.
 */
function withWrittenCells(program: FlowProgram, written: ReadonlyMap<string, Value>): FlowProgram {
    if (!program.cells) return program;
    const entries = program.cells.entries.map(cell => {
        const value = written.get(cell.name) ?? cell.value;
        if (!isCellValue(value)) {
            throw new GenerationError('eval.cell-not-storable',
                `The cell '${cell.name}' ended as ${value.type}, which cannot be written back to the command`,
                { name: cell.name, actual: value.type });
        }
        return { ...cell, value };
    });
    return { ...program, cells: { ...program.cells, entries } };
}

/**
 * The task line of the new instance: what the block wrote, or the shifted
 * task when the block wrote no parent line.
 *
 * Both roads end in one string so the write layer never learns that a block
 * can leave the parent out. The clause is spelled the way format() spells
 * it, since these are two ways of writing the same line.
 *
 * Corrections collect into `warnings`. A status the block wrote as done is
 * dropped here and nowhere else, so this is the only place that can say the
 * written line differs from the described one.
 */
function composeParentLine(
    parentText: string | null,
    newTask: Task,
    warnings: Diagnostic[],
): string {
    if (parentText === null) return TaskParser.format(newTask).trim();

    const checked = checkGeneratedParentLine(parentText);
    // The line check speaks in diagnostics, and its sentence is the whole of
    // what went wrong here, so the code travels as it is — `runtimeText` looks
    // a diagnostic's code up where diagnostics keep their translations.
    if (!checked.ok) throw new GenerationError(checked.error.code, checked.error.message, checked.error.params);
    warnings.push(...checked.warnings);
    return checked.line + (newTask.flow?.raw ? ` ==> ${newTask.flow.raw}` : '');
}

function checkedChild(child: { depth: number; body: string }): GeneratedChild {
    const checked = checkGeneratedChildLine(child.body);
    if (!checked.ok) throw new GenerationError(checked.error.code, checked.error.message, checked.error.params);
    // A net, not a rule: the renderer splits multi-line values into lines of
    // their own, so one arriving here would mean that promise broke. The
    // write layer treats an element as a line and would emit the rest of it
    // without indentation, which reads as a different tree than the one the
    // block described.
    if (checked.line.includes('\n')) {
        throw new GenerationError('eval.gen-child-line-break',
            'A generated line cannot contain a line break');
    }
    return { depth: child.depth, body: checked.line };
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
        blockId: undefined,
        timerTargetId: undefined,
        // タイマーのアイコンは記法に準ずる目印なので次インスタンスへ持ち越さない。
        // 一覧の単一情報源は TimerIcons — ここに直接書くと、付ける側に足した
        // アイコンが剥がす側から漏れる（`🔁` が実際に漏れていた）。
        content: task.content.replace(TIMER_ICON_PREFIX_RE, ''),
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
    if (!program.sets) return;

    // All RHS evaluate against the same post-shift snapshot, then apply at
    // once — setter order carries no meaning (matches order-free syntax).
    const postCtx = buildEvalContext(newTask, deps);
    const results = SET_FIELD_ORDER
        .filter(field => program.sets![field])
        .map(field => ({ field, value: evalExpr(program.sets![field]!.expr, postCtx) }));

    for (const { field, value } of results) {
        switch (field) {
            case 'content':
                newTask.content = value.type === 'none' ? '' : valueToDisplay(value);
                break;
            case 'start':
                if (value.type === 'none') {
                    newTask.startDate = undefined;
                    newTask.startTime = undefined;
                } else if (value.type === 'datetime') {
                    newTask.startDate = value.date;
                    newTask.startTime = value.time;
                } else if (value.type === 'date') {
                    newTask.startDate = value.value;
                    newTask.startTime = undefined;
                }
                break;
            case 'startTime':
                if (value.type === 'none') {
                    newTask.startTime = undefined;
                } else if (value.type === 'time' && newTask.startDate) {
                    newTask.startTime = value.value;
                }
                break;
            case 'end':
                if (value.type === 'none') {
                    newTask.endDate = undefined;
                    newTask.endTime = undefined;
                } else if (value.type === 'datetime') {
                    newTask.endDate = value.date;
                    newTask.endTime = value.time;
                } else if (value.type === 'date') {
                    newTask.endDate = value.value;
                    newTask.endTime = undefined;
                }
                break;
            case 'endTime':
                if (value.type === 'none') {
                    newTask.endTime = undefined;
                } else if (value.type === 'time' && newTask.endDate) {
                    newTask.endTime = value.value;
                }
                break;
            case 'due':
                if (value.type === 'none') {
                    newTask.due = undefined;
                } else if (value.type === 'datetime') {
                    newTask.due = `${value.date}T${value.time}`;
                } else if (value.type === 'date') {
                    newTask.due = value.value;
                }
                break;
            case 'dueTime':
                if (newTask.due) {
                    const dueDate = newTask.due.split('T')[0];
                    if (value.type === 'none') {
                        newTask.due = dueDate;
                    } else if (value.type === 'time') {
                        newTask.due = `${dueDate}T${value.value}`;
                    }
                }
                break;
        }
    }
}

// ---------------------------------------------------------------------------
// Telomere & flow inheritance
// ---------------------------------------------------------------------------

/**
 * The command the next instance carries, or undefined when the chain ends
 * here.
 *
 * Returned rather than assigned, so that where it is called is decided by
 * what it needs rather than by where the line happens to sit. A generated
 * instance calls it after its block has run, which will matter as soon as
 * the clause has to print values the block decides.
 */
function nextFlow(program: FlowProgram, originalFlow: TaskFlow): TaskFlow | undefined {
    let nextProgram = program;
    if (program.lifetime) {
        const remaining = program.lifetime.count - 1;
        if (remaining <= 0) {
            // x1 fired: the final instance carries no command at all
            // (the extreme case of "an emptied segment loses its line").
            return undefined;
        }
        nextProgram = { ...program, lifetime: { ...program.lifetime, count: remaining } };
    }

    // Line-level canonical inheritance: each node keeps the line the user
    // wrote it on (derived from its span via the original segment table —
    // the lifetime spread above preserves spans), while line contents are
    // regenerated in canonical order.
    const { table } = joinSegments(flowRaws(originalFlow));
    const lines = serializeFlowLines(nextProgram, table);
    return {
        raw: lines.taskLine,
        childSegments: lines.childLines.map(raw => ({ raw, bodyLine: -1 })),
        program: nextProgram,
        diagnostics: [],
    };
}

// ---------------------------------------------------------------------------
// Evaluation context
// ---------------------------------------------------------------------------

function buildEvalContext(task: Task, deps: FlowPlanDeps): EvalContext {
    const props: Partial<Record<PropName, Value>> = {
        content: { type: 'string', value: task.content },
        'file.name': { type: 'string', value: fileName(task.file) },
        // Completion moment, two granularities: `done` carries the clock
        // (at(done + 2h)), `today` is the plain calendar date (at(today + 3d))
        // so day-granular offsets don't smear the completion time onto tasks.
        done: { type: 'datetime', date: deps.now.date, time: deps.now.time },
        today: { type: 'date', value: deps.today },
        // The whole date block, built where the line formatter builds it. A
        // block that writes the next instance is the only author of its line,
        // so `@${start}` is how an end and a due disappear without a word;
        // this is the one string that carries all of them.
        dates: { type: 'string', value: formatDateBlock(task) },
    };
    if (task.startDate) props.start = datish(task.startDate, task.startTime);
    if (task.endDate) props.end = datish(task.endDate, task.endTime);
    if (task.due) {
        const [date, time] = task.due.split('T');
        props.due = datish(date, time);
    }
    return { props, today: deps.today, now: deps.now, weekStartDay: deps.weekStartDay, host: deps.host };
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
