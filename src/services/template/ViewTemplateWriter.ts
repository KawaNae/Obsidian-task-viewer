/**
 * ViewTemplateWriter
 *
 * Saves view templates as markdown files.
 * Format: YAML frontmatter (tv-view, tv-name) + JSON code block (data).
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
        // Frontmatter: metadata only
        const lines: string[] = ['---'];
        lines.push(`tv-view: ${template.viewType}`);
        lines.push(`tv-name: "${this.escapeYamlString(template.name)}"`);
        lines.push('---');
        lines.push('');

        // JSON code block: all data fields
        const data: Record<string, unknown> = {};
        if (template.days != null) data.days = template.days;
        if (template.zoom != null) data.zoom = template.zoom;
        if (template.showSidebar != null) data.showSidebar = template.showSidebar;
        if (template.filterState && hasConditions(template.filterState)) {
            data.filter = FilterSerializer.toJSON(template.filterState);
        }
        if (template.pinnedLists && template.pinnedLists.length > 0) {
            data.pinnedLists = template.pinnedLists;
        }

        if (Object.keys(data).length > 0) {
            lines.push('```json');
            lines.push(JSON.stringify(data, null, 2));
            lines.push('```');
            lines.push('');
        }

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
