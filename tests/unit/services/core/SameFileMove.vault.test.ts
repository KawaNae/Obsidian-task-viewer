import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { vaultSession, type VaultSession } from '../../helpers/vaultSession';

/**
 * A task moved within its own file is followed by the name held before the
 * write, however many task rows stand between where it was and where it
 * lands.
 *
 * The move used to be three writes — the status, the append, the delete — and
 * only the delete claimed nothing. Its scan fell to the ladder, which pairs by
 * how near the rows are: the moved line kept its ID with at most one task row
 * between the original and the copy, and took the copy's otherwise (observed
 * in O2 and O3). The move is one write now, and its claim says the moved line
 * is the row that fired, so the distance no longer enters into it.
 *
 * A file's every row is named from a hash of the whole file's content, so any
 * write to the file — even one line, even far away — gives every row in it a
 * new name. What survives the write is not the literal ID but the ability of
 * a name held before the write to follow its row across it
 * (`session.index.getTask(oldName)`), to whatever name that row holds now.
 */

const FILE = 'note.md';

let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

function rowsOf(session: VaultSession): Array<{ id: string; content: string }> {
    return session.index.getTasks()
        .filter(task => task.file === FILE)
        .sort((a, b) => a.line - b.line)
        .map(task => ({ id: task.id, content: task.content }));
}

/** The current ID each of `ids` follows to (undefined if the write took the row away). */
const followed = (session: VaultSession, ids: string[]): Array<string | undefined> =>
    ids.map(id => session.index.getTask(id)?.id);

const COMMANDS: Array<[string, string]> = [
    ['a move alone', 'move()'],
    ['a next instance and a move', 'every mon move()'],
];

describe.each(COMMANDS)('%s within the same file', (_name, command) => {
    it.each([0, 1, 2, 1000])('the name held for the moved row follows it, with %i task rows between', async (between) => {
        const fillers = Array.from({ length: between }, (_, i) => `- [ ] 行${i} @2026-09-21`);
        const contents = new Map([[FILE, [
            '# note', '- [ ] 移す @2026-09-21', `\t- ==> ${command}`, '\t- [ ] 子 @2026-09-21', ...fillers, '',
        ].join('\n')]]);
        live = vaultSession(contents);
        await live.scanAll();
        const before = rowsOf(live);
        const moving = before.find(row => row.content === '移す')!.id;
        const child = before.find(row => row.content === '子')!.id;
        const kept = before.filter(row => row.content.startsWith('行')).map(row => row.id);

        expect(await live.index.updateTask(moving, { statusChar: 'x' })).toBe(true);
        await live.flowSettled(FILE);

        const lines = contents.get(FILE)!.split('\n');
        // The note still ends with its own terminator, so the moved rows land
        // just before the trailing empty element rather than as the file's
        // last two lines.
        expect(lines.slice(-3)).toEqual(['- [x] 移す @2026-09-21', '\t- [ ] 子 @2026-09-21', '']);
        expect(lines).not.toContain('- [ ] 移す @2026-09-21');

        const after = rowsOf(live);
        const moved = after.filter(row => row.content === '移す');
        // With a next instance there is a new row worded like it, above.
        expect(followed(live, [moving])[0]).toBe(moved.map(row => row.id).at(-1));
        expect(after.at(-1)).toEqual({ id: followed(live, [child])[0], content: '子' });
        expect(followed(live, kept)).toEqual(after.filter(row => row.content.startsWith('行')).map(row => row.id));
        if (moved.length > 1) expect(followed(live, [moving, child, ...kept])).not.toContain(moved[0].id);
        expect(Notice.messages).toEqual([]);
    });
});
