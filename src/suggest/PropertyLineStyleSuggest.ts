/**
 * PropertyLineStyleSuggest - AbstractInputSuggest for Properties View.
 * Provides line style suggestions for configured linestyle property in Properties View.
 */

import { App, AbstractInputSuggest } from 'obsidian';
import TaskViewerPlugin from '../main';
import { filterLineStyles, renderLineStyleSuggestion } from './lineStyleUtils';

export class PropertyLineStyleSuggest extends AbstractInputSuggest<string> {
    private plugin: TaskViewerPlugin;
    private valueEl: HTMLInputElement | HTMLDivElement;

    constructor(app: App, inputEl: HTMLInputElement | HTMLDivElement, plugin: TaskViewerPlugin) {
        super(app, inputEl);
        this.plugin = plugin;
        this.valueEl = inputEl;
    }

    protected getSuggestions(query: string): string[] {
        if (query.trim() === '') {
            return filterLineStyles('', 20);
        }
        return filterLineStyles(query);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        renderLineStyleSuggestion(value, el);
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

        const linestyleKey = this.plugin.settings.frontmatterTaskKeys.linestyle;
        // @ts-ignore - processFrontMatter
        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter: any) => {
            frontmatter[linestyleKey] = value;
        });

        this.syncValue(value);
    }
}

