import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { contentKeyOf } from '../../../src/services/core/ContentKey';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { freezeDate } from '../helpers/fakeDate';

/**
 * A completion whose fire cannot be written where its lines go
 * (`unplaceable`, `disturbs`) is written alone, in the same write: the
 * completion is the user's, as one made in the editor stands when its fire
 * is refused. One `vault.process`, so nothing written from outside comes
 * between the refused fire and the completion; and one notice.
 *
 * The shape is F8's (R2): `Para` / `- [ ] A ==> move()` / `---` — taking the
 * row out would make the paragraph and the rule a setext heading.
 */

freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';
const NOTE = ['# note', 'Para', '- [ ] A ==> move()', '---', ''];
const DONE = ['# note', 'Para', '- [x] A ==> move()', '---', ''];

let live: VaultSession | undefined;
beforeEach(() => { Notice.messages.length = 0; });
afterEach(() => { live?.dispose(); live = undefined; });

async function open() {
    const { contents, session } = await openVault({ [FILE]: NOTE });
    live = session;
    let processed = 0;
    const vault = session.app.vault as unknown as { process: (...args: unknown[]) => Promise<string> };
    const process = vault.process.bind(vault);
    vault.process = (...args) => { processed++; return process(...args); };
    return { contents, session, processed: () => processed };
}

describe('a completion whose fire would disturb the note', () => {
    it('is written alone in one write, from a card', async () => {
        const note = await open();
        const id = note.session.index.getTasks().find(t => t.content === 'A')!.id;
        expect(await note.session.index.updateTask(id, { statusChar: 'x' })).toBe(true);
        await note.session.flowSettled(FILE);
        expect(note.contents.get(FILE)).toBe(DONE.join('\n'));
        expect(note.processed()).toBe(1);
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toMatch(/heading.*: A$/);
    });

    it('is written alone in one write, from the editor menu on a note no editor shows', async () => {
        const note = await open();
        const at = { line: 2, text: NOTE[2], key: contentKeyOf(NOTE) };
        expect(await note.session.index.writeLine(FILE, at, [{ kind: 'update', text: DONE[2] }])).toBe(true);
        await note.session.flowSettled(FILE);
        expect(note.contents.get(FILE)).toBe(DONE.join('\n'));
        expect(note.processed()).toBe(1);
        expect(Notice.messages).toHaveLength(1);
        expect(Notice.messages[0]).toMatch(/heading/);
    });
});
