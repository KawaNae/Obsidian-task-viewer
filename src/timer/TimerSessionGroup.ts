/**
 * セッショングループの解決。
 *
 * 仕様は「遅延グループ化」: 1 回目のセッションはタスク行自身をレコードに変形する
 * だけで構造を変えず、**初回再開のときに 1 回きり**グループ checkbox を挿して
 * レコードをその子へ落とす。したがって「グループが既にあるか」は状態フラグでは
 * なく **ファイルの形**から判断する — 再起動をまたいでも、ユーザーが手で編集
 * しても、見えているものが正になる。
 *
 * アンカーは 1 回目のレコード行の `^tv-timer-target`（{@link TimerTaskResolver}
 * が引く）。グループはそのレコードの `parentId` で辿る。グループ行側に id を
 * 置き直す案もあるが、変形は「1 vault.process で原子」が売りなので、その直後に
 * 付与と除去の書き込みを足す形は採らない。
 */

import type { Task } from '../types';

/**
 * セッションレコードの先頭に付くアイコン。`TimerRecorder.getTimerIcon` が返す
 * 値と、placeholder を使わない経路が付ける legacy の `⏲️` の和集合。
 * （テストで getTimerIcon の全戻り値がこの集合に含まれることを pin している）
 */
export const SESSION_RECORD_ICONS = ['⏱️', '⏲️', '⏳', '🍅', '🔁'] as const;

/**
 * 先頭のセッションアイコンを落とした表示名。
 *
 * グループ行はレコードではないのでアイコンを持たない。変形時に渡す名前は
 * 1 回目のレコード（`⏱️ タスク名`）から作るので、ここで剥がす。
 */
export function stripSessionIcon(content: string): string {
    const trimmed = content.trim();
    for (const icon of SESSION_RECORD_ICONS) {
        if (trimmed.startsWith(icon)) return trimmed.slice(icon.length).trim();
    }
    return trimmed;
}

/** その行は「タイマーが書いたセッションレコード」の形か。 */
export function isSessionRecord(task: Task | undefined): boolean {
    if (!task) return false;
    // レコードは常に完了（事実であって状態ではない）で、時刻を持つ。
    if (task.statusChar !== 'x') return false;
    if (!task.startTime) return false;
    const content = task.content.trim();
    return SESSION_RECORD_ICONS.some(icon => content.startsWith(icon));
}

/**
 * そのタスクは既にセッションの器として育っているか（＝ 子にセッションレコードを
 * 持つか）。
 *
 * 新規タイマーの開始時にこれが真なら、変形せず末尾追記（append）で始める。
 * 過検出（古い記録が 1 つぶら下がっているだけのタスクを append 扱い）は
 * ユーザー合意ルールそのものなので許容だが、**過少検出は既にあるグループを
 * もう一度包む** ＝ 二重グループ化になるので避ける。
 */
export function looksLikeSessionGroup(
    task: Task | undefined,
    getTask: (id: string) => Task | undefined,
): boolean {
    if (!task) return false;
    return task.childIds.some(childId => isSessionRecord(getTask(childId)));
}

/**
 * タイマーのアンカー行から、形成済みのセッショングループを引く。
 * 未形成（1 回目のレコードがまだトップレベル）なら null。
 */
export function resolveSessionGroup(
    record: Task | undefined,
    getTask: (id: string) => Task | undefined,
): Task | null {
    if (!record?.parentId) return null;
    const parent = getTask(record.parentId);
    if (!parent) return null;
    return looksLikeSessionGroup(parent, getTask) ? parent : null;
}
