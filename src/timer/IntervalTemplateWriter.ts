/**
 * IntervalTemplateWriter
 *
 * Saves interval timer templates as markdown files.
 * Format: YAML frontmatter (_tv-name) + JSON code block (icon, groups).
 */

import { type App, TFile } from 'obsidian';
import type { IntervalGroup } from './IntervalMath';
import { templateNoteContent, templateNotePath, yamlQuoted, type TemplateNoteSaver } from '../services/template/TemplateNote';
import type { WriteAnswer, WriteTelling } from '../services/operations/WriteAnswer';

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

    /** @returns whether the overwrite was written, and why not when it was not (`TemplateNoteSaver.saveTemplateNote`). */
    async updateTemplate(filePath: string, data: TemplateCreateData, opts: WriteTelling = {}): Promise<WriteAnswer & { file?: TFile }> {
        if (!(this.app.vault.getAbstractFileByPath(filePath) instanceof TFile)) {
            throw new Error('Template file not found.');
        }
        return this.notes.saveTemplateNote(filePath, data.name, this.buildFileContent(data), opts);
    }

    /**
     * @returns whether the note was created, and why not when it was not
     * (`TemplateNoteSaver.saveTemplateNote`). A name already taken throws,
     * before anything is written.
     */
    async saveTemplate(folderPath: string, data: TemplateCreateData, opts: WriteTelling = {}): Promise<WriteAnswer & { file?: TFile }> {
        const filePath = templateNotePath(folderPath, data.name);
        if (this.app.vault.getAbstractFileByPath(filePath) instanceof TFile) {
            throw new Error(`A template named "${data.name}" already exists.`);
        }
        return this.notes.saveTemplateNote(filePath, data.name, this.buildFileContent(data), opts);
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
