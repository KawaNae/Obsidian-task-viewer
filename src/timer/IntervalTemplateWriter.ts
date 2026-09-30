/**
 * IntervalTemplateWriter
 *
 * Saves interval timer templates as markdown files.
 * Format: YAML frontmatter (_tv-name) + JSON code block (icon, groups).
 */

import { type App, TFile } from 'obsidian';
import type { IntervalGroup } from './TimerInstance';
import { templateNoteContent, templateNotePath, yamlQuoted, type TemplateNoteSaver } from '../services/template/TemplateNote';

export interface TemplateCreateData {
    name: string;
    icon: string;
    groups: IntervalGroup[];
}

export class IntervalTemplateWriter {
    constructor(
        private app: App,
        private notes: TemplateNoteSaver,
    ) {}

    /** @returns the note, or null when the overwrite was not written (the write layer has told the user why). */
    async updateTemplate(filePath: string, data: TemplateCreateData): Promise<TFile | null> {
        if (!(this.app.vault.getAbstractFileByPath(filePath) instanceof TFile)) {
            throw new Error('Template file not found.');
        }
        return this.notes.saveTemplateNote(filePath, data.name, this.buildFileContent(data));
    }

    /**
     * @returns the note, or null when it was not created (the write layer has
     * told the user why). A name already taken throws, before anything is written.
     */
    async saveTemplate(folderPath: string, data: TemplateCreateData): Promise<TFile | null> {
        const filePath = templateNotePath(folderPath, data.name);
        if (this.app.vault.getAbstractFileByPath(filePath) instanceof TFile) {
            throw new Error(`A template named "${data.name}" already exists.`);
        }
        return this.notes.saveTemplateNote(filePath, data.name, this.buildFileContent(data));
    }

    private buildFileContent(data: TemplateCreateData): string {
        return templateNoteContent([['_tv-name', yamlQuoted(data.name)]], {
            icon: data.icon,
            groups: data.groups.map(g => ({
                repeatCount: g.repeatCount,
                segments: g.segments.map(s => ({
                    label: s.label,
                    durationSeconds: s.durationSeconds,
                    type: s.type,
                })),
            })),
        });
    }
}
