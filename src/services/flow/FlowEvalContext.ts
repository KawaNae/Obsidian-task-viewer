import type { Task } from '../../types';
import type { PropName } from '../lang/ExprAst';
import { type EvalContext } from '../lang/ExprEvaluator';
import { formatDateBlock } from '../parsing/tv-inline/DateBlockFormat';
import { type Value, valueToDisplay } from '../lang/Value';
import { type FlowPlanDeps } from './FlowPlanner';

export function buildEvalContext(task: Task, deps: FlowPlanDeps): EvalContext {
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
