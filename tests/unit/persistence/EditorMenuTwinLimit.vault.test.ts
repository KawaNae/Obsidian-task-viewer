import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { t } from '../../../src/i18n';

/**
 * The editor's ⋯ menu, on one of two twin lines, when the editor and the file
 * part ways: N1's known limit, closed in E1.
 *
 * The menu points at a line by the editor's line number and text
 * (`EditorLine`). Checked by its text alone, the line passed on a twin that
 * an unsaved line above, or an edit from outside, had brought onto that
 * number, and the write went to the other twin. The coordinate now holds only
 * in the content it was taken in (`EditorLine.key`, checked by
 * `WriteSession.row`): written to the file, it is refused unless the file
 * reads as the editor showed it.
 */

const FILE = 'note.md';

let live: VaultSession[] = [];

afterEach(() => {
    for (const session of live) session.dispose();
    live = [];
    Notice.messages.length = 0;
});

describe('the editor menu, written to the file, on one of two twin lines', () => {
    it('is refused when the editor holds an unsaved line above it', async () => {
        const { contents, session } = await openVault(['- [ ] 読書', '- [ ] 読書', '']);
        live.push(session);

        // The editor shows ['メモ', '- [ ] 読書', '- [ ] 読書', ''], 'メモ' not
        // saved yet, and its menu is opened on its line 1: the disk's line 0.
        const shown = ['メモ', '- [ ] 読書', '- [ ] 読書', ''];
        const at = { line: 1, text: '- [ ] 読書', key: contentKeyOf(shown) };

        expect(await session.index.writeLine(FILE, at, [{ kind: 'update', text: '- [x] 読書' }])).toBe(false);
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [ ] 読書', ''].join('\n'));
        expect(Notice.messages).toEqual([t('notice.writeTargetChanged', { subject: '- [ ] 読書' })]);
    });

    it('is refused when an edit from outside took a line away above it since the menu was opened', async () => {
        const shown = ['- [ ] 読書', '- [ ] 読書', '- [ ] 読書', ''];
        const { contents, session } = await openVault(shown);
        live.push(session);

        // The menu is opened on the second twin; then the first is taken away
        // from outside, and the third comes onto its line.
        const at = { line: 1, text: '- [ ] 読書', key: contentKeyOf(shown) };
        contents.set(FILE, ['- [ ] 読書', '- [ ] 読書', ''].join('\n'));

        expect(await session.index.writeLine(FILE, at, [{ kind: 'remove' }])).toBe(false);
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [ ] 読書', ''].join('\n'));
        expect(Notice.messages).toEqual([t('notice.writeTargetChanged', { subject: '- [ ] 読書' })]);
    });

    it('is written when the file reads as the editor showed it', async () => {
        const shown = ['- [ ] 読書', '- [ ] 読書', ''];
        const { contents, session } = await openVault(shown);
        live.push(session);

        const at = { line: 1, text: '- [ ] 読書', key: contentKeyOf(shown) };

        expect(await session.index.writeLine(FILE, at, [{ kind: 'update', text: '- [x] 読書' }])).toBe(true);
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [x] 読書', ''].join('\n'));
        expect(Notice.messages).toEqual([]);
    });
});
