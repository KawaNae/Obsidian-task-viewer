/**
 * IntervalTemplateWriter
 *
 * Saves interval timer templates as markdown files.
 * Format: YAML frontmatter (_tv-name) + JSON code block (icon, groups).
 */

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type { IntervalGroup } from './TimerInstance';

export interface TemplateCreateData {
    name: string;
    icon: string;
    groups: IntervalGroup[];
}

export class IntervalTemplateWriter {
    constructor(private app: App) {}

    async saveTemplate(folderPath: string, data: TemplateCreateData): Promise<TFile> {
        await this.ensureFolder(folderPath);

        const content = this.buildFileContent(data);
        const sanitizedName = data.name.replace(/[\\/:*?"<>|]/g, '_');
        const filePath = normalizePath(`${folderPath}/${sanitizedName}.md`);

        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            throw new Error(`A template named "${data.name}" already exists.`);
        }
        return await this.app.vault.create(filePath, content);
    }

    private buildFileContent(data: TemplateCreateData): string {
        const lines: string[] = ['---'];
        lines.push(`_tv-name: "${this.escapeYamlString(data.name)}"`);
        lines.push('---');
        lines.push('');

        const jsonData: Record<string, unknown> = {
            icon: data.icon,
            groups: data.groups.map(g => ({
                repeatCount: g.repeatCount,
                segments: g.segments.map(s => ({
                    label: s.label,
                    durationSeconds: s.durationSeconds,
                    type: s.type,
                })),
            })),
        };

        lines.push('```json');
        lines.push(JSON.stringify(jsonData, null, 2));
        lines.push('```');
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
