/**
 * 完了済みタスクへのタイマー開始の分岐。
 *
 * `[x]` の行にタイマーを掛ける意図は 2 つに割れる — 「その作業の続きをやる」か
 * 「あの記録は無かったことにして取り直す」か。どちらかに決め打つと片方が事故に
 * なるので、ユーザーに訊く。
 *
 * 判定に使うのは **`statusChar` だけ**。v1 は「アイコン + 時刻 + `[x]`」という
 * **形**からタイマーが書いた行を見分けようとしたが、その形は手書きの行と原理的に
 * 区別できず、ユーザーの完了済みタスクを誤って器に変形する事故になった。挙動を
 * 分ける判定はパーサが確実に知る事実だけに乗せる。
 */

export type TimerStartDecision = 'immediate' | 'ask';

/** 完了済みタスクへの開始か（＝ ダイアログを出すか）。 */
export function decideTimerStartMode(statusChar: string | undefined): TimerStartDecision {
    return statusChar === 'x' ? 'ask' : 'immediate';
}

/**
 * ダイアログの選択肢。
 *
 * - `continue` … 続きを開始する。連続する完了済み兄弟の末尾に新しいレコードを足す
 * - `overwrite` … その行に記録し直す（従来の self）
 * - `cancel` … 何もしない
 */
export type TimerStartChoice = 'continue' | 'overwrite' | 'cancel';
