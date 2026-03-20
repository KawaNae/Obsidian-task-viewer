import { App, AbstractInputSuggest, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
    private textInputEl: HTMLInputElement;

    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
        this.textInputEl = inputEl;
    }

    protected getSuggestions(query: string): TFolder[] {
        const lowerQuery = query.toLowerCase();
        return this.app.vault.getAllFolders()
            .filter(f => f.path !== '/' && f.path.toLowerCase().includes(lowerQuery))
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
        const inputEl = this.textInputEl;
        inputEl.value = folder.path;
        inputEl.trigger('input');
        this.close();
    }
}
