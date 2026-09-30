/**
 * A template saved as a note: frontmatter that names it, and a JSON block
 * that holds its data. The one way the plugin writes such a note, for a
 * view's template (`ViewTemplateWriter`) and an interval timer's
 * (`IntervalTemplateWriter`); each reads its own back.
 */

import { type App, TFile, normalizePath } from 'obsidian';
import { createFile, replaceWhole, type WriteChannel } from '../persistence/FileLines';

/** The note a template named `name` is saved as in `folder`: the characters a file name cannot hold made `_`. */
export function templateNotePath(folder: string, name: string): string {
    return normalizePath(`${folder}/${name.replace(/[\\/:*?"<>|]/g, '_')}.md`);
}

/** `str` as a double-quoted YAML scalar. */
export function yamlQuoted(str: string): string {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The content of a template note: the frontmatter `fields`, each a line
 * `key: value` with the value as given, and `data` as a JSON block below,
 * or no block for null.
 */
export function templateNoteContent(fields: ReadonlyArray<readonly [string, string]>, data: unknown): string {
    const lines: string[] = ['---', ...fields.map(([key, value]) => `${key}: ${value}`), '---', ''];
    if (data !== null) lines.push('```json', JSON.stringify(data, null, 2), '```', '');
    return lines.join('\n');
}

/**
 * Save `content` as the note at `path`: the note there written over whole
 * (`replaceWhole`), or made, with the folders its path names
 * (`createFile`). Answers the note, or null when it was not written — the
 * write layer has told the user why.
 */
export async function saveTemplateNote(
    app: App,
    path: string,
    channel: WriteChannel | undefined,
    name: string,
    content: string,
): Promise<TFile | null> {
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
        const { written } = await replaceWhole(app, existing, channel, content);
        return written ? existing : null;
    }
    const created = await createFile(app, path, channel, name, () => content);
    return created.written ? created.file : null;
}
