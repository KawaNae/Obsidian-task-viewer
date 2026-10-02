import { describe, expect, it } from 'vitest';
import { step, type TimerEvent } from '../../../src/timer/TimerTransitions';
import { pomodoroGroups, START_CURSOR } from '../../../src/timer/IntervalMath';
import type { Measure } from '../../../src/timer/TimerProgress';
import type { Session, TimerState } from '../../../src/timer/TimerState';

/**
 * 状態の遷移（`TimerTransitions.step`）。出来事を受けて次の状態を返す純粋な関数で、
 * 受けない状態では同じ状態を返す。書き込みを待つのは呼び手（`TimerLifecycle`）。
 *
 * | 出来事     | 変えるもの |
 * |-----------|-----------|
 * | stopped   | running → pending。時計を止め、記録を固定する。pending なら行き先だけ替える |
 * | recorded  | pending → suspended。recorded を足す |
 * | resumed   | suspended → running。時計を 0 からか（countup）続きから（countdown、ポモドーロ） |
 * | shifted   | 走っている区間の開始。時計はそれより区間の始めの読みだけ前から |
 * | ticked    | 区間を送った測り方 |
 * | retimed   | ポモドーロの区間の長さと繰り返し |
 * | opening、landed | 書いている途中の錨と、書けたあとの尻尾、自分の錨、ノート |
 * | followed  | 送る操作とノートの改名のあとのノート |
 * | synced    | 表示の写し |
 * | drafted   | 名前の下書き |
 * | toggled   | 開閉 |
 */

const T0 = 1_790_000_000_000;
const POMODORO: Measure = { type: 'interval', source: 'pomodoro', groups: pomodoroGroups(25, 5), at: START_CURSOR };

function state(overrides: Partial<TimerState> = {}): TimerState {
    return {
        id: 'timer-1',
        subject: { kind: 'task', anchor: 'box' },
        file: 'notes/a.md',
        name: 'A',
        color: '',
        mode: 'child',
        measure: { type: 'countup' },
        clock: { kind: 'running', startMs: T0 - 600_000 },
        session: { kind: 'running', from: 0 },
        tail: 'tv-t-1',
        owned: ['tv-t-1'],
        opening: null,
        recorded: { seconds: 0, count: 0 },
        priorStartMs: null,
        draft: null,
        expanded: true,
        ...overrides,
    };
}

const SUSPENDED: Partial<TimerState> = { clock: { kind: 'frozen', seconds: 600 }, session: { kind: 'suspended' } };
const PENDING = (then: 'suspend' | 'close' = 'suspend'): Partial<TimerState> => ({
    clock: { kind: 'frozen', seconds: 600 },
    session: { kind: 'pending', record: { endMs: T0, seconds: 600, then } },
});

describe('stopped', () => {
    it('running: stops the clock and fixes the record at the time it was given', () => {
        const next = step(state(), { type: 'stopped', then: 'suspend' }, T0);
        expect(next.clock).toEqual({ kind: 'frozen', seconds: 600 });
        expect(next.session).toEqual({ kind: 'pending', record: { endMs: T0, seconds: 600, then: 'suspend' } });
    });

    it('the record is the clock read from where the run began', () => {
        const next = step(state({ measure: POMODORO, session: { kind: 'running', from: 400 } }), { type: 'stopped', then: 'close' }, T0);
        expect(next.session).toEqual({ kind: 'pending', record: { endMs: T0, seconds: 200, then: 'close' } });
    });

    it('pending: only where it goes changes, the fixed record keeps its time and length', () => {
        const next = step(state(PENDING('close')), { type: 'stopped', then: 'suspend' }, T0 + 120_000);
        expect(next.session).toEqual({ kind: 'pending', record: { endMs: T0, seconds: 600, then: 'suspend' } });
        expect(next.clock).toEqual({ kind: 'frozen', seconds: 600 });
    });

    it('suspended: the same state', () => {
        const s = state(SUSPENDED);
        expect(step(s, { type: 'stopped', then: 'close' }, T0)).toBe(s);
    });
});

describe('recorded', () => {
    it('pending: suspended, folded, and the record counted', () => {
        const next = step(state({ ...PENDING(), recorded: { seconds: 300, count: 1 } }), { type: 'recorded' }, T0);
        expect(next.session).toEqual({ kind: 'suspended' });
        expect(next.recorded).toEqual({ seconds: 900, count: 2 });
        expect(next.expanded).toBe(false);
        expect(next.clock).toEqual({ kind: 'frozen', seconds: 600 });
    });

    it('running and suspended: the same state', () => {
        const running = state();
        const suspended = state(SUSPENDED);
        expect(step(running, { type: 'recorded' }, T0)).toBe(running);
        expect(step(suspended, { type: 'recorded' }, T0)).toBe(suspended);
    });
});

describe('resumed', () => {
    it('a countup runs from 0 at the press: one run is one record', () => {
        const next = step(state({ ...SUSPENDED, expanded: false }), { type: 'resumed', pressedAt: T0 + 60_000 }, T0 + 61_000);
        expect(next.clock).toEqual({ kind: 'running', startMs: T0 + 60_000 });
        expect(next.session).toEqual({ kind: 'running', from: 0 });
        expect(next.expanded).toBe(true);
    });

    it('a countdown goes on from where it stopped, and the next record starts there', () => {
        const next = step(state({ ...SUSPENDED, measure: { type: 'countdown', totalSeconds: 300 } }), { type: 'resumed', pressedAt: T0 }, T0);
        expect(next.clock).toEqual({ kind: 'running', startMs: T0 - 600_000 });
        expect(next.session).toEqual({ kind: 'running', from: 600 });
    });

    it('a pomodoro goes on from where it stopped, and the next record starts there', () => {
        const next = step(state({ ...SUSPENDED, measure: POMODORO }), { type: 'resumed', pressedAt: T0 }, T0 + 5_000);
        expect(next.clock).toEqual({ kind: 'running', startMs: T0 - 600_000 });
        expect(next.session).toEqual({ kind: 'running', from: 600 });
    });

    it('running and pending: the same state', () => {
        const running = state();
        const pending = state(PENDING());
        expect(step(running, { type: 'resumed', pressedAt: T0 }, T0)).toBe(running);
        expect(step(pending, { type: 'resumed', pressedAt: T0 }, T0)).toBe(pending);
    });
});

describe('shifted', () => {
    it('running: the clock starts where it is moved to', () => {
        const next = step(state(), { type: 'shifted', startMs: T0 - 900_000 }, T0);
        expect(next.clock).toEqual({ kind: 'running', startMs: T0 - 900_000 });
        expect(next.session).toEqual({ kind: 'running', from: 0 });
    });

    it('a run that went on from where it stopped: the run starts where it is moved to, and the clock that much before', () => {
        const countdown = state({
            measure: { type: 'countdown', totalSeconds: 1500 },
            clock: { kind: 'running', startMs: T0 - 660_000 },
            session: { kind: 'running', from: 600 },
        });
        const next = step(countdown, { type: 'shifted', startMs: T0 - 300_000 }, T0);
        expect(next.clock).toEqual({ kind: 'running', startMs: T0 - 900_000 });
        expect(next.session).toEqual({ kind: 'running', from: 600 });
    });

    it('pending and suspended: the same state', () => {
        const pending = state(PENDING());
        const suspended = state(SUSPENDED);
        expect(step(pending, { type: 'shifted', startMs: T0 }, T0)).toBe(pending);
        expect(step(suspended, { type: 'shifted', startMs: T0 }, T0)).toBe(suspended);
    });
});

describe('ticked and retimed', () => {
    it('ticked: takes the measure the tick moved', () => {
        const moved: Measure = { ...POMODORO, at: { group: 0, repeat: 0, segment: 1, from: 1500 } } as Measure;
        expect(step(state({ measure: POMODORO }), { type: 'ticked', measure: moved }, T0).measure).toEqual(moved);
    });

    it('retimed: a pomodoro takes the new segments and keeps where it is', () => {
        const at = { group: 0, repeat: 2, segment: 1, from: 4800 };
        const groups = pomodoroGroups(50, 10);
        const next = step(state({ measure: { ...POMODORO, at } as Measure }), { type: 'retimed', groups }, T0);
        expect(next.measure).toEqual({ type: 'interval', source: 'pomodoro', groups, at });
    });

    it('retimed: a countup or a countdown is the same state', () => {
        const countup = state();
        const countdown = state({ measure: { type: 'countdown', totalSeconds: 60 } });
        expect(step(countup, { type: 'retimed', groups: pomodoroGroups(1, 1) }, T0)).toBe(countup);
        expect(step(countdown, { type: 'retimed', groups: pomodoroGroups(1, 1) }, T0)).toBe(countdown);
    });
});

describe('opening and landed', () => {
    it('opening: holds the line being written, and lets it go with null', () => {
        const opening = { tail: 'tv-t-2', owned: ['tv-t-1', 'tv-t-2'] };
        const writing = step(state(), { type: 'opening', opening }, T0);
        expect(writing.opening).toEqual(opening);
        expect(writing.tail).toBe('tv-t-1');
        expect(step(writing, { type: 'opening', opening: null }, T0).opening).toBeNull();
    });

    it('landed: the written line is the tail, its anchors are owned, and the opening is let go', () => {
        const opening = { tail: 'tv-t-2', owned: ['tv-t-2'] };
        const next = step(state({ opening }), { type: 'landed', opening }, T0);
        expect(next.tail).toBe('tv-t-2');
        expect(next.owned).toEqual(['tv-t-2']);
        expect(next.opening).toBeNull();
        expect(next.file).toBe('notes/a.md');
    });

    it('landed with a note: a daily note timer takes the note its first line went to', () => {
        const opening = { tail: 'tv-t-1', owned: ['tv-t-1'] };
        const daily = state({ subject: { kind: 'daily', date: '2026-09-21' }, file: '', tail: null, owned: [], opening });
        expect(step(daily, { type: 'landed', opening, file: 'daily/2026-09-21.md' }, T0).file).toBe('daily/2026-09-21.md');
    });
});

describe('what any session takes', () => {
    const sessions: [string, Partial<TimerState>][] = [['running', {}], ['pending', PENDING()], ['suspended', SUSPENDED]];

    for (const [name, overrides] of sessions) {
        it(`${name}: followed, synced, drafted and toggled change only their own field`, () => {
            const s = state(overrides);
            const cases: [TimerEvent, Partial<TimerState>][] = [
                [{ type: 'followed', file: 'X.md' }, { file: 'X.md' }],
                [{ type: 'synced', name: 'B', color: '#0f0' }, { name: 'B', color: '#0f0' }],
                [{ type: 'drafted', draft: '打ちかけ' }, { draft: '打ちかけ' }],
                [{ type: 'drafted', draft: null }, { draft: null }],
                [{ type: 'toggled' }, { expanded: !s.expanded }],
            ];
            for (const [event, changed] of cases) {
                expect(step(s, event, T0)).toEqual({ ...s, ...changed });
            }
        });
    }

    it('step does not change the state it is given', () => {
        const s = state();
        const copy = structuredClone(s);
        for (const event of [
            { type: 'stopped', then: 'close' },
            { type: 'shifted', startMs: T0 },
            { type: 'toggled' },
            { type: 'landed', opening: { tail: 'x', owned: ['x'] } },
        ] as TimerEvent[]) {
            step(s, event, T0);
        }
        expect(s).toEqual(copy);
    });
});

describe('the session moves only along the table', () => {
    it('running → pending → suspended → running, and nothing else moves it', () => {
        let s = state();
        const kinds: Session['kind'][] = [s.session.kind];
        for (const event of [
            { type: 'recorded' },                        // running は受けない
            { type: 'stopped', then: 'suspend' },
            { type: 'resumed', pressedAt: T0 },          // pending は受けない
            { type: 'recorded' },
            { type: 'stopped', then: 'close' },          // suspended は受けない
            { type: 'resumed', pressedAt: T0 + 1000 },
        ] as TimerEvent[]) {
            s = step(s, event, T0);
            kinds.push(s.session.kind);
        }
        expect(kinds).toEqual(['running', 'running', 'pending', 'pending', 'suspended', 'suspended', 'running']);
    });
});
