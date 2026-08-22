/**
 * interval タイマーの区間計算。純関数だけを置く。
 *
 * ここに `TimerContext` は要らない。区間の進行は「今どのグループ・どの区間・
 * 何周目か」というカーソルと、区間の長さだけで決まる。同じ計算をウィジェット
 * （`TimerLifecycle` / `TimerPersistence` / `TimerRenderer`）と、タスクに紐付か
 * ない独立ビュー（`TimerView`）の両方が使う。ビューは記録も永続化も持たないので
 * ウィジェット側の組み立てを再利用できないが、この計算だけは共有できる。
 *
 * 引数はタイマー全体ではなくカーソルの形。プレーンなオブジェクトで呼べるので、
 * 計算だけを単体で確かめられる。
 */

import type { IntervalGroup, IntervalSegment } from './TimerInstance';

/** 区間の進行に要る最小の状態。`IntervalTimer` はこれを満たす。 */
export interface IntervalCursor {
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

export function getCurrentSegment(cursor: IntervalCursor): IntervalSegment | null {
    const group = cursor.groups[cursor.currentGroupIndex];
    if (!group) return null;
    return group.segments[cursor.currentSegmentIndex] ?? null;
}

/**
 * カーソルを次の区間へ進める。進めたら true、全部終わっていたら false。
 *
 * 順に、同じグループの次の区間 → 同じグループの次の周 → 次のグループ、と当たる。
 * `repeatCount === 0` は無限の繰り返しなので、周では尽きない。
 */
export function advanceSegment(cursor: IntervalCursor): boolean {
    const currentGroup = cursor.groups[cursor.currentGroupIndex];
    if (!currentGroup) return false;

    if (cursor.currentSegmentIndex + 1 < currentGroup.segments.length) {
        cursor.currentSegmentIndex++;
        return true;
    }

    if (currentGroup.repeatCount === 0 || cursor.currentRepeatIndex + 1 < Math.max(1, currentGroup.repeatCount || 1)) {
        cursor.currentRepeatIndex++;
        cursor.currentSegmentIndex = 0;
        return true;
    }

    if (cursor.currentGroupIndex + 1 < cursor.groups.length) {
        cursor.currentGroupIndex++;
        cursor.currentRepeatIndex = 0;
        cursor.currentSegmentIndex = 0;
        return true;
    }

    return false;
}

/** 現在位置より前に完了している区間の合計秒。今いる区間の経過は含まない。 */
export function computeCompletedDuration(cursor: IntervalCursor): number {
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

/**
 * 全体の長さ。無限に繰り返すグループが 1 つでもあれば 0（＝上限なし）を返す。
 * 進捗リングの分母や `clampToTotalDuration` の上限に使う。
 */
export function computeTotalDuration(groups: IntervalGroup[]): number {
    if (groups.some((group) => group.repeatCount === 0)) {
        return 0;
    }
    return groups.reduce((total, group) => {
        const groupTotal = group.segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
        return total + groupTotal * Math.max(1, group.repeatCount);
    }, 0);
}

/** 上限のあるインターバルで経過が総量を超えないようにする。0 は上限なし。 */
export function clampToTotalDuration(totalDuration: number, value: number): number {
    return totalDuration > 0 ? Math.min(totalDuration, value) : value;
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

function defaultSegmentLabel(type: IntervalSegment['type']): string {
    if (type === 'prepare') return 'Prepare';
    if (type === 'break') return 'Break';
    return 'Work';
}
