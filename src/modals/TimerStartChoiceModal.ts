import { type App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';
import type { TimerStartChoice } from '../timer/TimerStartMode';

/**
 * 完了済み（`[x]`）タスクにタイマーを掛けたときの 3 択。
 *
 * 既定は「続きを開始」— 完了済みの事実は残したまま隣に足すほうが失うものが無い。
 * 「上書きして開始」はその行の記録を取り直す操作なので、CTA にはしない。
 *
 * 閉じ方によらず必ず 1 回だけ結果を返す（✕ や Esc で閉じたら `cancel`）。
 * 走行中タイマーの生成をコールバック側が握っているので、取りこぼすと
 * 「開始したのに何も起きない」になる。
 */
export class TimerStartChoiceModal extends Modal {
    private settled = false;

    constructor(
        app: App,
        private taskName: string,
        private onChoice: (choice: TimerStartChoice) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        // CSS hook for the shared close-animation fix; see _modal.css
        // `.mod-tv-modal` rule.
        this.containerEl.addClass('mod-tv-modal');
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: t('timer.startOnCompletedTitle') });
        contentEl.createEl('p', { text: t('timer.startOnCompletedMessage', { task: this.taskName }) });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t('modal.cancel'))
                .onClick(() => this.settle('cancel')))
            .addButton(btn => btn
                .setButtonText(t('timer.overwriteStart'))
                .onClick(() => this.settle('overwrite')))
            .addButton(btn => btn
                .setButtonText(t('timer.continueSession'))
                .setCta()
                .onClick(() => this.settle('continue')));
    }

    private settle(choice: TimerStartChoice): void {
        if (this.settled) return;
        this.settled = true;
        this.onChoice(choice);
        this.close();
    }

    onClose(): void {
        this.settle('cancel');
        this.contentEl.empty();
    }
}
