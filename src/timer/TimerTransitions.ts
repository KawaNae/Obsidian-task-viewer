/**
 * ウィジェットのタイマーの遷移。出来事を受けて次の状態を返す純粋な関数で、
 * 書き込み、音、描画は持たない。当てるのは `TimerBoard.dispatch` で、書き込みを
 * 待つのは `TimerLifecycle`（書けてから状態を進める）。
 *
 * countup、countdown、ポモドーロは同じ状態機械に乗る。違いは測り方と、▶ で
 * 時計を 0 から数え直すか（countup と countdown。1つの走行が1つの記録）、
 * 続きから数えるか（ポモドーロ。区間の周は止めた所から）だけ。
 */

import { freeze, readSeconds, restart, resume, shift } from './TimerClock';
import type { IntervalGroup } from './IntervalMath';
import type { Measure } from './TimerProgress';
import { finished, type Opening, type PendingRecord, type TimerState } from './TimerState';

export type TimerEvent =
    /**
     * running → pending: 時計を止め、記録を固定する。pending なら行き先だけを替える
     * （周を終えたポモドーロは閉じるだけで、中断へは替えない）。
     */
    | { type: 'stopped'; then: PendingRecord['then'] }
    /** pending → suspended: 記録を書けた。閉じる行き先は呼び手が閉じる。 */
    | { type: 'recorded' }
    /** suspended → running: 新しい走行中の行を書けた。時計は ▶ を押した時刻から。 */
    | { type: 'resumed'; pressedAt: number }
    /** 走っている時計の開始を動かす（開始をずらす）。 */
    | { type: 'shifted'; startMs: number }
    /** 区間を送った測り方。 */
    | { type: 'ticked'; measure: Measure }
    /** ポモドーロの区間の長さと繰り返し。 */
    | { type: 'retimed'; groups: IntervalGroup[] }
    /** 書いている途中の錨の姿。書けなかったら null に戻す。 */
    | { type: 'opening'; opening: Opening | null }
    /** 書けた書き込みの錨の姿を当てる。`file` は書いたノート（デイリーノートの 1 本目）。 */
    | { type: 'landed'; opening: Opening; file?: string }
    /** 送る操作とノートの改名のあとのノート。 */
    | { type: 'followed'; file: string }
    /** 表示の写し。 */
    | { type: 'synced'; name: string; color: string }
    /** 名前の下書き。 */
    | { type: 'drafted'; draft: string | null }
    | { type: 'toggled' };

/** 出来事 `event` を時刻 `nowMs` に受けた次の状態。受けない状態では同じ状態を返す。 */
export function step(state: TimerState, event: TimerEvent, nowMs: number): TimerState {
    switch (event.type) {
        case 'stopped': {
            const { session } = state;
            if (session.kind === 'pending') {
                if (event.then === 'suspend' && finished(state, nowMs)) return state;
                return { ...state, session: { kind: 'pending', record: { ...session.record, then: event.then } } };
            }
            if (session.kind !== 'running') return state;
            const clock = freeze(state.clock, nowMs);
            const seconds = Math.max(0, clock.seconds - session.from);
            return { ...state, clock, session: { kind: 'pending', record: { endMs: nowMs, seconds, then: event.then } } };
        }
        case 'recorded': {
            const { session } = state;
            if (session.kind !== 'pending') return state;
            return {
                ...state,
                session: { kind: 'suspended' },
                recorded: { seconds: state.recorded.seconds + session.record.seconds, count: state.recorded.count + 1 },
                expanded: false,
            };
        }
        case 'resumed': {
            if (state.session.kind !== 'suspended') return state;
            // ポモドーロは区間の周を止めた所から続ける。countup と countdown は 1 つの走行が 1 つの記録。
            const at = event.pressedAt;
            const clock = state.measure.type === 'interval' ? resume(state.clock, at) : restart(at);
            return { ...state, clock, session: { kind: 'running', from: readSeconds(clock, at) }, expanded: true };
        }
        case 'shifted':
            if (state.session.kind !== 'running') return state;
            return { ...state, clock: shift(state.clock, event.startMs) };
        case 'ticked':
            return { ...state, measure: event.measure };
        case 'retimed':
            if (state.measure.type !== 'interval') return state;
            return { ...state, measure: { ...state.measure, groups: event.groups } };
        case 'opening':
            return { ...state, opening: event.opening };
        case 'landed':
            return {
                ...state,
                tail: event.opening.tail,
                owned: event.opening.owned,
                opening: null,
                file: event.file ?? state.file,
            };
        case 'followed':
            return { ...state, file: event.file };
        case 'synced':
            return { ...state, name: event.name, color: event.color };
        case 'drafted':
            return { ...state, draft: event.draft };
        case 'toggled':
            return { ...state, expanded: !state.expanded };
    }
}
