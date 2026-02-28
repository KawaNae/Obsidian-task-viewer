/**
 * ViewTemplateLoader
 *
 * Loads view templates from a user-configured vault folder.
 * Each template is a .md file with tv-view/tv-name in YAML frontmatter
 * and view data in a ```json code block.
 *
 * Two-phase loading:
 * - loadTemplates() / findByBasename(): sync, returns summaries (frontmatter only)
 * - loadFullTemplate(): async, reads JSON code block via cachedRead
 */

import { App, TFile, TFolder } from 'obsidian';
import type { ViewTemplateSummary, ViewTemplate, PinnedListDefinition } from '../../types';
import { FilterSerializer } from '../filter/FilterSerializer';
import type { FilterState } from '../filter/FilterTypes';
import type { SortState } from '../sort/SortTypes';

const VALID_VIEWS = new Set(['timeline', 'calendar', 'schedule', 'mini-calendar']);

export class ViewTemplateLoader {
    constructor(private app: App) {}

    /**
     * Load all template summaries from the configured folder.
     * Synchronous via metadataCache (frontmatter only).
     */
    loadTemplates(folderPath: string): ViewTemplateSummary[] {
        if (!folderPath) return [];

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return [];

        const summaries: ViewTemplateSummary[] = [];
        for (const child of folder.children) {
            if (!(child instanceof TFile) || child.extension !== 'md') continue;
            const summary = this.loadSummary(child);
            if (summary) summaries.push(summary);
        }

        summaries.sort((a, b) => a.name.localeCompare(b.name));
        return summaries;
    }

    /**
     * Find a template summary by file basename (used by URI handler).
     */
    findByBasename(folderPath: string, basename: string): ViewTemplateSummary | null {
        if (!folderPath) return null;

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return null;

        for (const child of folder.children) {
            if (!(child instanceof TFile) || child.extension !== 'md') continue;
            if (child.basename === basename) {
                return this.loadSummary(child);
            }
        }
        return null;
    }

    /**
     * Load full template data including JSON code block.
     * Async — reads file body via cachedRead.
     */
    async loadFullTemplate(filePath: string): Promise<ViewTemplate | null> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return null;

        const summary = this.loadSummary(file);
        if (!summary) return null;

        const template: ViewTemplate = { ...summary };

        const content = await this.app.vault.cachedRead(file);
        const jsonData = this.extractJsonBlock(content);
        if (jsonData) {
            this.applyJsonData(template, jsonData);
        }

        return template;
    }

    private loadSummary(file: TFile): ViewTemplateSummary | null {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm) return null;

        const viewType = fm['tv-view'];
        if (typeof viewType !== 'string' || !VALID_VIEWS.has(viewType)) return null;

        const name = typeof fm['tv-name'] === 'string' && fm['tv-name']
            ? fm['tv-name']
            : file.basename;

        return { filePath: file.path, name, viewType };
    }

    private extractJsonBlock(content: string): Record<string, unknown> | null {
        const match = content.match(/```json\s*\n([\s\S]*?)\n```/);
        if (!match) return null;
        try {
            const parsed = JSON.parse(match[1]);
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch {
            return null;
        }
    }

    private applyJsonData(template: ViewTemplate, data: Record<string, unknown>): void {
        if (typeof data.days === 'number') template.days = data.days;
        if (typeof data.zoom === 'number') template.zoom = data.zoom;
        if (typeof data.showSidebar === 'boolean') template.showSidebar = data.showSidebar;

        if (data.filter && typeof data.filter === 'object') {
            template.filterState = FilterSerializer.fromJSON(data.filter);
        }

        if (Array.isArray(data.pinnedLists)) {
            template.pinnedLists = this.parsePinnedLists(data.pinnedLists);
        }
    }

    private parsePinnedLists(raw: unknown[]): PinnedListDefinition[] {
        const result: PinnedListDefinition[] = [];

        for (const entry of raw) {
            if (!entry || typeof entry !== 'object') continue;
            const obj = entry as Record<string, unknown>;

            const id = typeof obj.id === 'string' ? obj.id : '';
            const name = typeof obj.name === 'string' ? obj.name : '';
            if (!id || !name) continue;

            let filterState: FilterState | undefined;
            if (obj.filterState && typeof obj.filterState === 'object') {
                filterState = FilterSerializer.fromJSON(obj.filterState);
            }
            if (!filterState) continue;

            const def: PinnedListDefinition = { id, name, filterState };

            if (obj.sortState && typeof obj.sortState === 'object') {
                def.sortState = obj.sortState as SortState;
            }

            result.push(def);
        }

        return result;
    }
}
