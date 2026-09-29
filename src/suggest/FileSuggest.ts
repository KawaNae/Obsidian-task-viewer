import type { App, TFile } from 'obsidian';
import { ShownSuggest } from './ShownSuggest';

/**
 * The vault's notes, suggested by their path. Picking one puts its path in
 * the input, unless the caller says what picking does (`onPick`) — a form
 * that names a note by more than one field puts the note in each.
 */
export class FileSuggest extends ShownSuggest<TFile> {
    private textInputEl: HTMLInputElement;

    constructor(app: App, inputEl: HTMLInputElement, private readonly onPick?: (file: TFile) => void) {
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
        if (this.onPick) {
            this.onPick(file);
        } else {
            this.textInputEl.value = file.path;
            this.textInputEl.trigger('input');
        }
        this.close();
    }
}
