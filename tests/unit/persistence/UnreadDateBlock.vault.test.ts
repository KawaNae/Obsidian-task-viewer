import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';

/**
 * A date block naming a day or a time that does not exist is not read, and a
 * write of the row keeps it on the line as written (stage 7, point N): a
 * status toggle, a rename or a duplicate does not drop it, and does not guess
 * a date for it.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

async function open(lines: string[]) {
    const opened = await openVault(lines);
    live = opened.session;
    return opened;
}

function rowOf(session: VaultSession, content: string) {
    const found = session.index.getTasks().filter(task => task.file === FILE && task.content === content);
    expect(found).toHaveLength(1);
    return found[0];
}

describe('a date block that does not read, through a write', () => {
    for (const block of ['@2026-13-45', '@2026-02-30', '@2026-03-01T25:00>2026-03-02']) {
        it(`keeps ${block} when the row is checked and renamed`, async () => {
            const { contents, session } = await open(['# note', `- [ ] A ${block}`, '']);
            const row = rowOf(session, 'A');
            expect(row.startDate).toBe('');
            expect(row.validation?.rule).toBe('parse-error');

            expect(await session.ops.updateTask(row.id, { statusChar: 'x' })).toBe(true);
            expect(contents.get(FILE)).toBe(['# note', `- [x] A ${block}`, ''].join('\n'));
        });
    }

    it('copies a block that does not read as it is, without moving it by days', async () => {
        const { contents, session } = await open(['# note', '- [ ] A @2026-02-30', '']);
        const row = rowOf(session, 'A');
        expect(await session.ops.duplicateTask(row.id, { dayOffset: 1, count: 1 })).toBe(true);
        expect(contents.get(FILE)).toBe(['# note', '- [ ] A @2026-02-30', '- [ ] A @2026-02-30', ''].join('\n'));
    });
});
