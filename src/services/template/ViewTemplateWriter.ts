/**
 * ViewTemplateWriter
 *
 * Saves view templates as markdown files with YAML frontmatter.
 * Creates or overwrites files in the configured view template folder.
 */

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type { ViewTemplate } from '../../types';
import { FilterSerializer } from '../filter/FilterSerializer';
import { hasConditions } from '../filter/FilterTypes';

export class ViewTemplateWriter {
    constructor(private app: App) {}

    /**
     * Save a view template to the configured folder.
     * Creates the folder if it doesn't exist.
     * Overwrites existing file with the same name.
     */
    async saveTemplate(folderPath: string, template: ViewTemplate): Promise<TFile> {
        await this.ensureFolder(folderPath);

        const content = this.buildFileContent(template);
        const sanitizedName = template.name.replace(/[\\/:*?"<>|]/g, '_');
        const filePath = normalizePath(`${folderPath}/${sanitizedName}.md`);

        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
            return existing;
        }
        return await this.app.vault.create(filePath, content);
    }

    private buildFileContent(template: ViewTemplate): string {
        const lines: string[] = ['---'];

        lines.push(`tv-view: ${template.viewType}`);
        lines.push(`tv-name: "${this.escapeYamlString(template.name)}"`);

        if (template.days != null) lines.push(`tv-days: ${template.days}`);
        if (template.zoom != null) lines.push(`tv-zoom: ${template.zoom}`);
        if (template.showSidebar != null) lines.push(`tv-showSidebar: ${template.showSidebar}`);

        if (template.filterState && hasConditions(template.filterState)) {
            const filterJson = FilterSerializer.toJSON(template.filterState);
            lines.push(`tv-filter: ${JSON.stringify(filterJson)}`);
        }

        if (template.pinnedLists && template.pinnedLists.length > 0) {
            lines.push(`tv-pinnedLists: ${JSON.stringify(template.pinnedLists)}`);
        }

        lines.push('---');
        lines.push('');

        return lines.join('\n');
    }

    private escapeYamlString(str: string): string {
        return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    private async ensureFolder(folderPath: string): Promise<void> {
        const normalized = normalizePath(folderPath);
        const existing = this.app.vault.getAbstractFileByPath(normalized);
        if (existing instanceof TFolder) return;

        // Create nested folders if needed
        const parts = normalized.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const folder = this.app.vault.getAbstractFileByPath(current);
            if (!folder) {
                await this.app.vault.createFolder(current);
            }
        }
    }
}
