import { App, Modal, Setting } from 'obsidian';

export class InputModal extends Modal {
    private title: string;
    private label: string;
    private defaultValue: string;
    private onSubmit: (value: string) => void;
    private inputEl: HTMLInputElement;

    constructor(
        app: App,
        title: string,
        label: string,
        defaultValue: string,
        onSubmit: (value: string) => void
    ) {
        super(app);
        this.title = title;
        this.label = label;
        this.defaultValue = defaultValue;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('input-modal');

        contentEl.createEl('h3', { text: this.title });

        // Label above input (vertical stacking for small windows)
        const inputContainer = contentEl.createDiv('input-modal__input-container');
        inputContainer.createEl('label', { text: this.label, cls: 'input-modal__label' });

        this.inputEl = inputContainer.createEl('input', {
            type: 'text',
            cls: 'input-modal__input',
            value: this.defaultValue
        });
        this.inputEl.focus();
        this.inputEl.select();
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.submit();
            }
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText('OK')
                .setCta()
                .onClick(() => this.submit()));
    }

    private submit() {
        const value = this.inputEl.value;
        this.onSubmit(value);
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
