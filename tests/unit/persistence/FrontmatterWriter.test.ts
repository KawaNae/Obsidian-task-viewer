import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { FrontmatterWriter } from '../../../src/services/persistence/writers/FrontmatterWriter';
import type { FileOperations } from '../../../src/services/persistence/utils/FileOperations';

/**
 * The frontmatter write path that remains once frontmatter stopped making
 * tasks: setting and clearing scope keys (the color and line-style suggest,
 * window attachment). The guarantees the file-task writes used to pin in the
 * integration suite live here now: only the target key's line changes, key
 * order and unrelated keys survive, and the body is untouched.
 */

function vault(initial: string) {
    let content = initial;
    const file = new TFile();
    file.path = 'note.md';
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => (path === 'note.md' ? file : null),
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); return content; },
        },
    };
    return { writer: new FrontmatterWriter(app as never, {} as FileOperations), read: () => content };
}

describe('FrontmatterWriter.setKeys', () => {
    it('edits only the target key, keeping order, unrelated keys and the body', async () => {
        const { writer, read } = vault([
            '---',
            'alpha: first',
            'tv-color: red',
            'tags: [project, important]',
            'custom-field: keep-this',
            '---',
            'Body with content.',
        ].join('\n'));

        await writer.setKeys('note.md', { 'tv-color': 'blue' });

        expect(read()).toBe([
            '---',
            'alpha: first',
            'tv-color: blue',
            'tags: [project, important]',
            'custom-field: keep-this',
            '---',
            'Body with content.',
        ].join('\n'));
    });

    it('adds a missing key before the closing fence and removes a key set to null', async () => {
        const { writer, read } = vault(['---', 'alpha: first', 'tv-linestyle: dashed', '---', 'Body.'].join('\n'));

        await writer.setKeys('note.md', { 'tv-linestyle': null, 'tv-color': 'green' });

        expect(read()).toBe(['---', 'alpha: first', 'tv-color: green', '---', 'Body.'].join('\n'));
    });

    it('creates a block for a set, but not for a delete alone', async () => {
        const created = vault('Body only.');
        await created.writer.setKeys('note.md', { 'tv-color': 'red' });
        expect(created.read()).toBe(['---', 'tv-color: red', '---', 'Body only.'].join('\n'));

        const untouched = vault('Body only.');
        await untouched.writer.setKeys('note.md', { 'tv-color': null });
        expect(untouched.read()).toBe('Body only.');
    });
});
