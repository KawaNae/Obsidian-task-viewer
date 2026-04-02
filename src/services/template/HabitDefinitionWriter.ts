/**
 * HabitDefinitionWriter
 *
 * Saves habit definitions to a vault markdown file.
 * Format: YAML frontmatter (_tv-type: habits) + JSON code block.
 */

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import type { HabitDefinition } from '../../types';

export class HabitDefinitionWriter {
    constructor(private app: App) {}

    async save(filePath: string, habits: HabitDefinition[]): Promise<TFile> {
        const normalized = normalizePath(filePath);
        const parentFolder = normalized.split('/').slice(0, -1).join('/');
        if (parentFolder) {
            await this.ensureFolder(parentFolder);
        }

        const content = this.buildContent(habits);
        const existing = this.app.vault.getAbstractFileByPath(normalized);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
            return existing;
        }
        return await this.app.vault.create(normalized, content);
    }

    private buildContent(habits: HabitDefinition[]): string {
        const lines: string[] = [
            '---',
            '_tv-type: habits',
            '---',
            '',
            '```json',
            JSON.stringify(habits, null, 2),
            '```',
            '',
        ];
        return lines.join('\n');
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
