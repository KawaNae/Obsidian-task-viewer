import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    clearLog, getLogEntries, onLogEntry, initLog,
    logDebug, logInfo, logWarn, logError, notify,
} from '../../../src/log/log';

/**
 * log.ts はモジュールスコープの可変状態（buffer / listeners / _getSettings /
 * _showNotice）を持つシングルトンで、テスト用のリセット関数は無い。テスト間
 * の汚染を防ぐ手順:
 *   - 各テスト前に clearLog() で buffer を空にする
 *   - initLog は beforeEach で毎回呼び直す（getSettings は let 変数を閉じ込め、
 *     テストごとに verbose を切り替えられるようにする）
 *   - onLogEntry で登録したリスナーは、返ってくる unsubscribe を必ず配列に
 *     積んで afterEach でまとめて解除する（放置すると次のテストにリークする）
 */
describe('log', () => {
    let verbose = false;
    let notices: { message: string; durationMs: number }[] = [];
    const unsubs: (() => void)[] = [];
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        clearLog();
        verbose = false;
        notices = [];
        initLog(
            () => ({ verboseNotice: verbose }),
            (message, durationMs) => notices.push({ message, durationMs }),
        );
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        while (unsubs.length) unsubs.pop()!();
        vi.restoreAllMocks();
    });

    describe('buffer', () => {
        it('keeps entries in push order and returns a copy', () => {
            logInfo('a');
            logInfo('b');
            const entries = getLogEntries();
            expect(entries.map(e => e.message)).toEqual(['a', 'b']);

            entries.push({ timestamp: 0, level: 'info', message: 'mutated' });
            expect(getLogEntries().map(e => e.message)).toEqual(['a', 'b']); // internal buffer unaffected
        });

        it('drops the oldest entry once past MAX_LOG_ENTRIES (500)', () => {
            for (let i = 0; i < 500; i++) logInfo(`entry-${i}`);
            expect(getLogEntries()).toHaveLength(500);
            expect(getLogEntries()[0].message).toBe('entry-0');

            logInfo('entry-500'); // 501st push
            const entries = getLogEntries();
            expect(entries).toHaveLength(500);
            expect(entries[0].message).toBe('entry-1'); // oldest dropped
            expect(entries[499].message).toBe('entry-500');
        });

        it('clearLog empties the buffer', () => {
            logInfo('a');
            clearLog();
            expect(getLogEntries()).toEqual([]);
        });
    });

    describe('onLogEntry', () => {
        it('notifies every registered listener on each push', () => {
            const seenA: string[] = [];
            const seenB: string[] = [];
            unsubs.push(onLogEntry(e => seenA.push(e.message)));
            unsubs.push(onLogEntry(e => seenB.push(e.message)));

            logInfo('hello');

            expect(seenA).toEqual(['hello']);
            expect(seenB).toEqual(['hello']);
        });

        it('a listener that throws does not stop other listeners from being called', () => {
            const seen: string[] = [];
            unsubs.push(onLogEntry(() => { throw new Error('boom'); }));
            unsubs.push(onLogEntry(e => seen.push(e.message)));

            expect(() => logInfo('hello')).not.toThrow();
            expect(seen).toEqual(['hello']);
        });

        it('stops notifying after unsubscribe', () => {
            const seen: string[] = [];
            const unsubscribe = onLogEntry(e => seen.push(e.message));
            unsubscribe();

            logInfo('hello');

            expect(seen).toEqual([]);
        });
    });

    describe('verbose-gated console output', () => {
        it('logDebug logs to console only when verbose', () => {
            logDebug('quiet');
            expect(consoleLogSpy).not.toHaveBeenCalled();

            verbose = true;
            logDebug('loud');
            expect(consoleLogSpy).toHaveBeenCalledWith('loud');
        });

        it('logInfo logs to console and shows a Notice only when verbose', () => {
            logInfo('quiet');
            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(notices).toEqual([]);

            verbose = true;
            logInfo('loud', 1234);
            expect(consoleLogSpy).toHaveBeenCalledWith('loud');
            expect(notices).toEqual([{ message: 'loud', durationMs: 1234 }]);
        });
    });

    describe('logWarn / logError: always console, Notice asymmetry', () => {
        it('logWarn always warns to console but never shows a Notice, regardless of verbose', () => {
            logWarn('careful');
            expect(consoleWarnSpy).toHaveBeenCalledWith('careful');
            expect(notices).toEqual([]);

            verbose = true;
            logWarn('careful again');
            expect(notices).toEqual([]); // still no Notice — logWarn is not a Notice-emitting level
        });

        it('logError always errors to console AND always shows a Notice, even when not verbose', () => {
            expect(verbose).toBe(false);
            logError('boom');
            expect(consoleErrorSpy).toHaveBeenCalledWith('boom');
            expect(notices).toEqual([{ message: 'boom', durationMs: 8000 }]);
        });
    });

    describe('notify', () => {
        it('always shows a Notice and records an info-level entry, without console output', () => {
            notify('fyi', 999);
            expect(notices).toEqual([{ message: 'fyi', durationMs: 999 }]);
            expect(getLogEntries()).toHaveLength(1);
            expect(getLogEntries()[0]).toMatchObject({ level: 'info', message: 'fyi' });
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });
    });
});
