/**
 * ウィジェットのタイマーの遷移。出来事を受けて次の状態を返す純粋な関数で、
 * 書き込み、音、描画は持たない。当てるのは `TimerBoard.dispatch` で、書き込みを
 * 待つのは `TimerLifecycle`（書けてから状態を進める）。
 *
 * countup、countdown、ポモドーロは同じ状態機械に乗り、どれも1つの走行が1つの
 * 記録である。違いは測り方と、▶ で時計を 0 から数え直すか（countup）、止めた
 * 所から続けるか（countdown の残りとポモドーロの区間の周）だけ。
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
    /** suspended → running: 新しい走行中の行を書けた。走行は ▶ を押した時刻から。 */
    | { type: 'resumed'; pressedAt: number }
    /**
     * 走っている区間の開始を動かす（開始をずらす）。`startMs` は区間（走行の行と記録）の
     * 開始で、時計の開始はそれより区間の始めの読み（`session.from`）だけ前になる。
     */
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
            // countup は 0 から数え直す。countdown とポモドーロは止めた所から続け、記録は押した時刻から。
            const at = event.pressedAt;
            const clock = state.measure.type === 'countup' ? restart(at) : resume(state.clock, at);
            return { ...state, clock, session: { kind: 'running', from: readSeconds(clock, at) }, expanded: true };
        }
        case 'shifted': {
            const { session } = state;
            if (session.kind !== 'running') return state;
            return { ...state, clock: shift(state.clock, event.startMs - session.from * 1000) };
        }
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
