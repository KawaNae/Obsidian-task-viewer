import { describe, it, expect, afterEach } from 'vitest';
import { Notice } from 'obsidian';
import { openVault, type VaultSession } from '../helpers/vaultSession';
import { freezeDate } from '../helpers/fakeDate';

/**
 * The next instance is spelled as the row that fired: its list marker and
 * the gap after it (L2's H2, handed to stage X). It used to be written from a
 * task with no line of its own (`TaskParser.format` over `originalText: ''`),
 * so `*`, `+` and `1)` came back as `- `; and a row whose content opens far
 * from its marker (`10.   [ ] T`) got a next instance whose content opens
 * two columns in, under which the `==>` lines and a generated child written
 * as the fired row's children read as a paragraph going on, and the series
 * stopped.
 */

// `every` lands on the first grid point after the later of today and the
// row's date: today is held on the Friday the dates below are read from.
freezeDate(new Date(2026, 8, 25, 12, 0, 0));

const FILE = 'note.md';
let live: VaultSession | undefined;

afterEach(() => {
    live?.dispose();
    live = undefined;
    Notice.messages.length = 0;
});

async function complete(lines: string[], content = 'T'): Promise<{ lines: string[]; session: VaultSession }> {
    const { contents, session } = await openVault({ [FILE]: lines });
    live = session;
    const task = session.index.getTasks().find(each => each.content === content)!;
    expect(await session.index.updateTask(task.id, { statusChar: 'x' })).toBe(true);
    await session.flowSettled(FILE);
    return { lines: contents.get(FILE)!.split('\n'), session };
}

describe('the next instance keeps the marker of the row that fired', () => {
    // A bullet is the row's own; an ordered row's instance is numbered 1,
    // with the row's delimiter: the marker has to be one that can interrupt
    // a paragraph (see the R8 cases below).
    for (const [marker, next] of [['*', '*'], ['+', '+'], ['1)', '1)'], ['2.', '1.'], ['3)', '1)']]) {
        it(`${marker}`, async () => {
            const { lines } = await complete(['# note', `${marker} [ ] T @2026-09-21 ==> every mon`, '']);
            expect(lines).toEqual(['# note', `${next} [ ] T @2026-09-28 ==> every mon`, `${marker} [x] T @2026-09-21`, '']);
            expect(Notice.messages).toEqual([]);
        });
    }

    it('and the gap after it, so its commands are its children and the series goes on', async () => {
        const { lines, session } = await complete(['# note', '10.   [ ] T @2026-09-21', '      - ==> every mon', '']);

        // Numbered 1, the content opens a column left of the row's; the
        // command stays where it stood, past that column, a child still.
        expect(lines).toEqual(['# note', '1.   [ ] T @2026-09-28', '      - ==> every mon', '10.   [x] T @2026-09-21', '']);
        const next = session.index.getTasks().find(task => task.content === 'T' && task.statusChar === ' ')!;
        expect(next.flow?.program).toBeTruthy();
    });

    it('under a row deep in its item, a generated child is a task of the next instance', async () => {
        const { lines, session } = await complete([
            '# note', '10.   [ ] T @2026-09-21', '      - ==> every mon use("w")', '',
            '```tv-gen w', '- [ ] T', '\t- [ ] 生成子', '```', '',
        ]);

        const at = lines.indexOf('1.   [ ] T');
        expect(at).toBeGreaterThan(0);
        const child = session.index.getTasks().find(task => task.content === '生成子' && task.line === at + 2);
        expect(child, lines.join('\n')).toBeDefined();
        expect(child!.parentId).toBe(session.index.getTasks().find(task => task.line === at)!.id);
    });
});

/**
 * R8: an ordered row whose instance goes in just past the text of the item
 * above. An ordered item that does not start at 1 cannot interrupt a
 * paragraph, so an instance numbered as the row read as that text going on,
 * and the write was refused: the completion stood alone, the series cut.
 */
describe('an ordered row whose instance goes in just past a paragraph', () => {
    it('past the item above, at the top level', async () => {
        const { lines } = await complete(['text0', '- [ ] A', '2. [ ] T @2026-09-21 ==> every 1d', '']);

        // The head of T's group is A: the instance goes in past `text0`.
        expect(lines).toEqual(['text0', '1. [ ] T @2026-09-26 ==> every 1d', '- [ ] A', '2. [x] T @2026-09-21', '']);
        expect(Notice.messages).toEqual([]);
    });

    it('past the text of the parent it is nested in', async () => {
        const { lines } = await complete(['- [ ] P', '  1. [ ] X', '  2. [ ] T @2026-09-21 ==> every 1d', '']);

        expect(lines).toEqual(['- [ ] P', '  1. [ ] T @2026-09-26 ==> every 1d', '  1. [ ] X', '  2. [x] T @2026-09-21', '']);
        expect(Notice.messages).toEqual([]);
    });
});
