/**
 * interval の区間の計算。純関数だけを置く。
 *
 * 区間の位置はカーソル（{@link IntervalCursor}）で持ち、時計の読みから毎回は
 * 求めない。カーソルは今の区間が始まったときの時計の読み（`from`）を持つので、
 * 区間の経過は「時計の読み − from」になる。走っている区間の長さを設定で変えても、
 * 前の区間の位置は動かない。
 *
 * 区間の送り、周の文言、全体の長さとその表示、ポモドーロの区間の組み立ては
 * ここだけが答える。ウィジェットと独立ビュー（`TimerView`）が同じ関数を使う。
 */

import type { IntervalGroup, IntervalSegment } from './TimerInstance';

/** 区間の位置。`from` は今の区間が始まったときの時計の読み（秒）。 */
export interface IntervalCursor {
    group: number;
    repeat: number;
    segment: number;
    from: number;
}

/** 最初の区間を、時計の読み 0 から始める位置。 */
export const START_CURSOR: IntervalCursor = { group: 0, repeat: 0, segment: 0, from: 0 };

export function segmentAt(groups: IntervalGroup[], at: IntervalCursor): IntervalSegment | null {
    return groups[at.group]?.segments[at.segment] ?? null;
}

export interface Advanced {
    at: IntervalCursor;
    /** 送った区間の数。最後の区間の終わりは数えない。 */
    moved: number;
    /** 最後の区間を使い切ったときの、終わりの時計の読み。続きがあれば null。 */
    done: number | null;
}

/**
 * 時計の読み seconds まで区間を送る。今の区間を使い切っていれば次へ送り、`from`
 * に区間の長さを足す。使い切った区間が続けばまとめて送る。長さの無い区間は
 * 1回の送りで1つだけ越える（無限の繰り返しが長さの無い区間だけでも止まる）。
 *
 * 指す区間が無ければ、その位置で終わっている（done = from）。
 */
export function advance(groups: IntervalGroup[], at: IntervalCursor, seconds: number): Advanced {
    let cursor = at;
    let moved = 0;
    for (;;) {
        const segment = segmentAt(groups, cursor);
        if (!segment) return { at: cursor, moved, done: cursor.from };
        if (segment.durationSeconds <= 0 && moved > 0) return { at: cursor, moved, done: null };

        const end = cursor.from + segment.durationSeconds;
        if (seconds < end) return { at: cursor, moved, done: null };

        const next = nextPosition(groups, cursor);
        if (!next) return { at: cursor, moved, done: end };
        cursor = { ...next, from: end };
        moved++;
    }
}

/**
 * 次の区間の位置。同じグループの次の区間、同じグループの次の周、次のグループの
 * 順に当たる。`repeatCount` 0 は無限に繰り返し、ほかは max(1, n) 周。
 */
function nextPosition(
    groups: IntervalGroup[],
    at: IntervalCursor,
): Omit<IntervalCursor, 'from'> | null {
    const group = groups[at.group];
    if (!group) return null;
    if (at.segment + 1 < group.segments.length) {
        return { group: at.group, repeat: at.repeat, segment: at.segment + 1 };
    }
    if (repeatsWithoutEnd(group) || at.repeat + 1 < repeatsOf(group)) {
        return { group: at.group, repeat: at.repeat + 1, segment: 0 };
    }
    if (at.group + 1 < groups.length) {
        return { group: at.group + 1, repeat: 0, segment: 0 };
    }
    return null;
}

function repeatsWithoutEnd(group: IntervalGroup): boolean {
    return group.repeatCount === 0;
}

function repeatsOf(group: IntervalGroup): number {
    return Math.max(1, group.repeatCount || 1);
}

/** 全体の長さ（秒）。無限に繰り返すグループが1つでもあれば 0。 */
export function totalDuration(groups: IntervalGroup[]): number {
    if (groups.some(repeatsWithoutEnd)) return 0;
    return groups.reduce((total, group) => {
        const groupSeconds = group.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
        return total + groupSeconds * repeatsOf(group);
    }, 0);
}

/** 全体の長さの表示。`1h 30m`、`2h`、`45m`、無限は `∞`。 */
export function formatTotalDuration(groups: IntervalGroup[]): string {
    if (groups.some(repeatsWithoutEnd)) return '∞';
    const total = totalDuration(groups);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
}

/** 周の文言。限りのある周は `Work 2/4`、無限は `Work 3`。指す区間が無ければ空。 */
export function repeatText(groups: IntervalGroup[], at: Pick<IntervalCursor, 'group' | 'repeat' | 'segment'>): string {
    const group = groups[at.group];
    const segment = group?.segments[at.segment];
    if (!group || !segment) return '';
    if (repeatsWithoutEnd(group)) return `${segment.label} ${at.repeat + 1}`;
    return `${segment.label} ${at.repeat + 1}/${group.repeatCount}`;
}

/** ポモドーロの区間。設定の分から work と break を組み、無限に繰り返す。 */
export function pomodoroGroups(workMinutes: number, breakMinutes: number): IntervalGroup[] {
    return [{
        segments: [
            { label: 'Work', durationSeconds: workMinutes * 60, type: 'work' },
            { label: 'Break', durationSeconds: breakMinutes * 60, type: 'break' },
        ],
        repeatCount: 0,
    }];
}

/** ラベルが空の区間に当てる名前。種類から決める。 */
export function defaultSegmentLabel(type: IntervalSegment['type']): string {
    if (type === 'prepare') return 'Prepare';
    if (type === 'break') return 'Break';
    return 'Work';
}

// ─── ウィジェットの口 ───────────────────────────────────────────
// ウィジェット（TimerLifecycle / TimerPersistence / TimerRenderer / TimerCreator）
// のタイマーが持つカーソルの形で答える。used by the widget until stage 8 step 3.

/** ウィジェットのタイマーが持つ区間の位置。`IntervalTimer` はこれを満たす。 */
export interface LegacyIntervalCursor {
    groups: IntervalGroup[];
    currentGroupIndex: number;
    currentSegmentIndex: number;
    currentRepeatIndex: number;
}

/** `normalizeGroups` が空の入力に当てる既定値。設定を読むのは呼び出し側の責任。 */
export interface IntervalDefaults {
    prepareSeconds: number;
    workSeconds: number;
    breakSeconds: number;
}

export function getCurrentSegment(cursor: LegacyIntervalCursor): IntervalSegment | null {
    const group = cursor.groups[cursor.currentGroupIndex];
    if (!group) return null;
    return group.segments[cursor.currentSegmentIndex] ?? null;
}

/** カーソルを次の区間へ進める。進めたら true、全部終わっていたら false。送りの規則は {@link advance} と同じ。 */
export function advanceSegment(cursor: LegacyIntervalCursor): boolean {
    const next = nextPosition(cursor.groups, {
        group: cursor.currentGroupIndex,
        repeat: cursor.currentRepeatIndex,
        segment: cursor.currentSegmentIndex,
        from: 0,
    });
    if (!next) return false;
    cursor.currentGroupIndex = next.group;
    cursor.currentRepeatIndex = next.repeat;
    cursor.currentSegmentIndex = next.segment;
    return true;
}

/** 現在位置より前に完了している区間の合計秒。今いる区間の経過は含まない。 */
export function computeCompletedDuration(cursor: LegacyIntervalCursor): number {
    let total = 0;
    for (let g = 0; g < cursor.groups.length; g++) {
        const group = cursor.groups[g];
        const repeats = group.repeatCount === 0
            ? (g === cursor.currentGroupIndex ? cursor.currentRepeatIndex : 0)
            : Math.max(1, group.repeatCount || 1);
        const groupDuration = group.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);

        if (g < cursor.currentGroupIndex) {
            total += groupDuration * repeats;
            continue;
        }

        if (g > cursor.currentGroupIndex) {
            break;
        }

        total += groupDuration * cursor.currentRepeatIndex;
        for (let s = 0; s < cursor.currentSegmentIndex; s++) {
            total += group.segments[s].durationSeconds;
        }
    }
    return total;
}

/** 上限のあるインターバルで経過が総量を超えないようにする。0 は上限なし。 */
export function clampToTotalDuration(total: number, value: number): number {
    return total > 0 ? Math.min(total, value) : value;
}

/**
 * 外から来たグループ定義を整える。長さは 1 秒以上の整数、ラベルは空なら種別から
 * 補う。区間の無いグループは落とし、全部落ちたら既定の 1 グループを返す。
 */
export function normalizeGroups(
    input: IntervalGroup[] | undefined,
    defaults: IntervalDefaults,
): IntervalGroup[] {
    const normalized = (input ?? [])
        .map((group) => ({
            repeatCount: group.repeatCount === 0 ? 0 : Math.max(1, Math.floor(group.repeatCount || 1)),
            segments: (group.segments || [])
                .map((segment) => ({
                    label: (segment.label || '').trim() || defaultSegmentLabel(segment.type),
                    durationSeconds: Math.max(1, Math.floor(segment.durationSeconds || 0)),
                    type: segment.type,
                }))
                // 長さは上で 1 秒以上に持ち上がるので、この filter は何も落とさない。
                // 消えるのは segments が空のグループだけ（下段の filter）。
                .filter((segment) => segment.durationSeconds > 0),
        }))
        .filter((group) => group.segments.length > 0);

    if (normalized.length > 0) {
        return normalized;
    }

    return [
        {
            repeatCount: 1,
            segments: [
                { label: 'Prepare', durationSeconds: defaults.prepareSeconds, type: 'prepare' },
                { label: 'Work', durationSeconds: defaults.workSeconds, type: 'work' },
                { label: 'Break', durationSeconds: defaults.breakSeconds, type: 'break' },
            ],
        },
    ];
}
