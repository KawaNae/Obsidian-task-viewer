import { type App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

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
 * 既定は「発火して削除」— 削除そのものは取り消せる編集だが、失われる系列は
 * 手で書き直すしかない。失うものが少ないほうを CTA にする。
 *
 * 次のインスタンスを実際の行として見せるのは、削除時の発火が完了時の発火と
 * 同じ日付を出すとは限らないため。`at(today + 3d)` は削除した日を起点に読む
 * ので、日付は結果を見てから決めてもらう。
 *
 * 閉じ方によらず必ず 1 回だけ結果を返す（✕ や Esc で閉じたら `cancel`）。
 */
export class FlowDeleteChoiceModal extends Modal {
    private settled = false;

    constructor(
        app: App,
        private opts: FlowDeleteChoiceOptions,
        private onChoice: (choice: FlowDeleteChoice) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        // CSS hook for the shared close-animation fix; see _modal.css
        // `.mod-tv-modal` rule.
        this.containerEl.addClass('mod-tv-modal');
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: t('flowDelete.title') });
        contentEl.createEl('p', { text: t('flowDelete.message') });

        const preview = contentEl.createDiv({ cls: 'tv-flow-delete__preview' });
        preview.createEl('div', {
            cls: 'tv-flow-delete__preview-label',
            text: t('flowDelete.nextInstance'),
        });
        preview.createEl('code', {
            cls: 'tv-flow-delete__preview-line',
            text: this.opts.previewLine,
        });

        if (this.opts.descendantFlows > 0) {
            contentEl.createEl('p', {
                cls: 'tv-flow-delete__descendants',
                text: t('flowDelete.descendants', { count: String(this.opts.descendantFlows) }),
            });
        }

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t('modal.cancel'))
                .onClick(() => this.settle('cancel')))
            .addButton(btn => btn
                .setButtonText(t('flowDelete.deleteOnly'))
                .setWarning()
                .onClick(() => this.settle('delete')))
            .addButton(btn => btn
                .setButtonText(t('flowDelete.fireAndDelete'))
                .setCta()
                .onClick(() => this.settle('fireAndDelete')));
    }

    private settle(choice: FlowDeleteChoice): void {
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
