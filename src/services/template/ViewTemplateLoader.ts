/**
 * ViewTemplateLoader
 *
 * Loads view templates from a user-configured vault folder.
 * Each template is a .md file with tv-view defined in YAML frontmatter.
 *
 * Template format:
 * ---
 * tv-view: timeline
 * tv-name: Work Dashboard
 * tv-days: 3
 * tv-zoom: 1.0
 * tv-showSidebar: true
 * tv-filter: { version: 4, root: { ... } }
 * tv-pinnedLists:
 *   - id: pl-1
 *     name: Urgent
 *     filterState: { root: { ... } }
 * ---
 */

import { App, TFile, TFolder } from 'obsidian';
import type { ViewTemplate, PinnedListDefinition } from '../../types';
import { FilterSerializer } from '../filter/FilterSerializer';
import type { FilterState } from '../filter/FilterTypes';
import type { SortState } from '../sort/SortTypes';

const VALID_VIEWS = new Set(['timeline', 'calendar', 'schedule', 'mini-calendar']);

export class ViewTemplateLoader {
    constructor(private app: App) {}

    /**
     * Load all view templates from the configured folder.
     * Synchronous via metadataCache — no async needed.
     */
    loadTemplates(folderPath: string): ViewTemplate[] {
        if (!folderPath) return [];

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return [];

        const templates: ViewTemplate[] = [];
        for (const child of folder.children) {
            if (!(child instanceof TFile) || child.extension !== 'md') continue;
            const template = this.loadTemplate(child);
            if (template) templates.push(template);
        }

        templates.sort((a, b) => a.name.localeCompare(b.name));
        return templates;
    }

    /**
     * Find a template by file basename (used by URI handler).
     */
    findByBasename(folderPath: string, basename: string): ViewTemplate | null {
        if (!folderPath) return null;

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) return null;

        for (const child of folder.children) {
            if (!(child instanceof TFile) || child.extension !== 'md') continue;
            if (child.basename === basename) {
                return this.loadTemplate(child);
            }
        }
        return null;
    }

    private loadTemplate(file: TFile): ViewTemplate | null {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter;
        if (!fm) return null;

        const viewType = fm['tv-view'];
        if (typeof viewType !== 'string' || !VALID_VIEWS.has(viewType)) return null;

        const name = typeof fm['tv-name'] === 'string' && fm['tv-name']
            ? fm['tv-name']
            : file.basename;

        const template: ViewTemplate = { filePath: file.path, name, viewType };

        if (typeof fm['tv-days'] === 'number') template.days = fm['tv-days'];
        if (typeof fm['tv-zoom'] === 'number') template.zoom = fm['tv-zoom'];
        if (typeof fm['tv-showSidebar'] === 'boolean') template.showSidebar = fm['tv-showSidebar'];

        // Filter: parse through FilterSerializer for version migration
        if (fm['tv-filter'] && typeof fm['tv-filter'] === 'object') {
            template.filterState = FilterSerializer.fromJSON(fm['tv-filter']);
        }

        // PinnedLists
        if (Array.isArray(fm['tv-pinnedLists'])) {
            template.pinnedLists = this.parsePinnedLists(fm['tv-pinnedLists']);
        }

        return template;
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
