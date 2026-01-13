/**
 * PropertyColorSuggest - AbstractInputSuggest for Properties View
 * Provides color suggestions for timeline-color property in Properties View (contenteditable div)
 */

import { App, AbstractInputSuggest } from 'obsidian';
import { filterColors, renderColorSuggestion } from './colorUtils';

export class PropertyColorSuggest extends AbstractInputSuggest<string> {
    constructor(app: App, inputEl: HTMLInputElement | HTMLDivElement) {
        super(app, inputEl);
    }

    protected getSuggestions(query: string): string[] {
        // Show limited colors when empty, otherwise show all matches
        if (query.trim() === '') {
            return filterColors('', 20);
        }
        return filterColors(query);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        renderColorSuggestion(value, el);
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        this.setValue(value);
        this.close();
    }
}



