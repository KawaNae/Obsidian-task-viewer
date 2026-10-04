import type { App } from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { fileOfElement } from '../utils/ObsidianView';
import { ShownSuggest } from './ShownSuggest';
import type { ScopeValueKind } from './ScopeValues';

/**
 * The values of a scope key (a color, a line style) offered under its value
 * in Obsidian's Properties view (a contenteditable div). One class for every
 * kind (`ScopeValueKind`).
 *
 * A value picked is written to the note the view shows: the file of the
 * leaf the field is in (`fileOfElement`), not the active one, so the
 * Properties view of a note beside the active one writes to its own note.
 * The field shows the value once it is written; a value the write refused
 * is not in the file, and is not shown (the write layer says why).
 */
export class PropertyValueSuggest extends ShownSuggest<string> {
    constructor(
        app: App,
        private readonly valueEl: HTMLInputElement | HTMLDivElement,
        private readonly plugin: PluginContext,
        private readonly kind: ScopeValueKind,
    ) {
        super(app, valueEl);
    }

    protected getSuggestions(query: string): string[] {
        return this.kind.candidates(query);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        this.kind.render(value, el);
    }

    protected pick(value: string): void {
        void this.write(value);
        this.close();
    }

    private show(value: string): void {
        // By its tag, not instanceof: a popout window has its own element classes.
        if (this.valueEl.tagName === 'INPUT') (this.valueEl as HTMLInputElement).value = value;
        else this.valueEl.textContent = value;
    }

    private async write(value: string): Promise<void> {
        const file = fileOfElement(this.app, this.valueEl);
        if (!file) {
            // No note holds the field (a preview): Obsidian's own field writes what it shows.
            this.show(value);
            return;
        }
        const written = await this.plugin.getOperations()
            .setFrontmatterKeys(file.path, { [this.kind.key(this.plugin.settings)]: value });
        if (written) this.show(value);
    }
}
