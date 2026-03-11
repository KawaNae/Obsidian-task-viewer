/**
 * PropertyTagSuggest - AbstractInputSuggest for Properties View.
 * Provides tag suggestions for tv-sharedtags property in Properties View.
 */

import { App, AbstractInputSuggest } from 'obsidian';
import TaskViewerPlugin from '../../main';

export class PropertyTagSuggest extends AbstractInputSuggest<string> {
    private plugin: TaskViewerPlugin;
    private valueEl: HTMLInputElement | HTMLDivElement;
    private frontmatterKey: string;

    constructor(app: App, inputEl: HTMLInputElement | HTMLDivElement, plugin: TaskViewerPlugin, frontmatterKey: string) {
        super(app, inputEl);
        this.plugin = plugin;
        this.valueEl = inputEl;
        this.frontmatterKey = frontmatterKey;
    }

    protected getSuggestions(query: string): string[] {
        // @ts-ignore - getTags() is not in the public API typings
        const tagMap: Record<string, number> = this.app.metadataCache.getTags?.() ?? {};
        const q = query.toLowerCase().replace(/^#/, '');

        return Object.keys(tagMap)
            .map(t => t.startsWith('#') ? t.substring(1) : t)
            .filter(t => q === '' || t.toLowerCase().includes(q))
            .sort((a, b) => {
                const aP = a.toLowerCase().startsWith(q) ? 0 : 1;
                const bP = b.toLowerCase().startsWith(q) ? 0 : 1;
                if (aP !== bP) return aP - bP;
                return a.localeCompare(b);
            })
            .slice(0, 30);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(`#${value}`);
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

        // @ts-ignore - processFrontMatter
        await this.plugin.app.fileManager.processFrontMatter(activeFile, (frontmatter: any) => {
            const existing: string[] = Array.isArray(frontmatter[this.frontmatterKey])
                ? frontmatter[this.frontmatterKey]
                : [];
            if (!existing.includes(value)) {
                existing.push(value);
                frontmatter[this.frontmatterKey] = existing;
            }
        });

        this.syncValue(value);
    }
}
