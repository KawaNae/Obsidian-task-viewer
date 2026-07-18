/**
 * ViewTemplateWriter
 *
 * Saves view templates as markdown files.
 * Format: YAML frontmatter (_tv-view, _tv-name) + JSON code block (data).
 *
 * The JSON code block content is exactly `template.config` — the
 * canonical dict produced by each view's ViewConfigCodec. No per-field
 * logic lives here.
 */

import { type App, TFile, TFolder, normalizePath } from 'obsidian';
import type { ViewTemplate } from '../../types';

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
        lines.push(`_tv-view: ${template.viewType}`);
        lines.push(`_tv-name: "${this.escapeYamlString(template.name)}"`);
        lines.push('---');
        lines.push('');

        const data = template.config ?? {};
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
