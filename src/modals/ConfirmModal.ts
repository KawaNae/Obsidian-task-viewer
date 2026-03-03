import { App, Modal, Setting } from 'obsidian';

export class ConfirmModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: () => void;
    private confirmLabel: string;
    private warning: boolean;

    constructor(
        app: App,
        title: string,
        message: string,
        onConfirm: () => void,
        options?: { confirmLabel?: string; warning?: boolean }
    ) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.confirmLabel = options?.confirmLabel ?? 'OK';
        this.warning = options?.warning ?? false;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: this.title });
        contentEl.createEl('p', { text: this.message });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
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
