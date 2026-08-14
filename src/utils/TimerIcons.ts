/**
 * タイマーが記録行に付けるアイコンの単一情報源。
 *
 * アイコンは記法ではないが記法に準ずる扱いを受ける — レコード行の先頭に付き、
 * フロー発火が次インスタンスを作るときは剥がされる。剥がす側（`FlowPlanner`）と
 * 付ける側（`TimerRecorder`）が別々に一覧を持つと、片方に足したアイコンが
 * もう片方から漏れる。実際 `🔁` は付ける側にしか無く、次インスタンスに残り続けて
 * いた。
 *
 * 純粋なモジュールとして `utils` に置く。付ける側は `timer`、剥がす側は
 * `services/flow` にあり、どちらか一方に置くと層をまたいで参照することになる。
 */

/** タイマーが付けうるアイコンの全て。剥がす側はこの一覧を正とする。 */
export const TIMER_ICONS = ['⏱️', '⏲️', '⏳', '🍅', '🔁'] as const;

export type TimerIcon = (typeof TIMER_ICONS)[number];

/**
 * レコード行の先頭に付いた既知アイコン（と続く空白）を 1 つ剥がす。
 *
 * `⏳` は countdown の旧アイコンで、現在は付けない。既存ノートに残っているので
 * 剥がす側には残す。
 */
export const TIMER_ICON_PREFIX_RE = new RegExp(`^(?:${TIMER_ICONS.join('|')})\\s*`);

/** タイマーの種別に対応するアイコン。 */
export function getTimerIcon(
    timerType: string,
    intervalSource?: 'pomodoro'
): TimerIcon {
    if (timerType === 'interval') {
        return intervalSource === 'pomodoro' ? '🍅' : '🔁';
    }
    if (timerType === 'countdown') return '⏲️';
    return '⏱️';
}

/**
 * 名前にアイコンを 1 つだけ前置する。
 *
 * 既に付いている既知アイコンは**種類を問わず剥がしてから**付け直す。起点が
 * 完了済みレコード（＝ 既にアイコン付き）である「続き」でも二重に付かず、
 * 旧アイコンで書かれた行を起点にしても `⏲️ ⏳ 名前` のような重なりにならない。
 */
export function withTimerIcon(icon: TimerIcon, name: string): string {
    const bare = name.replace(TIMER_ICON_PREFIX_RE, '').trim();
    return bare ? `${icon} ${bare}` : icon;
}
