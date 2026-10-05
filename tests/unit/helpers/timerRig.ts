import type { Task } from '../../../src/types';
import { TimerContentBinding } from '../../../src/timer/TimerContentBinding';
import { TimerLifecycle } from '../../../src/timer/TimerLifecycle';
import { TimerRuntime } from '../../../src/timer/TimerRuntime';
import { TimerWidget } from '../../../src/timer/TimerWidget';
import { restart } from '../../../src/timer/TimerClock';
import { pomodoroGroups, START_CURSOR } from '../../../src/timer/IntervalMath';
import type { Measure } from '../../../src/timer/TimerProgress';
import { newTimerId, type RecordMode, type TimerState } from '../../../src/timer/TimerState';
import { getTaskDisplayName } from '../../../src/services/display/TaskContent';
import type { VaultSession } from './vaultSession';

/**
 * The widget's parts over a vault session, as `TimerWidget` wires them, but
 * on the session's board and recorder: a lifecycle, its runtime and the name
 * binding. Nothing is drawn.
 */
export function timerRig(s: VaultSession) {
    const runtime = new TimerRuntime();
    const content = new TimerContentBinding(s.plugin as never, s.board, s.recorder);
    const lifecycle = new TimerLifecycle({ board: s.board, runtime, recorder: s.recorder, content, renderTimes: () => { } });
    return { board: s.board, recorder: s.recorder, runtime, content, lifecycle };
}

export type TimerRig = ReturnType<typeof timerRig>;

/** What a timer measures, as the start command takes it. */
export type MeasureKind = 'countup' | 'pomodoro' | { countdown: number };

export function measureOf(kind: MeasureKind, work = 25, rest = 5): Measure {
    if (kind === 'countup') return { type: 'countup' };
    if (kind === 'pomodoro') return { type: 'interval', source: 'pomodoro', groups: pomodoroGroups(work, rest), at: START_CURSOR };
    return { type: 'countdown', totalSeconds: kind.countdown };
}

/**
 * A timer as the start command makes it on `task`, running from now, before
 * its first line is written: its subject is the task's anchor, or `anchor`
 * (the one the start write is to put on the row) when the row has none.
 */
export function timerOn(task: Task, mode: RecordMode, kind: MeasureKind = 'countup', anchor?: string): TimerState {
    const subject = task.anchor ?? anchor;
    if (!subject) throw new Error('timerOn: the task has no anchor; give the one the start write puts');
    return {
        id: newTimerId(),
        subject: { kind: 'task', anchor: subject },
        file: task.file,
        name: getTaskDisplayName(task),
        color: '',
        mode,
        measure: measureOf(kind),
        clock: restart(Date.now()),
        session: { kind: 'running', from: 0 },
        tail: null,
        owned: [],
        opening: null,
        recorded: { seconds: 0, count: 0 },
        priorStartMs: null,
        draft: null,
        expanded: true,
    };
}

/** A daily note timer on `date`, running from now, before its first line is written. */
export function timerOnDay(date: string, kind: MeasureKind = 'countup'): TimerState {
    return {
        id: newTimerId(),
        subject: { kind: 'daily', date },
        file: '',
        name: date,
        color: '',
        mode: 'child',
        measure: measureOf(kind),
        clock: restart(Date.now()),
        session: { kind: 'running', from: 0 },
        tail: null,
        owned: [],
        opening: null,
        recorded: { seconds: 0, count: 0 },
        priorStartMs: null,
        draft: null,
        expanded: true,
    };
}

/**
 * Start `timer` as the start command does once it has made it: put it on the
 * board and write its first line (`TimerLifecycle.begin`). Resolves when the
 * write is back.
 */
export async function begin(rig: TimerRig, timer: TimerState, task: Task | null): Promise<TimerState> {
    rig.board.add(timer);
    await rig.lifecycle.begin(timer, task);
    return timer;
}

/**
 * The real widget over a vault session, not activated: nothing is drawn and
 * nothing ticks. Its own board, recorder and lifecycle; the start command is
 * `widget.startTimer`.
 */
export function widgetOver(s: VaultSession): TimerWidget {
    return new TimerWidget(s.app, s.plugin as never);
}
