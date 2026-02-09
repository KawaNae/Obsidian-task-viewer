/**
 * PropertyColorSuggest - AbstractInputSuggest for Properties View
 * Provides color suggestions for timeline-color property in Properties View (contenteditable div)
 */

import { App, AbstractInputSuggest } from 'obsidian';
import TaskViewerPlugin from '../main';
import { filterColors, renderColorSuggestion } from './colorUtils';

export class PropertyColorSuggest extends AbstractInputSuggest<string> {
    private plugin: TaskViewerPlugin;
    private valueEl: HTMLInputElement | HTMLDivElement;

    constructor(app: App, inputEl: HTMLInputElement | HTMLDivElement, plugin: TaskViewerPlugin) {
        super(app, inputEl);
        this.plugin = plugin;
        this.valueEl = inputEl;
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
        void this.updateFrontmatter(value);
        this.close();
    }

    private syncValue(value: string): void {
        if (this.valueEl instanceof HTMLDivElement) {
            this.valueEl.textContent = value;
        } else {
            this.valueEl.value = value;
        }
    }

    private async updateFrontmatter(value: string): Promise<void> {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            this.syncValue(value);
            return;
        }

        const colorKey = this.plugin.settings.frontmatterTaskKeys.color;
        // @ts-ignore - processFrontMatter
        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter: any) => {
            frontmatter[colorKey] = value;
        });

        this.syncValue(value);
    }
}



