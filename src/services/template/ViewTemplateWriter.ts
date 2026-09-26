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
import { createFile, replaceWhole, type WriteChannel } from '../persistence/FileLines';

export class ViewTemplateWriter {
    constructor(
        private app: App,
        private channelFor: (path: string) => WriteChannel | undefined,
    ) {}

    /**
     * Save a view template to the configured folder.
     * Creates the folder if it doesn't exist.
     * Overwrites existing file with the same name.
     *
     * @returns the note, or null when it was not written, overwritten or
     * created (the write layer has told the user why).
     */
    async saveTemplate(folderPath: string, template: ViewTemplate): Promise<TFile | null> {
        const content = this.buildFileContent(template);
        const sanitizedName = template.name.replace(/[\\/:*?"<>|]/g, '_');
        const filePath = normalizePath(`${folderPath}/${sanitizedName}.md`);

        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            // 全体上書き。どの行がどの行になったかは言えないので、申告の
            // 代わりに連鎖が切れた印を残す（replaceWhole）。
            const { written } = await replaceWhole(this.app, existing, this.channelFor(filePath), content);
            return written ? existing : null;
        }
        const created = await createFile(this.app, filePath, this.channelFor(filePath), template.name, async () => {
            await this.ensureFolder(folderPath);
            return content;
        });
        return created.written ? created.file : null;
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
