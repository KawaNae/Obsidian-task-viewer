import { describe, expect, it, beforeEach } from 'vitest';
import type { App } from 'obsidian';
import {
    OBSOLETE_STORAGE_VERSIONS,
    STORAGE_KEY_PREFIX,
    STORAGE_VERSION,
    TimerPersistence,
} from '../../../src/timer/TimerPersistence';
import { readSeconds } from '../../../src/timer/TimerClock';
import { pomodoroGroups, START_CURSOR } from '../../../src/timer/IntervalMath';
import type { TimerState } from '../../../src/timer/TimerState';

/**
 * タイマーの保存（版 9）。保存するのは表（`TimerState`）と提案の時刻だけで、
 * 復元で作り直すものは無い — 経過は時計から求まる。中断中と記録待ちの時計は
 * 止まっているので、閉じていた間の時間は経過に入らない。
 *
 * 読みは形を厳密に確かめ、崩れたタイマーだけを捨てる。走る時計を持てるのは
 * running だけ。旧い版のキーと端末 ID のキーは復元のときに消す。
 */

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
    localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
    },
};

const app = (name = 'test-vault') => ({ vault: { adapter: {}, getName: () => name } }) as unknown as App;
const persistence = (name?: string) => new TimerPersistence(app(name));
const NOW = new Date(2026, 8, 21, 9, 0, 0).getTime();

function countup(overrides: Partial<TimerState> = {}): TimerState {
    return {
        id: 'timer-1',
        subject: { kind: 'task', anchor: 'box' },
        file: 'notes/a.md',
        name: 'A',
        color: '#f00',
        mode: 'child',
        measure: { type: 'countup' },
        clock: { kind: 'running', startMs: NOW - 60_000 },
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

/** 保存の中身をそのまま書き換える。 */
function rewrite(p: TimerPersistence, edit: (payload: { timers: Record<string, unknown>[] } & Record<string, unknown>) => void): void {
    const payload = JSON.parse(store.get(p.storageKey())!);
    edit(payload);
    store.set(p.storageKey(), JSON.stringify(payload));
}

describe('saving the timers (version 9)', () => {
    beforeEach(() => store.clear());

    it('writes the version, the vault and the suggestion under the version 9 key', () => {
        const p = persistence();
        p.persist([countup()], { sinceMs: NOW });

        expect(STORAGE_VERSION).toBe(9);
        expect(p.storageKey()).toBe(`${STORAGE_KEY_PREFIX}.v9:${p.vaultFingerprint}`);
        const payload = JSON.parse(store.get(p.storageKey())!);
        expect(payload).toEqual({ version: 9, vaultFingerprint: p.vaultFingerprint, idleSinceMs: NOW, timers: [countup()] });
    });

    it('round-trips every state a timer can be in', () => {
        const timers: TimerState[] = [
            countup(),
            countup({
                id: 'timer-2',
                subject: { kind: 'daily', date: '2026-09-21' },
                mode: 'child',
                measure: { type: 'interval', source: 'pomodoro', groups: pomodoroGroups(25, 5), at: { ...START_CURSOR, segment: 1, from: 1500 } },
                clock: { kind: 'frozen', seconds: 1600 },
                session: { kind: 'suspended' },
                recorded: { seconds: 1600, count: 2 },
                expanded: false,
            }),
            countup({
                id: 'timer-3',
                mode: 'self',
                measure: { type: 'countdown', totalSeconds: 600 },
                clock: { kind: 'frozen', seconds: 700 },
                session: { kind: 'pending', record: { endMs: NOW, seconds: 700, then: 'close' } },
                opening: { tail: 'tv-t-9', owned: ['tv-t-1', 'tv-t-9'] },
                priorStartMs: NOW - 3_600_000,
                draft: '打ちかけの名前',
            }),
        ];
        persistence().persist(timers, null);

        expect(persistence().restore()).toEqual({ timers, idle: null });
    });

    it('saves only the state: what the runtime hung on a timer is left out', () => {
        const timer = Object.assign(countup(), { intervalId: 7, lazyEndFloorMs: 1 });
        persistence().persist([timer], null);

        const [restored] = persistence().restore().timers;
        expect(restored).toEqual(countup());
        expect(Object.keys(restored)).not.toContain('intervalId');
    });

    it('round-trips the time the suggestion came up, with no timer open', () => {
        persistence().persist([], { sinceMs: NOW - 5_000 });
        expect(persistence().restore()).toEqual({ timers: [], idle: { sinceMs: NOW - 5_000 } });
    });

    it('drops the key when there is neither a timer nor a suggestion', () => {
        const p = persistence();
        p.persist([countup()], null);
        p.persist([], null);
        expect(store.has(p.storageKey())).toBe(false);
    });

    it('a suspended timer comes back stopped: the time it was closed is not counted', () => {
        persistence().persist([countup({
            clock: { kind: 'frozen', seconds: 300 },
            session: { kind: 'suspended' },
            recorded: { seconds: 300, count: 1 },
        })], null);

        const [restored] = persistence().restore().timers;
        expect(restored.clock).toEqual({ kind: 'frozen', seconds: 300 });
        expect(readSeconds(restored.clock, NOW + 3_600_000)).toBe(300);
    });

    it('a running timer comes back running from where it started', () => {
        persistence().persist([countup({ clock: { kind: 'running', startMs: NOW - 120_000 } })], null);
        const [restored] = persistence().restore().timers;
        expect(readSeconds(restored.clock, NOW)).toBe(120);
    });
});

describe('reading the saved timers strictly', () => {
    beforeEach(() => store.clear());

    it('drops a broken timer and keeps the rest', () => {
        const p = persistence();
        const good = countup({ id: 'good' });
        const broken: Record<string, (t: Record<string, unknown>) => void> = {
            'no id': t => { t.id = ''; },
            'a subject without its anchor': t => { t.subject = { kind: 'task', anchor: '' }; },
            'a daily subject that is not a date': t => { t.subject = { kind: 'daily', date: '9/21' }; },
            'an unknown mode': t => { t.mode = 'twin'; },
            'a countdown of nothing': t => { t.measure = { type: 'countdown', totalSeconds: 0 }; },
            'an interval from a template': t => { t.measure = { type: 'interval', source: 'template', groups: pomodoroGroups(25, 5), at: START_CURSOR }; },
            'the old idle timer': t => { t.measure = { type: 'idle' }; },
            'a pending record without its end': t => {
                t.clock = { kind: 'frozen', seconds: 5 };
                t.session = { kind: 'pending', record: { seconds: 5, then: 'close' } };
            },
            'an opening without its tail': t => { t.opening = { owned: [] }; },
            'a missing field': t => { delete t.draft; },
            'an old field in place of a new one': t => { delete t.tail; t.tailRecordBlockId = 'tv-t-1'; },
        };
        p.persist([good, ...Object.keys(broken).map(id => countup({ id }))], null);
        rewrite(p, payload => {
            for (const timer of payload.timers) broken[timer.id as string]?.(timer);
        });

        expect(persistence().restore().timers).toEqual([good]);
    });

    it('drops a timer whose session and clock disagree: only running has a running clock', () => {
        const p = persistence();
        p.persist([
            countup({ id: 'running-frozen', clock: { kind: 'frozen', seconds: 60 } }),
            countup({ id: 'suspended-running', session: { kind: 'suspended' } }),
            countup({ id: 'pending-running', session: { kind: 'pending', record: { endMs: NOW, seconds: 60, then: 'suspend' } } }),
            countup({ id: 'good' }),
        ], null);

        expect(persistence().restore().timers.map(t => t.id)).toEqual(['good']);
    });

    it('reads nothing of another version or another vault, and drops the key', () => {
        const p = persistence();
        p.persist([countup()], null);
        rewrite(p, payload => { payload.version = 8; });
        expect(persistence().restore()).toEqual({ timers: [], idle: null });
        expect(store.has(p.storageKey())).toBe(false);

        p.persist([countup()], null);
        rewrite(p, payload => { payload.vaultFingerprint = 'another'; });
        expect(persistence().restore().timers).toEqual([]);
        expect(store.has(p.storageKey())).toBe(false);
    });

    it('drops a save that is not JSON, or whose suggestion time is not a number', () => {
        const p = persistence();
        store.set(p.storageKey(), '{not json');
        expect(persistence().restore().timers).toEqual([]);
        expect(store.has(p.storageKey())).toBe(false);

        p.persist([countup()], null);
        rewrite(p, payload => { payload.idleSinceMs = 'now'; });
        expect(persistence().restore().timers).toEqual([]);
    });

    it('keys the save by the vault: another vault reads none of it', () => {
        persistence('vault-a').persist([countup()], null);
        expect(persistence('vault-b').restore().timers).toEqual([]);
        expect(persistence('vault-a').restore().timers).toEqual([countup()]);
    });

    it('drops the keys of the old versions and the device id on restore', () => {
        const p = persistence();
        for (const version of [5, 6, 7, 8]) store.set(p.storageKey(version), `{"version":${version}}`);
        store.set('task-viewer.device-id.v1', 'device-1');

        p.restore();

        expect(OBSOLETE_STORAGE_VERSIONS).toEqual([5, 6, 7, 8]);
        for (const version of [5, 6, 7, 8]) expect(store.has(p.storageKey(version))).toBe(false);
        expect(store.has('task-viewer.device-id.v1')).toBe(false);
    });
});
