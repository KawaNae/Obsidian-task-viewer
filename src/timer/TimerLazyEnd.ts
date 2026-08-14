/**
 * 走行中セッションの end を遅らせて書き足す規則（純粋）。
 *
 * セッション行は開始時刻だけを持って書かれ、end は停止するまで確定しない。
 * ところが end の無い時刻付きタスクの実効 end は「start + 既定の 1 時間」なので、
 * それを超えて走ると行が現在時刻より手前で終わったことになり、赤く表示される。
 * 走行中の行が遅れているように見えるのは事実に反する。
 *
 * そこで**実効 end を過ぎたときだけ** end を先へ書き足す。常時書き込みではなく、
 * 5 分に 1 度の書き込みで足りる。副産物として、異常終了しても行には高々 5 分前
 * までの end が残る。
 *
 * 判断の基準は行の実効 end であって定数ではない。明示 end を持つ行（30 分枠で
 * 始めたセッションなど）はその end を過ぎた時点から書き足しが始まり、1 時間は
 * end を持たない行に暗黙の既定が適用された場合の値にすぎない。
 */

/** 書き足す刻み。次の書き込みまでの間隔でもある。 */
export const EXTEND_STEP_MINUTES = 5;

const STEP_MS = EXTEND_STEP_MINUTES * 60_000;

export type LazyEndDecision =
    /** まだ実効 end の内側。次に見直す時刻（＝ 実効 end）だけ覚える。 */
    | { kind: 'hold'; floorMs: number }
    /** 実効 end を過ぎた。この時刻まで書き足す。 */
    | { kind: 'extend'; endMs: number };

/**
 * 次に書き足す end。**必ず現在より未来**になる刻みの境界へ切り上げる。
 *
 * 境界ちょうどのときに同じ時刻を返すと、書いた直後にまた過去になって毎 tick
 * 書き込むことになる。`floor` してから 1 刻み足すので、境界上でも次の境界へ進む。
 */
export function nextExtendedEnd(nowMs: number): number {
    return Math.floor(nowMs / STEP_MS) * STEP_MS + STEP_MS;
}

/**
 * 走行中の行の実効 end と現在時刻から、書き足すかどうかを決める。
 *
 * 実効 end は呼び出し側が `DisplayTask` から取る。暗黙の end（start + 1 時間）を
 * 解決する規則はそちらが唯一の持ち主で、ここに書き写すと二重管理になる。明示 end
 * を持つ行（self モードで元タスクが時間帯を持っていた場合など）も同じ経路で扱える。
 */
export function decideLazyEnd(nowMs: number, effectiveEndMs: number): LazyEndDecision {
    if (effectiveEndMs > nowMs) {
        return { kind: 'hold', floorMs: effectiveEndMs };
    }
    return { kind: 'extend', endMs: nextExtendedEnd(nowMs) };
}
