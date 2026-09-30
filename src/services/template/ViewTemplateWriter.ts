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

import type { App, TFile } from 'obsidian';
import type { ViewTemplate } from '../../types';
import type { WriteChannel } from '../persistence/FileLines';
import { saveTemplateNote, templateNoteContent, templateNotePath, yamlQuoted } from './TemplateNote';

export class ViewTemplateWriter {
    constructor(
        private app: App,
        private channelFor: (path: string) => WriteChannel | undefined,
    ) {}

    /**
     * Save a view template to the configured folder, over the note of the
     * same name if there is one (`saveTemplateNote`).
     *
     * @returns the note, or null when it was not written, overwritten or
     * created (the write layer has told the user why).
     */
    async saveTemplate(folderPath: string, template: ViewTemplate): Promise<TFile | null> {
        const filePath = templateNotePath(folderPath, template.name);
        return saveTemplateNote(this.app, filePath, this.channelFor(filePath), template.name, this.buildFileContent(template));
    }

    private buildFileContent(template: ViewTemplate): string {
        const data = template.config ?? {};
        return templateNoteContent(
            [['_tv-view', template.viewType], ['_tv-name', yamlQuoted(template.name)]],
            Object.keys(data).length > 0 ? data : null,
        );
    }
}
