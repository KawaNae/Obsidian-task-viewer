import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { TimerStartChoice } from '../../timer/TimerStartMode';
import { askChoice } from './askChoice';

/**
 * 完了済み（`[x]`）タスクにタイマーを掛けたときの 3 択。
 *
 * 「続きを開始」を CTA にする — 完了済みの事実は残したまま隣に足すほうが
 * 失うものが無い。「上書きして開始」はその行の記録を取り直す操作なので、
 * CTA にはしない。初めのフォーカスは他の問いと同じく取り消しに置く（論点4）。
 * 開いた直後の Enter で何も始めないため。
 *
 * 閉じ方によらず 1 回だけ答える（✕ や Esc で閉じたら `cancel`）。走行中
 * タイマーの生成を呼び手が握っているので、取りこぼすと「開始したのに何も
 * 起きない」になる。
 */
export function askTimerStart(app: App, taskName: string): Promise<TimerStartChoice> {
    return askChoice<'overwrite' | 'continue'>(app, {
        title: t('timer.startOnCompletedTitle'),
        body: [t('timer.startOnCompletedMessage', { task: taskName })],
        choices: [
            { value: 'overwrite', label: t('timer.overwriteStart') },
            { value: 'continue', label: t('timer.continueSession'), tone: 'cta' },
        ],
    });
}
