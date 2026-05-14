import { App, AbstractInputSuggest, TFile } from 'obsidian';

export class FileSuggest extends AbstractInputSuggest<TFile> {
    private textInputEl: HTMLInputElement;

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.textInputEl = inputEl;
    }

    protected getSuggestions(query: string): TFile[] {
        const lowerQuery = query.toLowerCase();
        return this.app.vault.getMarkdownFiles()
            .filter(f => f.path.toLowerCase().includes(lowerQuery))
            .sort((a, b) => a.path.localeCompare(b.path))
            .slice(0, 50);
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFile): void {
        this.textInputEl.value = file.path;
        this.textInputEl.trigger('input');
        this.close();
    }
}
