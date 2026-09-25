import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';

/**
 * A known limit of N1, pinned as it writes: the editor's ⋯ menu writes to the
 * wrong one of two twin lines when the editor holds an edit not saved yet.
 *
 * The editor's menu points at a line by the editor's line number and text
 * (`EditorLine`), and the write checks that text on the same line of the
 * file on disk (`InlineTaskWriter.applyToLine`). An unsaved line put in above
 * moves the editor's lines one down from the disk's; when the disk's line
 * there is a twin of the one the editor showed, it reads as the editor's did
 * and the check passes. The check by the content a copy was read in
 * (`NamedRow.read`, the twins decision of 2026-09-25 10:42) does not reach
 * this path: the editor's text is no reading of the file.
 *
 * The stage E1 (writes that come from the editor) closes it, and rewrites
 * this test to expect the write refused and the file left as it is.
 */

const FILE = 'note.md';

let live: VaultSession[] = [];

afterEach(() => {
    for (const session of live) session.dispose();
    live = [];
    Notice.messages.length = 0;
});

describe('the editor menu, on one of two twin lines, with an unsaved line above it (limit until E1)', () => {
    it('writes the other twin: E1 rewrites this to a refusal', async () => {
        const { contents, session } = await openVault(['- [ ] 読書', '- [ ] 読書', '']);
        live.push(session);

        // The editor shows ['メモ', '- [ ] 読書', '- [ ] 読書'], 'メモ' not saved
        // yet, and its menu is opened on its line 1: the disk's line 0.
        const shown = { line: 1, text: '- [ ] 読書' };

        expect(await session.index.writeLine(FILE, shown, [{ kind: 'update', text: '- [x] 読書' }])).toBe(true);
        // The disk's line 1, the twin below the one the editor pointed at.
        expect(contents.get(FILE)).toBe(['- [ ] 読書', '- [x] 読書', ''].join('\n'));
    });
});
