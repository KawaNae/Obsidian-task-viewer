import { type App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

export class ConfirmModal extends Modal {
    private title: string;
    private message: string[];
    private onConfirm: () => void;
    private confirmLabel: string;
    private warning: boolean;

    /**
     * @param message one paragraph, or one per line. Several are for when the
     * confirmation carries a reason the caller found out separately from the
     * question it is asking.
     */
    constructor(
        app: App,
        title: string,
        message: string | string[],
        onConfirm: () => void,
        options?: { confirmLabel?: string; warning?: boolean }
    ) {
        super(app);
        this.title = title;
        this.message = Array.isArray(message) ? message : [message];
        this.onConfirm = onConfirm;
        this.confirmLabel = options?.confirmLabel ?? t('modal.ok');
        this.warning = options?.warning ?? false;
    }

    onOpen() {
        // CSS hook for the shared close-animation fix; see _modal.css
        // `.mod-tv-modal` rule.
        this.containerEl.addClass('mod-tv-modal');
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: this.title });
        for (const paragraph of this.message) {
            contentEl.createEl('p', { text: paragraph });
        }

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t('modal.cancel'))
                .onClick(() => {
                    this.close();
                }))
            .addButton(btn => {
                btn.setButtonText(this.confirmLabel)
                    .onClick(() => {
                        this.onConfirm();
                        this.close();
                    });
                if (this.warning) btn.setWarning();
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
