import { App, Modal, Setting } from 'obsidian';

export class CreateTaskModal extends Modal {
    result: string;
    onSubmit: (result: string) => void;

    constructor(app: App, onSubmit: (result: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h2', { text: 'Create New Task' });

        new Setting(contentEl)
            .setName('Task Name')
            .addText((text) =>
                text.onChange((value) => {
                    this.result = value;
                })
                    .inputEl.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            this.submit();
                        }
                    })
            );

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText('Create')
                    .setCta()
                    .onClick(() => {
                        this.submit();
                    }));

        // Focus input
        setTimeout(() => {
            const input = contentEl.querySelector('input[type="text"]') as HTMLInputElement;
            if (input) input.focus();
        }, 50);
    }

    submit() {
        if (this.result && this.result.trim().length > 0) {
            this.close();
            this.onSubmit(this.result);
        } else {
            // Optional: Show error or shake
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
