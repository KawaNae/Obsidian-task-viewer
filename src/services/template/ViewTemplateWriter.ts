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

import type { TFile } from 'obsidian';
import type { ViewTemplate } from '../../types';
import { templateNoteContent, templateNotePath, yamlQuoted, type TemplateNoteSaver } from './TemplateNote';
import type { WriteAnswer, WriteTelling } from '../operations/WriteAnswer';

export class ViewTemplateWriter {
    constructor(
        private notes: TemplateNoteSaver,
    ) {}

    /**
     * Save a view template to the configured folder, over the note of the
     * same name if there is one (`saveTemplateNote`).
     *
     * @returns whether the note was written, overwritten or created, and why
     * not when it was not (`TemplateNoteSaver.saveTemplateNote`).
     */
    async saveTemplate(folderPath: string, template: ViewTemplate, opts: WriteTelling = {}): Promise<WriteAnswer & { file?: TFile }> {
        const filePath = templateNotePath(folderPath, template.name);
        return this.notes.saveTemplateNote(filePath, template.name, this.buildFileContent(template), opts);
    }

    private buildFileContent(template: ViewTemplate): string {
        const data = template.config ?? {};
        return templateNoteContent(
            [['_tv-view', template.viewType], ['_tv-name', yamlQuoted(template.name)]],
            Object.keys(data).length > 0 ? data : null,
        );
    }
}
