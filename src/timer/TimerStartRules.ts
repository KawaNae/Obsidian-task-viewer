/**
 * タスクにタイマーを始めてよいか、self を使えるか。開始の命令
 * （`TimerWidget.startTimer`）と、メニューが self の項目を出すか
 * （`TimerMenuBuilder`）の両方がここに問う。
 */

import type { StatusDefinition, Task } from '../types';
import { canTriggerFlow } from '../services/flow/FlowTrigger';
import { decideTimerStartMode } from './TimerStartMode';
import type { RecordMode } from './TimerState';

/**
 * 開始の命令への答え。
 *
 * - `refuse` … 始めない。読み取り専用の記法（day-planner、tasks-plugin）は、開始の
 *              書き込みも記録も落ちる。計測だけが動くと、終わるまで何も残らない
 * - `start`  … この mode で始める
 * - `ask`    … `[x]` の行への self。続きを始めるか、その行に記録し直すかを尋ねる
 */
export type StartVerdict =
    | { kind: 'refuse' }
    | { kind: 'start'; mode: RecordMode }
    | { kind: 'ask' };

/**
 * self を使えるか。self は対象の行の start を書き換えるので、完了でフローを
 * 起こしうるタスクには使わない（start の書き換えでフローが起き直す）。
 */
export function allowsSelf(task: Task, statusDefinitions: StatusDefinition[]): boolean {
    return !task.isReadOnly && !canTriggerFlow(task, statusDefinitions);
}

/** タスク `task` に `mode` で始めてよいか。self を使えなければ child に落とす。 */
export function decideStart(task: Task, mode: RecordMode, statusDefinitions: StatusDefinition[]): StartVerdict {
    if (task.isReadOnly) return { kind: 'refuse' };
    if (mode !== 'self') return { kind: 'start', mode };
    if (!allowsSelf(task, statusDefinitions)) return { kind: 'start', mode: 'child' };
    return decideTimerStartMode(task.statusChar) === 'ask' ? { kind: 'ask' } : { kind: 'start', mode };
}
