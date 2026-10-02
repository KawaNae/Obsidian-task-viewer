/**
 * タイマーの保存（版 9）。保存するのは表（`TimerState`）と提案の時刻だけで、
 * 復元で作り直すものは無い。経過は時計から求まり、区間は最初の tick で送られる。
 *
 * 読みは形を厳密に確かめる。崩れたタイマーは捨てる（この版が保存した形ではない）。
 */

import type { App } from 'obsidian';
import { FileSystemAdapter } from 'obsidian';
import type { Clock } from './TimerClock';
import type { IntervalCursor, IntervalGroup, IntervalSegment } from './IntervalMath';
import type { Measure } from './TimerProgress';
import type { IdleBoard } from './TimerBoard';
import type { Opening, PendingRecord, RecordMode, Session, Subject, TimerState } from './TimerState';
import { logError, logInfo } from '../log/log';

/**
 * v9: タイマーを状態（主題、測り方、時計、記録の区切り）で保存し、提案（idle）を
 * 表の外に置いた。ストレージキーに版が入るので、旧い版の状態は読まずに捨てる
 * （移し替えはしない）。復元のときに旧いキーを掃除する。
 */
export const STORAGE_VERSION = 9;
/** 掃除する旧い版。 */
export const OBSOLETE_STORAGE_VERSIONS = [5, 6, 7, 8];
export const STORAGE_KEY_PREFIX = 'task-viewer.active-timers';
/** 旧い版が使っていた端末 ID のキー。掃除だけする。 */
const OBSOLETE_KEYS = ['task-viewer.device-id.v1'];

export interface PersistedTimerState {
    version: number;
    vaultFingerprint: string;
    idleSinceMs: number | null;
    timers: TimerState[];
}

// ─── 形の検査 ─────────────────────────────────────────────────

type Shape = Record<string, unknown>;

function isObject(value: unknown): value is Shape {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isString);
}

function isSubject(value: unknown): value is Subject {
    if (!isObject(value)) return false;
    if (value.kind === 'task') return isString(value.anchor) && value.anchor !== '';
    if (value.kind === 'daily') return isString(value.date) && /^\d{4}-\d{2}-\d{2}$/.test(value.date);
    return false;
}

function isMode(value: unknown): value is RecordMode {
    return value === 'self' || value === 'child' || value === 'sibling';
}

function isSegment(value: unknown): value is IntervalSegment {
    return isObject(value) && isString(value.label) && isNumber(value.durationSeconds)
        && (value.type === 'work' || value.type === 'break' || value.type === 'prepare');
}

function isGroup(value: unknown): value is IntervalGroup {
    return isObject(value) && isNumber(value.repeatCount)
        && Array.isArray(value.segments) && value.segments.length > 0 && value.segments.every(isSegment);
}

function isCursor(value: unknown): value is IntervalCursor {
    return isObject(value) && isNumber(value.group) && isNumber(value.repeat)
        && isNumber(value.segment) && isNumber(value.from);
}

/** ウィジェットの測り方: countup、countdown、ポモドーロ。 */
function isMeasure(value: unknown): value is Measure {
    if (!isObject(value)) return false;
    switch (value.type) {
        case 'countup': return true;
        case 'countdown': return isNumber(value.totalSeconds) && value.totalSeconds > 0;
        case 'interval':
            return value.source === 'pomodoro' && Array.isArray(value.groups) && value.groups.length > 0
                && value.groups.every(isGroup) && isCursor(value.at);
        default: return false;
    }
}

function isClock(value: unknown): value is Clock {
    if (!isObject(value)) return false;
    if (value.kind === 'running') return isNumber(value.startMs);
    if (value.kind === 'frozen') return isNumber(value.seconds);
    return false;
}

function isPendingRecord(value: unknown): value is PendingRecord {
    return isObject(value) && isNumber(value.endMs) && isNumber(value.seconds)
        && (value.then === 'suspend' || value.then === 'close');
}

function isSession(value: unknown): value is Session {
    if (!isObject(value)) return false;
    switch (value.kind) {
        case 'running': return isNumber(value.from);
        case 'pending': return isPendingRecord(value.record);
        case 'suspended': return true;
        default: return false;
    }
}

function isOpening(value: unknown): value is Opening {
    return isObject(value) && isString(value.tail) && isStringArray(value.owned);
}

/** 保存のタイマーが、この版が保存した形か。走る時計を持てるのは running だけ。 */
function isTimerState(value: unknown): value is TimerState {
    if (!isObject(value)) return false;
    const recorded = value.recorded;
    return isString(value.id) && value.id !== ''
        && isSubject(value.subject)
        && isString(value.file)
        && isString(value.name)
        && isString(value.color)
        && isMode(value.mode)
        && isMeasure(value.measure)
        && isClock(value.clock)
        && isSession(value.session)
        && ((value.session as Session).kind === 'running') === ((value.clock as Clock).kind === 'running')
        && (value.tail === null || isString(value.tail))
        && isStringArray(value.owned)
        && (value.opening === null || isOpening(value.opening))
        && isObject(recorded) && isNumber(recorded.seconds) && isNumber(recorded.count)
        && (value.priorStartMs === null || isNumber(value.priorStartMs))
        && (value.draft === null || isString(value.draft))
        && typeof value.expanded === 'boolean';
}

/** 保存の欄だけを写す（実行時に足されたものを持ち込まない）。 */
function toPersisted(timer: TimerState): TimerState {
    return {
        id: timer.id,
        subject: timer.subject,
        file: timer.file,
        name: timer.name,
        color: timer.color,
        mode: timer.mode,
        measure: timer.measure,
        clock: timer.clock,
        session: timer.session,
        tail: timer.tail,
        owned: timer.owned,
        opening: timer.opening,
        recorded: timer.recorded,
        priorStartMs: timer.priorStartMs,
        draft: timer.draft,
        expanded: timer.expanded,
    };
}

// ─── 保存の口 ─────────────────────────────────────────────────

export class TimerPersistence {
    readonly vaultFingerprint: string;

    constructor(app: App) {
        this.vaultFingerprint = vaultFingerprintOf(app);
    }

    storageKey(version = STORAGE_VERSION): string {
        return `${STORAGE_KEY_PREFIX}.v${version}:${this.vaultFingerprint}`;
    }

    /** 表と提案を保存する。どちらも無ければキーを消す。呼ぶのは `TimerBoard` の予約だけ。 */
    persist(timers: readonly TimerState[], idle: IdleBoard | null): void {
        logInfo(`[Timer:persist] count=${timers.length}`);
        const key = this.storageKey();
        try {
            if (timers.length === 0 && idle === null) {
                window.localStorage.removeItem(key);
                return;
            }
            const payload: PersistedTimerState = {
                version: STORAGE_VERSION,
                vaultFingerprint: this.vaultFingerprint,
                idleSinceMs: idle?.sinceMs ?? null,
                timers: timers.map(toPersisted),
            };
            window.localStorage.setItem(key, JSON.stringify(payload));
        } catch (error) {
            logError(`[TimerWidget] Failed to persist timers: ${(error as Error)?.message ?? error}`);
        }
    }

    /**
     * 保存した表と提案を読む。旧い版のキーは掃除する。形の崩れた中身は捨て、
     * 崩れたタイマーだけを落とす。
     */
    restore(): { timers: TimerState[]; idle: IdleBoard | null } {
        const empty = { timers: [], idle: null };
        this.dropObsolete();
        const key = this.storageKey();
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw) return empty;
            const parsed: unknown = JSON.parse(raw);
            if (!isObject(parsed) || parsed.version !== STORAGE_VERSION
                || parsed.vaultFingerprint !== this.vaultFingerprint
                || !Array.isArray(parsed.timers)
                || !(parsed.idleSinceMs === null || isNumber(parsed.idleSinceMs))) {
                window.localStorage.removeItem(key);
                return empty;
            }
            const timers = parsed.timers.filter(isTimerState).map(toPersisted);
            const idle = isNumber(parsed.idleSinceMs) ? { sinceMs: parsed.idleSinceMs } : null;
            logInfo(`[Timer:restored] count=${timers.length}`);
            return { timers, idle };
        } catch (error) {
            window.localStorage.removeItem(key);
            logError(`[TimerWidget] Failed to restore timers: ${(error as Error)?.message ?? error}`);
            return empty;
        }
    }

    /** 旧い版のキーを消す。キーに版が入るので読まれはしないが、消さないと残り続ける。 */
    private dropObsolete(): void {
        const keys = [...OBSOLETE_STORAGE_VERSIONS.map(version => this.storageKey(version)), ...OBSOLETE_KEYS];
        for (const key of keys) {
            try {
                window.localStorage.removeItem(key);
            } catch {
                // localStorage が使えない環境では黙って諦める（復元も同様に失敗する）
            }
        }
    }
}

/** vault の指紋。保存のキーに入れ、別の vault の保存を読まない。 */
function vaultFingerprintOf(app: App): string {
    const adapter = app.vault.adapter;
    const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
    const rawIdentity = basePath && basePath.trim() ? basePath : app.vault.getName();
    const identity = (rawIdentity || 'unknown-vault').trim().toLowerCase();
    let hash = 5381;
    for (let i = 0; i < identity.length; i++) {
        hash = ((hash << 5) + hash) + identity.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
