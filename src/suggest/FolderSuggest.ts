import type { App, TFolder } from 'obsidian';
import { ShownSuggest } from './ShownSuggest';

/**
 * The vault's folders, suggested by their path. Picking one puts its path in
 * the input, unless the caller says what picking does (`onPick`): a field
 * that commits its value on a pick (the settings').
 */
export class FolderSuggest extends ShownSuggest<TFolder> {
    private textInputEl: HTMLInputElement;

    constructor(app: App, inputEl: HTMLInputElement, private readonly onPick?: (folder: TFolder) => void) {
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

    protected pick(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
        if (this.onPick) {
            this.onPick(folder);
        } else {
            this.textInputEl.value = folder.path;
            this.textInputEl.trigger('input');
        }
        this.close();
    }
}
