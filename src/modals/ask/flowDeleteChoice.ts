import type { App } from 'obsidian';
import { t } from '../../i18n';
import { askChoice } from './askChoice';

export type FlowDeleteChoice = 'cancel' | 'delete' | 'fireAndDelete';

export interface FlowDeleteChoiceOptions {
    /** The line the fire would write, as the writer would spell it. */
    previewLine: string;
    /** Descendants carrying a command, which go with the delete either way. */
    descendantFlows: number;
}

/**
 * フローコマンドを持つタスクを削除するときの 3 択。
 *
 * 「発火して削除」を CTA にする — 削除そのものは取り消せる編集だが、失われる
 * 系列は手で書き直すしかない。初めのフォーカスは他の問いと同じく取り消しに
 * 置く（論点4）。開いた直後の Enter で何も消さないため。
 *
 * 次のインスタンスを実際の行として見せるのは、削除時の発火が完了時の発火と
 * 同じ日付を出すとは限らないため。`at(today + 3d)` は削除した日を起点に読む
 * ので、日付は結果を見てから決めてもらう。
 */
export function askFlowDelete(app: App, opts: FlowDeleteChoiceOptions): Promise<FlowDeleteChoice> {
    return askChoice<'delete' | 'fireAndDelete'>(app, {
        title: t('flowDelete.title'),
        body: (el) => {
            el.createEl('p', { text: t('flowDelete.message') });
            const preview = el.createDiv({ cls: 'tv-flow-delete__preview' });
            preview.createEl('div', { cls: 'tv-flow-delete__preview-label', text: t('flowDelete.nextInstance') });
            preview.createEl('code', { cls: 'tv-form__line-preview', text: opts.previewLine });
            if (opts.descendantFlows > 0) {
                el.createEl('p', {
                    cls: 'tv-flow-delete__descendants',
                    text: t('flowDelete.descendants', { count: String(opts.descendantFlows) }),
                });
            }
        },
        choices: [
            { value: 'delete', label: t('flowDelete.deleteOnly'), tone: 'warning' },
            { value: 'fireAndDelete', label: t('flowDelete.fireAndDelete'), tone: 'cta' },
        ],
    });
}
